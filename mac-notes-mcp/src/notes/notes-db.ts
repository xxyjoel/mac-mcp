import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { SecurityManager } from '../../../src/utils/security.js';

// Apple's Core Foundation epoch starts at 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200;

export interface Note {
  noteId: number;
  title: string;
  creationDate: Date;
  modificationDate: Date;
  folderId?: number;
  folderName?: string;
  isPasswordProtected: boolean;
  isPinned: boolean;
  hasAttachments: boolean;
  snippet?: string;
}

export interface NoteFolder {
  folderId: number;
  name: string;
  parentId?: number;
  noteCount: number;
  creationDate: Date;
  modificationDate: Date;
}

export interface NoteSearchResult extends Note {
  relevanceScore?: number;
}

export class NotesDatabase {
  private db: Database.Database | null = null;
  private notesDbPath: string;

  constructor() {
    this.notesDbPath = path.join(
      os.homedir(),
      'Library',
      'Group Containers',
      'group.com.apple.notes',
      'NoteStore.sqlite'
    );
  }

  /**
   * Connect to the Notes SQLite database
   */
  async connect(): Promise<void> {
    try {
      // Security check: Verify database access
      const securityCheck = await SecurityManager.checkDatabaseAccess(this.notesDbPath);
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
      
      await fs.access(this.notesDbPath);
      
      this.db = new Database(this.notesDbPath, { 
        readonly: true, 
        fileMustExist: true 
      });
      
      // Test connection
      const result = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM ZICCLOUDSYNCINGOBJECT 
        WHERE Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote')
      `).get() as { count: number };
      
      console.log(`Connected to Notes database with ${result.count} notes`);
      
      // Log access for audit purposes
      SecurityManager.logAccess('notes_database_connect', {
        totalNotes: result.count,
        timestamp: new Date()
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Notes database not found. Please ensure Notes.app is configured.`);
      }
      throw SecurityManager.sanitizeError(error);
    }
  }

  /**
   * Convert Apple Core Foundation date to JavaScript Date
   */
  private appleToJSDate(appleTime: number | null): Date {
    if (!appleTime || appleTime === 0) return new Date(0);
    return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
  }

  /**
   * Get all folders
   */
  async getFolders(): Promise<NoteFolder[]> {
    if (!this.db) throw new Error('Database not connected');

    // Get the entity ID for folders
    const folderEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICFolder'
    `).get() as { Z_ENT: number };

    const query = `
      SELECT 
        f.Z_PK as folder_id,
        f.ZTITLE as name,
        f.ZPARENT as parent_id,
        f.ZCREATIONDATE as creation_date,
        f.ZMODIFICATIONDATE as modification_date,
        (
          SELECT COUNT(*) 
          FROM ZICCLOUDSYNCINGOBJECT n 
          WHERE n.ZFOLDER = f.Z_PK 
            AND n.Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote')
        ) as note_count
      FROM ZICCLOUDSYNCINGOBJECT f
      WHERE f.Z_ENT = ?
        AND f.ZTITLE IS NOT NULL
      ORDER BY f.ZTITLE
    `;

    const rows = this.db.prepare(query).all(folderEntity.Z_ENT);
    
    return rows.map(row => ({
      folderId: row.folder_id as number,
      name: row.name as string,
      parentId: row.parent_id as number || undefined,
      noteCount: row.note_count as number,
      creationDate: this.appleToJSDate(row.creation_date as number),
      modificationDate: this.appleToJSDate(row.modification_date as number)
    }));
  }

  /**
   * Get recent notes
   */
  async getRecentNotes(limit: number = 20, daysBack?: number): Promise<Note[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Enforce result limit
    const safeLimit = SecurityManager.enforceResultLimit(limit);

    // Get the entity ID for notes
    const noteEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'
    `).get() as { Z_ENT: number };

    let query = `
      SELECT 
        n.Z_PK as note_id,
        n.ZTITLE as title,
        n.ZCREATIONDATE as creation_date,
        n.ZMODIFICATIONDATE as modification_date,
        n.ZFOLDER as folder_id,
        n.ZPASSWORDPROTECTED as password_protected,
        n.ZPINNEDDATE as pinned_date,
        n.ZSNIPPET as snippet,
        f.ZTITLE as folder_name,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM ZICCLOUDSYNCINGOBJECT a 
            WHERE a.ZNOTE = n.Z_PK 
              AND a.Z_ENT IN (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME LIKE '%Attachment%')
          ) THEN 1 
          ELSE 0 
        END as has_attachments
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
      WHERE n.Z_ENT = ?
        AND n.ZTITLE IS NOT NULL
    `;

    const params: any[] = [noteEntity.Z_ENT];

    if (daysBack) {
      const cutoffTime = (Date.now() / 1000) - APPLE_EPOCH_OFFSET - (daysBack * 24 * 60 * 60);
      query += ` AND n.ZMODIFICATIONDATE > ?`;
      params.push(cutoffTime);
    }

    query += ` ORDER BY n.ZMODIFICATIONDATE DESC LIMIT ?`;
    params.push(safeLimit);

    const rows = this.db.prepare(query).all(...params);
    
    return rows.map(row => ({
      noteId: row.note_id as number,
      title: row.title as string || '(Untitled)',
      creationDate: this.appleToJSDate(row.creation_date as number),
      modificationDate: this.appleToJSDate(row.modification_date as number),
      folderId: row.folder_id as number || undefined,
      folderName: row.folder_name as string || undefined,
      isPasswordProtected: Boolean(row.password_protected),
      isPinned: row.pinned_date !== null && row.pinned_date > 0,
      hasAttachments: Boolean(row.has_attachments),
      snippet: row.snippet as string || undefined
    }));
  }

  /**
   * Search notes by title
   */
  async searchNotes(searchText: string, limit: number = 50): Promise<NoteSearchResult[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Sanitize search text
    const sanitizedSearch = SecurityManager.sanitizeSearchQuery(searchText);
    
    // Enforce result limit
    const safeLimit = SecurityManager.enforceResultLimit(limit);

    const noteEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'
    `).get() as { Z_ENT: number };

    const searchPattern = `%${sanitizedSearch}%`;

    const query = `
      SELECT 
        n.Z_PK as note_id,
        n.ZTITLE as title,
        n.ZCREATIONDATE as creation_date,
        n.ZMODIFICATIONDATE as modification_date,
        n.ZFOLDER as folder_id,
        n.ZPASSWORDPROTECTED as password_protected,
        n.ZPINNEDDATE as pinned_date,
        n.ZSNIPPET as snippet,
        f.ZTITLE as folder_name,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM ZICCLOUDSYNCINGOBJECT a 
            WHERE a.ZNOTE = n.Z_PK 
              AND a.Z_ENT IN (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME LIKE '%Attachment%')
          ) THEN 1 
          ELSE 0 
        END as has_attachments
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
      WHERE n.Z_ENT = ?
        AND (n.ZTITLE LIKE ? OR n.ZSNIPPET LIKE ?)
        AND n.ZTITLE IS NOT NULL
      ORDER BY n.ZMODIFICATIONDATE DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(
      noteEntity.Z_ENT,
      searchPattern,
      searchPattern,
      safeLimit
    );
    
    return rows.map(row => ({
      noteId: row.note_id as number,
      title: row.title as string || '(Untitled)',
      creationDate: this.appleToJSDate(row.creation_date as number),
      modificationDate: this.appleToJSDate(row.modification_date as number),
      folderId: row.folder_id as number || undefined,
      folderName: row.folder_name as string || undefined,
      isPasswordProtected: Boolean(row.password_protected),
      isPinned: row.pinned_date !== null && row.pinned_date > 0,
      hasAttachments: Boolean(row.has_attachments),
      snippet: row.snippet as string || undefined
    }));
  }

  /**
   * Get notes by folder
   */
  async getNotesByFolder(folderId: number, limit?: number): Promise<Note[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Enforce result limit if provided
    const safeLimit = limit ? SecurityManager.enforceResultLimit(limit) : undefined;

    const noteEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'
    `).get() as { Z_ENT: number };

    let query = `
      SELECT 
        n.Z_PK as note_id,
        n.ZTITLE as title,
        n.ZCREATIONDATE as creation_date,
        n.ZMODIFICATIONDATE as modification_date,
        n.ZFOLDER as folder_id,
        n.ZPASSWORDPROTECTED as password_protected,
        n.ZPINNEDDATE as pinned_date,
        n.ZSNIPPET as snippet,
        f.ZTITLE as folder_name,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM ZICCLOUDSYNCINGOBJECT a 
            WHERE a.ZNOTE = n.Z_PK 
              AND a.Z_ENT IN (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME LIKE '%Attachment%')
          ) THEN 1 
          ELSE 0 
        END as has_attachments
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
      WHERE n.Z_ENT = ?
        AND n.ZFOLDER = ?
        AND n.ZTITLE IS NOT NULL
      ORDER BY n.ZMODIFICATIONDATE DESC
    `;

    const params: any[] = [noteEntity.Z_ENT, folderId];

    if (safeLimit) {
      query += ` LIMIT ?`;
      params.push(safeLimit);
    }

    const rows = this.db.prepare(query).all(...params);
    
    return rows.map(row => ({
      noteId: row.note_id as number,
      title: row.title as string || '(Untitled)',
      creationDate: this.appleToJSDate(row.creation_date as number),
      modificationDate: this.appleToJSDate(row.modification_date as number),
      folderId: row.folder_id as number || undefined,
      folderName: row.folder_name as string || undefined,
      isPasswordProtected: Boolean(row.password_protected),
      isPinned: row.pinned_date !== null && row.pinned_date > 0,
      hasAttachments: Boolean(row.has_attachments),
      snippet: row.snippet as string || undefined
    }));
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalNotes: number;
    totalFolders: number;
    passwordProtectedNotes: number;
    notesWithAttachments: number;
    pinnedNotes: number;
    notesByFolder: Record<string, number>;
  }> {
    if (!this.db) throw new Error('Database not connected');

    const noteEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'
    `).get() as { Z_ENT: number };

    const folderEntity = this.db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICFolder'
    `).get() as { Z_ENT: number };

    // Basic counts
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_notes,
        COUNT(CASE WHEN ZPASSWORDPROTECTED = 1 THEN 1 END) as password_protected,
        COUNT(CASE WHEN ZPINNEDDATE IS NOT NULL AND ZPINNEDDATE > 0 THEN 1 END) as pinned
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ?
    `).get(noteEntity.Z_ENT) as any;

    // Folder count
    const folderCount = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ?
    `).get(folderEntity.Z_ENT) as { count: number };

    // Notes with attachments
    const attachmentCount = this.db.prepare(`
      SELECT COUNT(DISTINCT n.Z_PK) as count
      FROM ZICCLOUDSYNCINGOBJECT n
      WHERE n.Z_ENT = ?
        AND EXISTS (
          SELECT 1 FROM ZICCLOUDSYNCINGOBJECT a 
          WHERE a.ZNOTE = n.Z_PK 
            AND a.Z_ENT IN (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME LIKE '%Attachment%')
        )
    `).get(noteEntity.Z_ENT) as { count: number };

    // Notes by folder
    const notesByFolderRows = this.db.prepare(`
      SELECT 
        f.ZTITLE as folder_name,
        COUNT(n.Z_PK) as note_count
      FROM ZICCLOUDSYNCINGOBJECT f
      LEFT JOIN ZICCLOUDSYNCINGOBJECT n ON n.ZFOLDER = f.Z_PK AND n.Z_ENT = ?
      WHERE f.Z_ENT = ?
      GROUP BY f.Z_PK
      ORDER BY note_count DESC
    `).all(noteEntity.Z_ENT, folderEntity.Z_ENT);

    const notesByFolder: Record<string, number> = {};
    notesByFolderRows.forEach(row => {
      if (row.folder_name) {
        notesByFolder[row.folder_name as string] = row.note_count as number;
      }
    });

    return {
      totalNotes: stats.total_notes,
      totalFolders: folderCount.count,
      passwordProtectedNotes: stats.password_protected,
      notesWithAttachments: attachmentCount.count,
      pinnedNotes: stats.pinned,
      notesByFolder
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