import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { SecurityManager } from '../../../src/utils/security.js';

// Apple's Core Foundation epoch starts at 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200;

export interface Reminder {
  reminderId: number;
  title: string;
  notes?: string;
  isCompleted: boolean;
  completedDate?: Date;
  dueDate?: Date;
  priority: number;
  isFlagged: boolean;
  listId?: number;
  listName?: string;
  creationDate: Date;
  modificationDate: Date;
  url?: string;
  recurrenceRule?: string;
}

export interface ReminderList {
  listId: number;
  name: string;
  color?: string;
  isShared: boolean;
  totalCount: number;
  activeCount: number;
  completedCount: number;
  sortingStyle?: string;
}

export interface ReminderSearchResult extends Reminder {
  relevanceScore?: number;
}

export class RemindersDatabase {
  private db: Database.Database | null = null;
  private remindersDbPath: string;

  constructor() {
    // Reminders uses a more complex storage structure
    this.remindersDbPath = path.join(
      os.homedir(),
      'Library',
      'Group Containers',
      'group.com.apple.reminders',
      'Container_v1',
      'Stores',
      'Data-local.sqlite'
    );
  }

  /**
   * Connect to the Reminders SQLite database
   */
  async connect(): Promise<void> {
    try {
      // Security check: Verify database access
      const securityCheck = await SecurityManager.checkDatabaseAccess(this.remindersDbPath);
      if (!securityCheck.hasAccess) {
        const error = new Error('Database access denied');
        if (securityCheck.missingPermissions.length > 0) {
          error.message += `\nMissing permissions: ${securityCheck.missingPermissions.join(', ')}`;
        }
        if (securityCheck.recommendations.length > 0) {
          error.message += `\n\n${securityCheck.recommendations.join('\n')}`;
        }
        throw error;
      }
      
      await fs.access(this.remindersDbPath);
      
      this.db = new Database(this.remindersDbPath, { 
        readonly: true, 
        fileMustExist: true 
      });
      
      // Test connection
      const result = this.db.prepare('SELECT COUNT(*) as count FROM ZREMCDREMINDER').get() as { count: number };
      console.log(`Connected to Reminders database with ${result.count} reminders`);
      
      // Log access for audit purposes
      SecurityManager.logAccess('reminders_database_connect', {
        totalReminders: result.count,
        timestamp: new Date()
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Reminders database not found. Please ensure Reminders.app is configured.`);
      }
      throw SecurityManager.sanitizeError(error);
    }
  }

  /**
   * Convert Apple Core Foundation date to JavaScript Date
   */
  private appleToJSDate(appleTime: number | null): Date | undefined {
    if (!appleTime || appleTime === 0) return undefined;
    return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
  }

  /**
   * Convert JavaScript Date to Apple Core Foundation date
   */
  private jsToAppleDate(date: Date): number {
    return (date.getTime() / 1000) - APPLE_EPOCH_OFFSET;
  }

  /**
   * Get all reminder lists
   */
  async getLists(): Promise<ReminderList[]> {
    if (!this.db) throw new Error('Database not connected');

    const query = `
      SELECT 
        l.Z_PK as list_id,
        l.ZNAME as name,
        l.ZBADGEEMBLEM as color,
        l.ZISSHARED as is_shared,
        l.ZSORTINGSTYLE as sorting_style,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = l.Z_PK) as total_count,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = l.Z_PK AND ZCOMPLETED = 0) as active_count,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = l.Z_PK AND ZCOMPLETED = 1) as completed_count
      FROM ZREMCDOBJECT l
      WHERE l.ZNAME IS NOT NULL
        AND l.Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'REMCDList')
      ORDER BY l.ZNAME
    `;

    const rows = this.db.prepare(query).all();
    
    return rows.map(row => ({
      listId: row.list_id as number,
      name: row.name as string,
      color: row.color as string || undefined,
      isShared: Boolean(row.is_shared),
      totalCount: row.total_count as number,
      activeCount: row.active_count as number,
      completedCount: row.completed_count as number,
      sortingStyle: row.sorting_style as string || undefined
    }));
  }

  /**
   * Get active reminders
   */
  async getActiveReminders(limit?: number): Promise<Reminder[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Enforce result limit if provided
    const safeLimit = limit ? SecurityManager.enforceResultLimit(limit) : undefined;

    let query = `
      SELECT 
        r.Z_PK as reminder_id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZCOMPLETEDDATE as completed_date,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        r.ZLIST as list_id,
        r.ZCREATIONDATE as creation_date,
        r.ZLASTMODIFIEDDATE as modification_date,
        r.ZURL as url,
        r.ZRECURRENCERULE as recurrence_rule,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZCOMPLETED = 0
        AND r.ZTITLE IS NOT NULL
      ORDER BY 
        CASE WHEN r.ZDUEDATE IS NOT NULL THEN 0 ELSE 1 END,
        r.ZDUEDATE ASC,
        r.ZPRIORITY DESC,
        r.ZCREATIONDATE DESC
    `;

    if (safeLimit) {
      query += ` LIMIT ${safeLimit}`;
    }

    const rows = this.db.prepare(query).all();
    
    return rows.map(row => ({
      reminderId: row.reminder_id as number,
      title: row.title as string,
      notes: row.notes as string || undefined,
      isCompleted: false,
      completedDate: undefined,
      dueDate: this.appleToJSDate(row.due_date as number),
      priority: row.priority as number || 0,
      isFlagged: Boolean(row.flagged),
      listId: row.list_id as number || undefined,
      listName: row.list_name as string || undefined,
      creationDate: this.appleToJSDate(row.creation_date as number) || new Date(),
      modificationDate: this.appleToJSDate(row.modification_date as number) || new Date(),
      url: row.url as string || undefined,
      recurrenceRule: row.recurrence_rule as string || undefined
    }));
  }

  /**
   * Get completed reminders
   */
  async getCompletedReminders(daysBack: number = 7, limit: number = 50): Promise<Reminder[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Enforce result limit
    const safeLimit = SecurityManager.enforceResultLimit(limit);

    const cutoffDate = this.jsToAppleDate(new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000)));

    const query = `
      SELECT 
        r.Z_PK as reminder_id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZCOMPLETEDDATE as completed_date,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        r.ZLIST as list_id,
        r.ZCREATIONDATE as creation_date,
        r.ZLASTMODIFIEDDATE as modification_date,
        r.ZURL as url,
        r.ZRECURRENCERULE as recurrence_rule,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZCOMPLETED = 1
        AND r.ZCOMPLETEDDATE > ?
        AND r.ZTITLE IS NOT NULL
      ORDER BY r.ZCOMPLETEDDATE DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(cutoffDate, safeLimit);
    
