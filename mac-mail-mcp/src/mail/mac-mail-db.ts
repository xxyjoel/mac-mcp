import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { SecurityManager } from '../utils/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MacMailMessage {
  messageId: number;
  globalMessageId: number;
  subject: string;
  sender: string;
  dateReceived: Date;
  dateSent: Date;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  mailboxName: string;
  accountName: string;
  accountType: string;
  emlxPath?: string;
  messageIdHeader?: string;
  conversationId?: number;
  remoteId?: string;
}

export interface MacMailbox {
  mailboxId: string;
  name: string;
  url: string;
  accountUuid: string;
  accountType: string;
  unseenCount: number;
}

export interface MacMailAccount {
  uuid: string;
  name: string;
  type: string;
  mailboxes: MacMailbox[];
}

export class MacMailDatabase {
  private db: Database.Database | null = null;
  private mailVersion: string = 'V10';
  private mailDataPath: string;
  
  constructor() {
    this.mailDataPath = path.join(os.homedir(), 'Library', 'Mail', this.mailVersion);
  }

  /**
   * Connect to the Mac Mail SQLite database
   */
  async connect(): Promise<void> {
    try {
      // Check if Mail data directory exists
      const envelopeIndexPath = path.join(this.mailDataPath, 'MailData', 'Envelope Index');
      
      // Security check: Verify database access
      const securityCheck = await SecurityManager.checkDatabaseAccess(envelopeIndexPath);
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
      
      await fs.access(envelopeIndexPath);
      
      // Open the database in read-only mode
      this.db = new Database(envelopeIndexPath, { readonly: true, fileMustExist: true });
      
      // Test the connection
      const result = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      console.log(`Connected to Mac Mail database with ${result.count.toLocaleString()} total messages`);
      
      // Log access for audit purposes
      SecurityManager.logAccess('mail_database_connect', {
        totalMessages: result.count,
        timestamp: new Date()
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Mac Mail database not found. Please ensure Mail.app is configured and Terminal has Full Disk Access permission.`);
      }
      throw SecurityManager.sanitizeError(error);
    }
  }

  /**
   * Get all mailboxes and their associated accounts
   */
  async getMailboxes(): Promise<MacMailAccount[]> {
    if (!this.db) throw new Error('Database not connected');

    const query = `
      SELECT 
        m.ROWID as mailbox_id,
        m.url as mailbox_url,
        m.unseen_count,
        m.unread_count
      FROM mailboxes m
      WHERE m.url IS NOT NULL
      ORDER BY m.url
    `;

    const rows = this.db.prepare(query).all();
    const accountMap = new Map<string, MacMailAccount>();

    for (const row of rows) {
      const url = row.mailbox_url as string;
      const accountUuid = this.extractAccountUuidFromUrl(url);
      const accountType = this.getAccountTypeFromUrl(url);
      
      if (!accountMap.has(accountUuid)) {
        accountMap.set(accountUuid, {
          uuid: accountUuid,
          name: await this.getAccountName(accountUuid),
          type: accountType,
          mailboxes: []
        });
      }

      const account = accountMap.get(accountUuid)!;
      account.mailboxes.push({
        mailboxId: row.mailbox_id.toString(),
        name: this.extractMailboxNameFromUrl(url),
        url: url,
        accountUuid: accountUuid,
        accountType: accountType,
        unseenCount: row.unseen_count || 0
      });
    }

    return Array.from(accountMap.values());
  }

  /**
   * Get recent messages from last N days
   */
  async getRecentMessages(daysBack: number = 2, limit: number = 1000): Promise<MacMailMessage[]> {
    if (!this.db) throw new Error('Database not connected');

    const cutoffTimestamp = Math.floor((Date.now() - (daysBack * 24 * 60 * 60 * 1000)) / 1000);

    const query = `
      SELECT DISTINCT
        m.ROWID as message_id,
        m.global_message_id,
        COALESCE(s.subject, '[No Subject]') as subject,
        COALESCE(a.address, a.comment, '[Unknown]') as sender,
        m.date_received,
        m.date_sent,
        m.read as is_read,
        m.flagged as is_flagged,
        CASE WHEN att.message IS NOT NULL THEN 1 ELSE 0 END as has_attachments,
        mb.url as mailbox_url,
        m.remote_id,
        m.conversation_id
      FROM messages m
      LEFT JOIN subjects s ON m.subject = s.ROWID
      LEFT JOIN addresses a ON m.sender = a.ROWID
      LEFT JOIN mailboxes mb ON m.mailbox = mb.ROWID
      LEFT JOIN (
        SELECT DISTINCT message 
        FROM attachments 
        WHERE message IS NOT NULL
      ) att ON m.ROWID = att.message
      WHERE m.date_received > ?
      ORDER BY m.date_received DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(cutoffTimestamp, limit);
    const messages: MacMailMessage[] = [];

    for (const row of rows) {
      const mailboxUrl = row.mailbox_url as string;
      const accountUuid = this.extractAccountUuidFromUrl(mailboxUrl);
      
      messages.push({
        messageId: row.message_id as number,
        globalMessageId: row.global_message_id as number,
        subject: row.subject as string,
        sender: row.sender as string,
        dateReceived: new Date((row.date_received as number) * 1000),
        dateSent: new Date((row.date_sent as number) * 1000),
        isRead: Boolean(row.is_read),
        isFlagged: Boolean(row.is_flagged),
        hasAttachments: Boolean(row.has_attachments),
        mailboxName: this.extractMailboxNameFromUrl(mailboxUrl),
        accountName: await this.getAccountName(accountUuid),
        accountType: this.getAccountTypeFromUrl(mailboxUrl),
        conversationId: row.conversation_id as number,
        remoteId: row.remote_id as string
      });
    }

    return messages;
  }

  /**
   * Check for duplicate messages using various identifiers
   */
  async findDuplicates(messages: MacMailMessage[]): Promise<Set<number>> {
    if (!this.db) throw new Error('Database not connected');

    const duplicateIds = new Set<number>();
    
    // Check duplicates_unread_count table
    const duplicateQuery = `
      SELECT DISTINCT message_id 
      FROM duplicates_unread_count 
      WHERE message_id IN (${messages.map(() => '?').join(',')})
    `;
    
    const messageIds = messages.map(m => m.globalMessageId);
    const duplicateRows = this.db.prepare(duplicateQuery).all(...messageIds);
    
    duplicateRows.forEach(row => {
      duplicateIds.add(row.message_id as number);
    });

    return duplicateIds;
  }

  /**
   * Get message statistics
   */
  async getStatistics(): Promise<{
    totalMessages: number;
    totalAccounts: number;
    totalMailboxes: number;
    unreadMessages: number;
    flaggedMessages: number;
  }> {
    if (!this.db) throw new Error('Database not connected');

    const stats = {
      totalMessages: 0,
      totalAccounts: 0,
      totalMailboxes: 0,
      unreadMessages: 0,
      flaggedMessages: 0
    };

    // Total messages
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    stats.totalMessages = messageCount.count;

    // Unread messages (read = 0 means unread)
    const unreadCount = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE read = 0').get() as { count: number };
    stats.unreadMessages = unreadCount.count;

    // Flagged messages (flagged = 1 means flagged)
    const flaggedCount = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE flagged = 1').get() as { count: number };
    stats.flaggedMessages = flaggedCount.count;

    // Unique accounts and mailboxes
    const accounts = await this.getMailboxes();
    stats.totalAccounts = accounts.length;
    stats.totalMailboxes = accounts.reduce((sum, acc) => sum + acc.mailboxes.length, 0);

    return stats;
  }

  /**
   * Extract account UUID from mailbox URL
   */
  private extractAccountUuidFromUrl(url: string): string {
    const match = url.match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i);
    return match ? match[0] : 'unknown';
  }

  /**
   * Extract mailbox name from URL
   */
  private extractMailboxNameFromUrl(url: string): string {
    const parts = url.split('/');
    return parts[parts.length - 1] || 'Unknown';
  }

  /**
   * Get account type from URL scheme
   */
  private getAccountTypeFromUrl(url: string): string {
    if (url.startsWith('imap://')) return 'IMAP';
    if (url.startsWith('ews://')) return 'Exchange';
    if (url.startsWith('pop://')) return 'POP3';
    if (url.startsWith('file://')) return 'Local';
    return 'Unknown';
  }

  /**
   * Get human-readable account name
   */
  private async getAccountName(accountUuid: string): Promise<string> {
    try {
      // Try to read account info from Account.plist
      const accountPath = path.join(this.mailDataPath, accountUuid, 'Account.plist');
      
      // For now, return UUID, but could be enhanced to parse plist
      return accountUuid.substring(0, 8) + '...';
    } catch {
      return accountUuid.substring(0, 8) + '...';
    }
  }

  /**
   * Get unseen count for a mailbox
   */
  private async getUnseenCount(mailboxId: number): Promise<number> {
    if (!this.db) return 0;

    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE mailbox = ? AND read = 0').get(mailboxId) as { count: number };
      return result.count;
    } catch {
      return 0;
    }
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