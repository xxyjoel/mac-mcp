import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Apple's Core Foundation epoch starts at 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200; // seconds between Unix epoch and Apple epoch

export interface CalendarEvent {
  eventId: number;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  calendarId: number;
  calendarName: string;
  status: number;
  availability: number;
  lastModified: Date;
  uniqueIdentifier?: string;
}

export interface CalendarInfo {
  calendarId: number;
  title: string;
  type?: string;
  color?: string;
  subscribed: boolean;
  immutable: boolean;
  eventCount?: number;
}

export class CalendarDatabase {
  private db: Database.Database | null = null;
  private calendarDbPath: string;

  constructor() {
    // Calendar data is stored in a Group Container
    this.calendarDbPath = path.join(
      os.homedir(),
      'Library',
      'Group Containers',
      'group.com.apple.calendar',
      'Calendar.sqlitedb'
    );
  }

  /**
   * Connect to the Calendar SQLite database
   */
  async connect(): Promise<void> {
    try {
      await fs.access(this.calendarDbPath);
      
      // Open in read-only mode
      this.db = new Database(this.calendarDbPath, { 
        readonly: true, 
        fileMustExist: true 
      });
      
      // Test connection
      const result = this.db.prepare('SELECT COUNT(*) as count FROM CalendarItem').get() as { count: number };
      console.log(`Connected to Calendar database with ${result.count.toLocaleString()} total events`);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Calendar database not found. Please ensure Calendar.app is configured.`);
      }
      throw new Error(`Failed to connect to Calendar database: ${error.message}`);
    }
  }

  /**
   * Convert Apple Core Foundation date to JavaScript Date
   */
  private appleToJSDate(appleTime: number): Date {
    // Apple time is seconds since 2001-01-01
    // Add Apple epoch offset to get Unix timestamp
    return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
  }

  /**
   * Convert JavaScript Date to Apple Core Foundation date
   */
  private jsToAppleDate(date: Date): number {
    // Convert to seconds and subtract Apple epoch offset
    return (date.getTime() / 1000) - APPLE_EPOCH_OFFSET;
  }

  /**
   * Get all calendars
   */
  async getCalendars(): Promise<CalendarInfo[]> {
    if (!this.db) throw new Error('Database not connected');

    const query = `
      SELECT 
        c.ROWID as calendar_id,
        c.title,
        c.type,
        c.subscribed,
        c.immutable,
        co.symbolic_color_name as color,
        COUNT(ci.ROWID) as event_count
      FROM Calendar c
      LEFT JOIN Color co ON c.color_id = co.ROWID
      LEFT JOIN CalendarItem ci ON c.ROWID = ci.calendar_id
      GROUP BY c.ROWID
      ORDER BY c.title
    `;

    const rows = this.db.prepare(query).all();
    
    return rows.map(row => ({
      calendarId: row.calendar_id as number,
      title: row.title as string,
      type: row.type as string,
      color: row.color as string,
      subscribed: Boolean(row.subscribed),
      immutable: Boolean(row.immutable),
      eventCount: row.event_count as number
    }));
  }

  /**
   * Get recent events from last N days
   */
  async getRecentEvents(daysBack: number = 2, limit: number = 100): Promise<CalendarEvent[]> {
    if (!this.db) throw new Error('Database not connected');

    const cutoffDate = this.jsToAppleDate(new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000)));
    const nowDate = this.jsToAppleDate(new Date());

    const query = `
      SELECT 
        ci.ROWID as event_id,
        ci.summary,
        ci.description,
        l.title as location,
        ci.start_date,
        ci.end_date,
        ci.all_day,
        ci.calendar_id,
        c.title as calendar_name,
        ci.status,
        ci.availability,
        ci.last_modified,
        ci.unique_identifier
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      LEFT JOIN Location l ON ci.location_id = l.ROWID
      WHERE ci.start_date > ? AND ci.start_date < ?
      ORDER BY ci.start_date DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(cutoffDate, nowDate, limit);
    
    return rows.map(row => ({
      eventId: row.event_id as number,
      summary: row.summary as string || '(No title)',
      description: row.description as string,
      location: row.location as string,
      startDate: this.appleToJSDate(row.start_date as number),
      endDate: this.appleToJSDate(row.end_date as number),
      allDay: Boolean(row.all_day),
      calendarId: row.calendar_id as number,
      calendarName: row.calendar_name as string,
      status: row.status as number,
      availability: row.availability as number,
      lastModified: this.appleToJSDate(row.last_modified as number),
      uniqueIdentifier: row.unique_identifier as string
    }));
  }

  /**
   * Get event statistics
   */
  async getStatistics(daysBack: number = 7): Promise<{
    totalEvents: number;
    totalCalendars: number;
    eventsByCalendar: Record<string, number>;
    upcomingEvents: number;
    pastEvents: number;
    allDayEvents: number;
  }> {
    if (!this.db) throw new Error('Database not connected');

    const cutoffDate = this.jsToAppleDate(new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000)));
    const nowDate = this.jsToAppleDate(new Date());