    return rows.map(row => ({
      reminderId: row.reminder_id as number,
      title: row.title as string,
      notes: row.notes as string || undefined,
      isCompleted: true,
      completedDate: this.appleToJSDate(row.completed_date as number),
      dueDate: this.appleToJSDate(row.due_date as number),
      priority: row.priority as number || 0,
      isFlagged: Boolean(row.flagged),
      listId: row.list_id as number || undefined,
      listName: row.list_name as string || undefined,
      creationDate: this.appleToJSDate(row.creation_date as number) || new Date(),
      modificationDate: this.appleToJSDate(row.modification_date as number) || new Date(),
      url: row.url as string || undefined,
      recurrenceRule: row.recurrence_rule as string || undefined
    }));
  }

  /**
   * Get reminders by list
   */
  async getRemindersByList(listId: number, includeCompleted: boolean = false): Promise<Reminder[]> {
    if (!this.db) throw new Error('Database not connected');

    let query = `
      SELECT 
        r.Z_PK as reminder_id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZCOMPLETEDDATE as completed_date,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        r.ZLIST as list_id,
        r.ZCREATIONDATE as creation_date,
        r.ZLASTMODIFIEDDATE as modification_date,
        r.ZURL as url,
        r.ZRECURRENCERULE as recurrence_rule,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZLIST = ?
        AND r.ZTITLE IS NOT NULL
    `;

    if (!includeCompleted) {
      query += ` AND r.ZCOMPLETED = 0`;
    }

    query += ` ORDER BY r.ZCOMPLETED ASC, r.ZDUEDATE ASC NULLS LAST, r.ZPRIORITY DESC`;

    const rows = this.db.prepare(query).all(listId);
    
    return rows.map(row => ({
      reminderId: row.reminder_id as number,
      title: row.title as string,
      notes: row.notes as string || undefined,
      isCompleted: Boolean(row.completed),
      completedDate: this.appleToJSDate(row.completed_date as number),
      dueDate: this.appleToJSDate(row.due_date as number),
      priority: row.priority as number || 0,
      isFlagged: Boolean(row.flagged),
      listId: row.list_id as number || undefined,
      listName: row.list_name as string || undefined,
      creationDate: this.appleToJSDate(row.creation_date as number) || new Date(),
      modificationDate: this.appleToJSDate(row.modification_date as number) || new Date(),
      url: row.url as string || undefined,
      recurrenceRule: row.recurrence_rule as string || undefined
    }));
  }

  /**
   * Search reminders
   */
  async searchReminders(searchText: string, includeCompleted: boolean = false, limit: number = 50): Promise<ReminderSearchResult[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Sanitize search text
    const sanitizedSearch = SecurityManager.sanitizeSearchQuery(searchText);
    
    // Enforce result limit
    const safeLimit = SecurityManager.enforceResultLimit(limit);

    const searchPattern = `%${sanitizedSearch}%`;

    let query = `
      SELECT 
        r.Z_PK as reminder_id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZCOMPLETEDDATE as completed_date,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        r.ZLIST as list_id,
        r.ZCREATIONDATE as creation_date,
        r.ZLASTMODIFIEDDATE as modification_date,
        r.ZURL as url,
        r.ZRECURRENCERULE as recurrence_rule,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE (r.ZTITLE LIKE ? OR r.ZNOTES LIKE ?)
        AND r.ZTITLE IS NOT NULL
    `;

    if (!includeCompleted) {
      query += ` AND r.ZCOMPLETED = 0`;
    }

    query += ` ORDER BY r.ZCOMPLETED ASC, r.ZLASTMODIFIEDDATE DESC LIMIT ?`;

    const rows = this.db.prepare(query).all(searchPattern, searchPattern, safeLimit);
    
    return rows.map(row => ({
      reminderId: row.reminder_id as number,
      title: row.title as string,
      notes: row.notes as string || undefined,
      isCompleted: Boolean(row.completed),
      completedDate: this.appleToJSDate(row.completed_date as number),
      dueDate: this.appleToJSDate(row.due_date as number),
      priority: row.priority as number || 0,
      isFlagged: Boolean(row.flagged),
      listId: row.list_id as number || undefined,
      listName: row.list_name as string || undefined,
      creationDate: this.appleToJSDate(row.creation_date as number) || new Date(),
      modificationDate: this.appleToJSDate(row.modification_date as number) || new Date(),
      url: row.url as string || undefined,
      recurrenceRule: row.recurrence_rule as string || undefined
    }));
  }

  /**
   * Get upcoming reminders (with due dates)
   */
  async getUpcomingReminders(daysAhead: number = 7): Promise<Reminder[]> {
    if (!this.db) throw new Error('Database not connected');

    const cutoffDate = this.jsToAppleDate(new Date(Date.now() + (daysAhead * 24 * 60 * 60 * 1000)));
    const nowDate = this.jsToAppleDate(new Date());

    const query = `
      SELECT 
        r.Z_PK as reminder_id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZCOMPLETEDDATE as completed_date,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        r.ZLIST as list_id,
        r.ZCREATIONDATE as creation_date,
        r.ZLASTMODIFIEDDATE as modification_date,
        r.ZURL as url,
        r.ZRECURRENCERULE as recurrence_rule,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZCOMPLETED = 0
        AND r.ZDUEDATE IS NOT NULL
        AND r.ZDUEDATE >= ?
        AND r.ZDUEDATE <= ?
        AND r.ZTITLE IS NOT NULL
      ORDER BY r.ZDUEDATE ASC
    `;

    const rows = this.db.prepare(query).all(nowDate, cutoffDate);
    
    return rows.map(row => ({
      reminderId: row.reminder_id as number,
      title: row.title as string,
      notes: row.notes as string || undefined,
      isCompleted: false,
      completedDate: undefined,
      dueDate: this.appleToJSDate(row.due_date as number),
      priority: row.priority as number || 0,
      isFlagged: Boolean(row.flagged),
      listId: row.list_id as number || undefined,
      listName: row.list_name as string || undefined,
      creationDate: this.appleToJSDate(row.creation_date as number) || new Date(),
      modificationDate: this.appleToJSDate(row.modification_date as number) || new Date(),
      url: row.url as string || undefined,
      recurrenceRule: row.recurrence_rule as string || undefined
    }));
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalReminders: number;
    activeReminders: number;
    completedReminders: number;
    overdueReminders: number;
    todayReminders: number;
    flaggedReminders: number;
    totalLists: number;
    remindersByList: Record<string, { total: number; active: number; completed: number }>;
    remindersByPriority: Record<number, number>;
  }> {
    if (!this.db) throw new Error('Database not connected');

    const nowDate = this.jsToAppleDate(new Date());
    const todayStart = this.jsToAppleDate(new Date(new Date().setHours(0, 0, 0, 0)));
    const todayEnd = this.jsToAppleDate(new Date(new Date().setHours(23, 59, 59, 999)));

    // Basic counts
    const basicStats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN ZCOMPLETED = 0 THEN 1 END) as active,
        COUNT(CASE WHEN ZCOMPLETED = 1 THEN 1 END) as completed,
        COUNT(CASE WHEN ZCOMPLETED = 0 AND ZDUEDATE < ? AND ZDUEDATE IS NOT NULL THEN 1 END) as overdue,
        COUNT(CASE WHEN ZCOMPLETED = 0 AND ZDUEDATE >= ? AND ZDUEDATE <= ? THEN 1 END) as today,
        COUNT(CASE WHEN ZFLAGGED = 1 THEN 1 END) as flagged
      FROM ZREMCDREMINDER
      WHERE ZTITLE IS NOT NULL
    `).get(nowDate, todayStart, todayEnd) as any;

    // List count
    const listCount = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM ZREMCDOBJECT
      WHERE Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'REMCDList')
    `).get() as { count: number };

    // Reminders by list
    const listStatsRows = this.db.prepare(`
      SELECT 
        l.ZNAME as list_name,
        COUNT(r.Z_PK) as total,
        COUNT(CASE WHEN r.ZCOMPLETED = 0 THEN 1 END) as active,
        COUNT(CASE WHEN r.ZCOMPLETED = 1 THEN 1 END) as completed
      FROM ZREMCDOBJECT l
      LEFT JOIN ZREMCDREMINDER r ON r.ZLIST = l.Z_PK
      WHERE l.Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'REMCDList')
      GROUP BY l.Z_PK
    `).all();

    const remindersByList: Record<string, { total: number; active: number; completed: number }> = {};
    listStatsRows.forEach(row => {
      if (row.list_name) {
        remindersByList[row.list_name as string] = {
          total: row.total as number,
          active: row.active as number,
          completed: row.completed as number
        };
      }
    });

    // Reminders by priority
    const priorityRows = this.db.prepare(`
      SELECT 
        ZPRIORITY as priority,
        COUNT(*) as count
      FROM ZREMCDREMINDER
      WHERE ZCOMPLETED = 0 AND ZTITLE IS NOT NULL
      GROUP BY ZPRIORITY
    `).all();

    const remindersByPriority: Record<number, number> = {};
    priorityRows.forEach(row => {
      remindersByPriority[row.priority as number || 0] = row.count as number;
    });

    return {
      totalReminders: basicStats.total,
      activeReminders: basicStats.active,
      completedReminders: basicStats.completed,
      overdueReminders: basicStats.overdue,
      todayReminders: basicStats.today,
      flaggedReminders: basicStats.flagged,
      totalLists: listCount.count,
      remindersByList,
      remindersByPriority
    };
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