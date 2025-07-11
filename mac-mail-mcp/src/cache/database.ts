import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { MailMessage, MailFolder } from '../mail/client.js';

export class MailCache {
  private db: Database.Database;
  private readonly CACHE_DIR = join(homedir(), '.mac-mail-mcp');
  private readonly DB_PATH = join(this.CACHE_DIR, 'mail-cache.db');
  
  // Cache TTLs
  private readonly FOLDER_TTL = 60 * 60 * 1000; // 1 hour for folder list
  private readonly MESSAGE_LIST_TTL = 5 * 60 * 1000; // 5 minutes for message lists
  private readonly MESSAGE_CONTENT_TTL = 24 * 60 * 60 * 1000; // 24 hours for message content
  private readonly SEARCH_TTL = 2 * 60 * 1000; // 2 minutes for search results
  
  constructor() {
    // Ensure cache directory exists
    mkdirSync(this.CACHE_DIR, { recursive: true });
    
    // Open database
    this.db = new Database(this.DB_PATH);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Create tables
    this.initializeTables();
    
    // Prepare statements
    this.prepareStatements();
  }
  
  private initializeTables(): void {
    // Folders table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        name TEXT,
        account_name TEXT,
        message_count INTEGER,
        unread_count INTEGER,
        cached_at INTEGER,
        PRIMARY KEY (name, account_name)
      )
    `);
    
    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        subject TEXT,
        sender TEXT,
        sender_name TEXT,
        recipients TEXT, -- JSON array
        date_sent TEXT,
        date_received TEXT,
        content TEXT,
        snippet TEXT,
        mailbox TEXT,
        account_name TEXT,
        is_read INTEGER,
        is_flagged INTEGER,
        has_attachments INTEGER,
        cached_at INTEGER
      )
    `);
    
    // Message lists cache (for pagination)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS message_lists (
        cache_key TEXT PRIMARY KEY,
        message_ids TEXT, -- JSON array
        total_count INTEGER,
        cached_at INTEGER
      )
    `);
    
    // Search results cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        query TEXT,
        search_in TEXT,
        result_ids TEXT, -- JSON array
        cached_at INTEGER,
        PRIMARY KEY (query, search_in)
      )
    `);
    
    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox, account_name);
      CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date_received);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
    `);
  }
  
  private statements: any = {};
  
  private prepareStatements(): void {
    // Folder statements
    this.statements.insertFolder = this.db.prepare(`
      INSERT OR REPLACE INTO folders (name, account_name, message_count, unread_count, cached_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    this.statements.getFolders = this.db.prepare(`
      SELECT * FROM folders WHERE cached_at > ?
    `);
    
    // Message statements
    this.statements.insertMessage = this.db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, subject, sender, sender_name, recipients, date_sent, date_received,
        content, snippet, mailbox, account_name, is_read, is_flagged, has_attachments, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    this.statements.getMessage = this.db.prepare(`
      SELECT * FROM messages WHERE id = ? AND cached_at > ?
    `);
    
    this.statements.getMessageList = this.db.prepare(`
      SELECT * FROM message_lists WHERE cache_key = ? AND cached_at > ?
    `);
    
    this.statements.insertMessageList = this.db.prepare(`
      INSERT OR REPLACE INTO message_lists (cache_key, message_ids, total_count, cached_at)
      VALUES (?, ?, ?, ?)
    `);
    
    // Search statements
    this.statements.getSearchCache = this.db.prepare(`
      SELECT result_ids FROM search_cache 
      WHERE query = ? AND search_in = ? AND cached_at > ?
    `);
    
    this.statements.insertSearchCache = this.db.prepare(`
      INSERT OR REPLACE INTO search_cache (query, search_in, result_ids, cached_at)
      VALUES (?, ?, ?, ?)
    `);
  }
  
  // Folder operations
  cacheFolders(folders: MailFolder[]): void {
    const now = Date.now();
    const insertMany = this.db.transaction((folders: MailFolder[]) => {
      for (const folder of folders) {
        this.statements.insertFolder.run(
          folder.name,
          folder.accountName,
          folder.messageCount,
          folder.unreadCount,
          now
        );
      }
    });
    
    insertMany(folders);
  }
  
  getCachedFolders(): MailFolder[] | null {
    const minTime = Date.now() - this.FOLDER_TTL;
    const rows = this.statements.getFolders.all(minTime);
    
    if (rows.length === 0) return null;
    
    return rows.map((row: any) => ({
      name: row.name,
      accountName: row.account_name,
      messageCount: row.message_count,
      unreadCount: row.unread_count
    }));
  }
  
  // Message operations
  cacheMessage(message: MailMessage): void {
    this.statements.insertMessage.run(
      message.id,
      message.subject,
      message.sender,
      message.senderName || null,
      JSON.stringify(message.recipients),
      message.dateSent,
      message.dateReceived,
      message.content || null,
      message.snippet || null,
      message.mailbox,
      message.accountName,
      message.isRead ? 1 : 0,
      message.isFlagged ? 1 : 0,
      message.hasAttachments ? 1 : 0,
      Date.now()
    );
  }
  
  cacheMessages(messages: MailMessage[]): void {
    const insertMany = this.db.transaction((messages: MailMessage[]) => {
      for (const message of messages) {
        this.cacheMessage(message);
      }
    });
    
    insertMany(messages);
  }
  
  getCachedMessage(id: string, includeContent: boolean = true): MailMessage | null {
    const ttl = includeContent ? this.MESSAGE_CONTENT_TTL : this.MESSAGE_LIST_TTL;
    const minTime = Date.now() - ttl;
    const row = this.statements.getMessage.get(id, minTime);
    
    if (!row) return null;
    
    return {
      id: row.id,
      subject: row.subject,
      sender: row.sender,
      senderName: row.sender_name,
      recipients: JSON.parse(row.recipients),
      dateSent: row.date_sent,
      dateReceived: row.date_received,
      content: includeContent ? row.content : undefined,
      snippet: row.snippet,
      mailbox: row.mailbox,
      accountName: row.account_name,
      isRead: row.is_read === 1,
      isFlagged: row.is_flagged === 1,
      hasAttachments: row.has_attachments === 1
    };
  }
  
  // Message list caching for pagination
  cacheMessageList(cacheKey: string, messageIds: string[], totalCount: number): void {
    this.statements.insertMessageList.run(
      cacheKey,
      JSON.stringify(messageIds),
      totalCount,
      Date.now()
    );
  }
  
  getCachedMessageList(cacheKey: string): { messageIds: string[], totalCount: number } | null {
    const minTime = Date.now() - this.MESSAGE_LIST_TTL;
    const row = this.statements.getMessageList.get(cacheKey, minTime);
    
    if (!row) return null;
    
    return {
      messageIds: JSON.parse(row.message_ids),
      totalCount: row.total_count
    };
  }
  
  // Search caching
  cacheSearchResults(query: string, searchIn: string, messageIds: string[]): void {
    this.statements.insertSearchCache.run(
      query,
      searchIn,
      JSON.stringify(messageIds),
      Date.now()
    );
  }
  
  getCachedSearchResults(query: string, searchIn: string): string[] | null {
    const minTime = Date.now() - this.SEARCH_TTL;
    const row = this.statements.getSearchCache.get(query, searchIn, minTime);
    
    if (!row) return null;
    
    return JSON.parse(row.result_ids);
  }
  
  // Cleanup old cache entries
  cleanup(): void {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    this.db.exec(`
      DELETE FROM folders WHERE cached_at < ${oneDayAgo};
      DELETE FROM messages WHERE cached_at < ${oneDayAgo};
      DELETE FROM message_lists WHERE cached_at < ${oneDayAgo};
      DELETE FROM search_cache WHERE cached_at < ${oneDayAgo};
    `);
    
    // Optimize database
    this.db.exec('VACUUM');
  }
  
  // Get cache statistics
  getStats(): { folders: number, messages: number, searches: number, sizeKB: number } {
    const folders = (this.db.prepare('SELECT COUNT(*) as count FROM folders').get() as any).count;
    const messages = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any).count;
    const searches = (this.db.prepare('SELECT COUNT(*) as count FROM search_cache').get() as any).count;
    
    // Get database size
    const pageCount = (this.db.prepare('PRAGMA page_count').get() as any).page_count || 0;
    const pageSize = (this.db.prepare('PRAGMA page_size').get() as any).page_size || 4096;
    const sizeKB = (pageCount * pageSize) / 1024;
    
    return { folders, messages, searches, sizeKB };
  }
  
  close(): void {
    this.db.close();
  }
}