    // Total events in period
    const totalQuery = `
      SELECT COUNT(*) as count 
      FROM CalendarItem 
      WHERE start_date > ? AND start_date < ?
    `;
    const totalResult = this.db.prepare(totalQuery).get(cutoffDate, nowDate) as { count: number };

    // Events by calendar
    const byCalendarQuery = `
      SELECT 
        c.title as calendar_name,
        COUNT(ci.ROWID) as event_count
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      WHERE ci.start_date > ? AND ci.start_date < ?
      GROUP BY c.ROWID
      ORDER BY event_count DESC
    `;
    const byCalendarRows = this.db.prepare(byCalendarQuery).all(cutoffDate, nowDate);
    
    const eventsByCalendar: Record<string, number> = {};
    byCalendarRows.forEach(row => {
      eventsByCalendar[row.calendar_name as string] = row.event_count as number;
    });

    // Other stats
    const statsQuery = `
      SELECT 
        COUNT(CASE WHEN start_date > ? THEN 1 END) as upcoming,
        COUNT(CASE WHEN start_date <= ? THEN 1 END) as past,
        COUNT(CASE WHEN all_day = 1 THEN 1 END) as all_day
      FROM CalendarItem
      WHERE start_date > ? AND start_date < ?
    `;
    const stats = this.db.prepare(statsQuery).get(nowDate, nowDate, cutoffDate, nowDate) as {
      upcoming: number;
      past: number;
      all_day: number;
    };

    const calendarsResult = this.db.prepare('SELECT COUNT(*) as count FROM Calendar').get() as { count: number };

    return {
      totalEvents: totalResult.count,
      totalCalendars: calendarsResult.count,
      eventsByCalendar,
      upcomingEvents: stats.upcoming,
      pastEvents: stats.past,
      allDayEvents: stats.all_day
    };
  }

  /**
   * Search events by text
   */
  async searchEvents(searchText: string, daysBack: number = 30, limit: number = 50): Promise<CalendarEvent[]> {
    if (!this.db) throw new Error('Database not connected');

    const cutoffDate = this.jsToAppleDate(new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000)));
    const searchPattern = `%${searchText}%`;

    const query = `
      SELECT 
        ci.ROWID as event_id,
        ci.summary,
        ci.description,
        l.title as location,
        ci.start_date,
        ci.end_date,
        ci.all_day,
        ci.calendar_id,
        c.title as calendar_name,
        ci.status,
        ci.availability,
        ci.last_modified,
        ci.unique_identifier
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      LEFT JOIN Location l ON ci.location_id = l.ROWID
      WHERE ci.start_date > ?
        AND (ci.summary LIKE ? OR ci.description LIKE ? OR l.title LIKE ?)
      ORDER BY ci.start_date DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(
      cutoffDate, 
      searchPattern, 
      searchPattern, 
      searchPattern, 
      limit
    );
    
    return rows.map(row => ({
      eventId: row.event_id as number,
      summary: row.summary as string || '(No title)',
      description: row.description as string,
      location: row.location as string,
      startDate: this.appleToJSDate(row.start_date as number),
      endDate: this.appleToJSDate(row.end_date as number),
      allDay: Boolean(row.all_day),
      calendarId: row.calendar_id as number,
      calendarName: row.calendar_name as string,
      status: row.status as number,
      availability: row.availability as number,
      lastModified: this.appleToJSDate(row.last_modified as number),
      uniqueIdentifier: row.unique_identifier as string
    }));
  }

  /**
   * Get events for a specific date range
   */
  async getEventsInRange(startDate: Date, endDate: Date, calendarIds?: number[]): Promise<CalendarEvent[]> {
    if (!this.db) throw new Error('Database not connected');

    const startApple = this.jsToAppleDate(startDate);
    const endApple = this.jsToAppleDate(endDate);

    let query = `
      SELECT 
        ci.ROWID as event_id,
        ci.summary,
        ci.description,
        l.title as location,
        ci.start_date,
        ci.end_date,
        ci.all_day,
        ci.calendar_id,
        c.title as calendar_name,
        ci.status,
        ci.availability,
        ci.last_modified,
        ci.unique_identifier
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      LEFT JOIN Location l ON ci.location_id = l.ROWID
      WHERE ci.start_date >= ? AND ci.start_date < ?
    `;

    const params: any[] = [startApple, endApple];

    if (calendarIds && calendarIds.length > 0) {
      query += ` AND ci.calendar_id IN (${calendarIds.map(() => '?').join(',')})`;
      params.push(...calendarIds);
    }

    query += ' ORDER BY ci.start_date ASC';

    const rows = this.db.prepare(query).all(...params);
    
    return rows.map(row => ({
      eventId: row.event_id as number,
      summary: row.summary as string || '(No title)',
      description: row.description as string,
      location: row.location as string,
      startDate: this.appleToJSDate(row.start_date as number),
      endDate: this.appleToJSDate(row.end_date as number),
      allDay: Boolean(row.all_day),
      calendarId: row.calendar_id as number,
      calendarName: row.calendar_name as string,
      status: row.status as number,
      availability: row.availability as number,
      lastModified: this.appleToJSDate(row.last_modified as number),
      uniqueIdentifier: row.unique_identifier as string
    }));
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}