import Database from 'better-sqlite3';
import { CalendarEvent } from '../calendar/client.js';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

export interface CachedCalendar {
  name: string;
  lastSync: number;
  eventCount: number;
}

export interface CachedEvent extends CalendarEvent {
  cachedAt: number;
  expiresAt: number;
}

export class CalendarCache {
  private db: Database.Database;
  private readonly CACHE_DIR = join(homedir(), '.mac-calendar-mcp');
  private readonly DB_PATH = join(this.CACHE_DIR, 'calendar-cache.db');
  private readonly DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes for recent events
  private readonly OLD_EVENT_TTL = 60 * 60 * 1000; // 1 hour for older events
  private readonly CALENDAR_LIST_TTL = 24 * 60 * 60 * 1000; // 24 hours for calendar list

  constructor() {
    // Ensure cache directory exists
    try {
      mkdirSync(this.CACHE_DIR, { recursive: true });
    } catch (error) {
      console.error('Failed to create cache directory:', error);
    }

    // Initialize database
    this.db = new Database(this.DB_PATH);
    this.db.pragma('journal_mode = WAL'); // Better performance
    this.db.pragma('synchronous = NORMAL'); // Balance between safety and speed
    
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Calendars table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendars (
        name TEXT PRIMARY KEY,
        last_sync INTEGER NOT NULL,
        event_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        metadata TEXT
      )
    `);

    // Events table with indexes for efficient querying
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        calendar_name TEXT NOT NULL,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        location TEXT,
        description TEXT,
        is_all_day BOOLEAN DEFAULT 0,
        cached_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        raw_data TEXT,
        FOREIGN KEY (calendar_name) REFERENCES calendars(name) ON DELETE CASCADE
      )
    `);

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_name);
      CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);
      CREATE INDEX IF NOT EXISTS idx_events_calendar_dates ON events(calendar_name, start_date, end_date);
    `);

    // Sync status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_status (
        operation TEXT PRIMARY KEY,
        last_run INTEGER NOT NULL,
        duration_ms INTEGER,
        status TEXT,
        error_message TEXT
      )
    `);
  }

  // Calendar operations
  async getCachedCalendars(): Promise<CachedCalendar[] | null> {
    const stmt = this.db.prepare(`
      SELECT name, last_sync, event_count 
      FROM calendars 
      WHERE last_sync > ?
      ORDER BY access_count DESC, name ASC
    `);
    
    const validUntil = Date.now() - this.CALENDAR_LIST_TTL;
    const calendars = stmt.all(validUntil) as CachedCalendar[];
    
    return calendars.length > 0 ? calendars : null;
  }

  async cacheCalendars(calendars: string[]): Promise<void> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO calendars (name, last_sync, is_active)
      VALUES (?, ?, 1)
    `);

    const transaction = this.db.transaction(() => {
      for (const calendar of calendars) {
        stmt.run(calendar, now);
      }
    });

    transaction();
  }

  // Event operations
  async getCachedEvents(
    calendarName: string | undefined,
    startDate: string,
    endDate: string
  ): Promise<CalendarEvent[] | null> {
    const now = Date.now();
    
    let query: string;
    let params: any[];
    
    if (calendarName) {
      query = `
        SELECT id, title, start_date as startDate, end_date as endDate, 
               location, description, calendar_name as calendarName, 
               is_all_day as isAllDay
        FROM events
        WHERE calendar_name = ? 
          AND start_date >= ? 
          AND start_date <= ?
          AND expires_at > ?
        ORDER BY start_date ASC
      `;
      params = [calendarName, startDate, endDate, now];
    } else {
      query = `
        SELECT id, title, start_date as startDate, end_date as endDate, 
               location, description, calendar_name as calendarName, 
               is_all_day as isAllDay
        FROM events
        WHERE start_date >= ? 
          AND start_date <= ?
          AND expires_at > ?
        ORDER BY start_date ASC
      `;
      params = [startDate, endDate, now];
    }
    
    const stmt = this.db.prepare(query);
    const events = stmt.all(...params) as CalendarEvent[];
    
    // Update calendar access stats
    if (calendarName) {
      this.updateCalendarAccessStats(calendarName);
    }
    
    return events.length > 0 ? events : null;
  }

  async cacheEvents(events: CalendarEvent[], calendarName?: string): Promise<void> {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      // Clear old events for the calendar(s)
      if (calendarName) {
        this.db.prepare('DELETE FROM events WHERE calendar_name = ?').run(calendarName);
      } else {
        // If no specific calendar, we need to clear events for all calendars being updated
        const calendars = new Set(events.map(e => e.calendarName));
        for (const cal of calendars) {
          this.db.prepare('DELETE FROM events WHERE calendar_name = ?').run(cal);
        }
      }

      // Insert new events
      const stmt = this.db.prepare(`
        INSERT INTO events (
          id, calendar_name, title, start_date, end_date, 
          location, description, is_all_day, cached_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        const ttl = this.getTTLForEvent(event);
        const expiresAt = now + ttl;
        
        stmt.run(
          event.id,
          event.calendarName,
          event.title,
          event.startDate,
          event.endDate,
          event.location || null,
          event.description || null,
          event.isAllDay ? 1 : 0,
          now,
          expiresAt
        );
      }

      // Update calendar event counts
      const updateStmt = this.db.prepare(`
        UPDATE calendars 
        SET event_count = (
          SELECT COUNT(*) FROM events WHERE calendar_name = ?
        ),
        last_sync = ?
        WHERE name = ?
      `);

      const calendars = new Set(events.map(e => e.calendarName));
      for (const cal of calendars) {
        updateStmt.run(cal, now, cal);
      }
    });

    transaction();
  }

  async searchCachedEvents(query: string, startDate?: string, endDate?: string): Promise<CalendarEvent[] | null> {
    const now = Date.now();
    let sql = `
      SELECT id, title, start_date as startDate, end_date as endDate, 
             location, description, calendar_name as calendarName, 
             is_all_day as isAllDay
      FROM events
      WHERE (title LIKE ? OR description LIKE ?)
        AND expires_at > ?
    `;
    
    const params: any[] = [`%${query}%`, `%${query}%`, now];
    
    if (startDate && endDate) {
      sql += ' AND start_date >= ? AND start_date <= ?';
      params.push(startDate, endDate);
    }
    
    sql += ' ORDER BY start_date ASC LIMIT 500'; // Limit results for performance
    
    const stmt = this.db.prepare(sql);
    const events = stmt.all(...params) as CalendarEvent[];
    
    return events.length > 0 ? events : null;
  }

  async getCachedEvent(eventId: string): Promise<CalendarEvent | null> {
    const stmt = this.db.prepare(`
      SELECT id, title, start_date as startDate, end_date as endDate, 
             location, description, calendar_name as calendarName, 
             is_all_day as isAllDay
      FROM events
      WHERE id = ? AND expires_at > ?
    `);
    
    const event = stmt.get(eventId, Date.now()) as CalendarEvent | undefined;
    return event || null;
  }

  // Utility methods
  private getTTLForEvent(event: CalendarEvent): number {
    const eventDate = new Date(event.startDate);
    const now = new Date();
    const daysDiff = Math.abs((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    // Recent events (within 7 days) get shorter TTL
    if (daysDiff <= 7) {
      return this.DEFAULT_TTL;
    }
    
    // Older events get longer TTL
    return this.OLD_EVENT_TTL;
  }

  private updateCalendarAccessStats(calendarName: string): void {
    const stmt = this.db.prepare(`
      UPDATE calendars 
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE name = ?
    `);
    
    stmt.run(Date.now(), calendarName);
  }

  async clearExpiredCache(): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM events WHERE expires_at < ?');
    const result = stmt.run(Date.now());
    console.log(`Cleared ${result.changes} expired events from cache`);
  }

  async getCalendarStats(): Promise<any> {
    const stmt = this.db.prepare(`
      SELECT 
        name,
        event_count,
        last_sync,
        access_count,
        last_accessed
      FROM calendars
      ORDER BY access_count DESC
    `);
    
    return stmt.all();
  }

  close(): void {
    this.db.close();
  }
}