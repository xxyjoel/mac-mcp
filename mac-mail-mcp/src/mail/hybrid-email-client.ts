import { MacMailDatabase, MacMailMessage } from './mac-mail-db.js';
import { EmlxParser, EmlxMessage } from './emlx-parser.js';
import { MessageDeduplicator, UnifiedMessage, DeduplicationStats } from './message-deduplicator.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface HybridEmailStats {
  totalMessages: number;
  uniqueMessages: number;
  unreadMessages: number;
  flaggedMessages: number;
  byAccount: Record<string, {
    total: number;
    unread: number;
    source: 'mac-mail' | 'imap';
    accountType: string;
  }>;
  bySource: {
    macMail: number;
    imap: number;
  };
  topSenders: Array<{
    sender: string;
    count: number;
  }>;
  deduplicationStats: DeduplicationStats;
}

export interface HybridQueryOptions {
  daysBack?: number;
  limit?: number;
  includeContent?: boolean;
  accounts?: string[];
  mailboxes?: string[];
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
}

export class HybridEmailClient {
  private macMailDb: MacMailDatabase;
  private emlxParser: EmlxParser;
  private deduplicator: MessageDeduplicator;
  private imapConfig: any;

  constructor() {
    this.macMailDb = new MacMailDatabase();
    this.emlxParser = new EmlxParser();
    this.deduplicator = new MessageDeduplicator();
    this.loadImapConfig();
  }

  /**
   * Initialize the hybrid client
   */
  async initialize(): Promise<void> {
    await this.macMailDb.connect();
  }

  /**
   * Get unified messages from both Mac Mail and IMAP sources
   */
  async getMessages(options: HybridQueryOptions = {}): Promise<UnifiedMessage[]> {
    const {
      daysBack = 2,
      limit = 1000,
      includeContent = false,
      accounts = [],
      unreadOnly = false,
      flaggedOnly = false
    } = options;

    console.log(`🔀 Fetching messages from hybrid sources (${daysBack} days back)...`);
    
    const allMessages: UnifiedMessage[] = [];

    // Step 1: Get Mac Mail messages
    try {
      console.log('📱 Querying Mac Mail database...');
      const macMessages = await this.macMailDb.getRecentMessages(daysBack, limit);
      
      // Convert to unified format
      for (const macMessage of macMessages) {
        const unifiedMessage = MessageDeduplicator.fromMacMail(macMessage);
        
        // Apply filters
        if (unreadOnly && unifiedMessage.isRead) continue;
        if (flaggedOnly && !unifiedMessage.isFlagged) continue;
        if (accounts.length > 0 && !accounts.some(acc => unifiedMessage.account.includes(acc))) continue;

        // Add content if requested
        if (includeContent) {
          await this.addMessageContent(unifiedMessage, macMessage);
        }

        allMessages.push(unifiedMessage);
      }
      
      console.log(`  ✅ Found ${macMessages.length} Mac Mail messages`);
    } catch (error) {
      console.warn(`  ⚠️  Mac Mail query failed: ${error.message}`);
    }

    // Step 2: Get IMAP messages (if configured)
    if (this.imapConfig?.accounts?.length > 0) {
      try {
        console.log('📧 Querying IMAP accounts...');
        const imapMessages = await this.getImapMessages(daysBack, limit, accounts);
        
        for (const imapMessage of imapMessages) {
          const unifiedMessage = MessageDeduplicator.fromIMAP(imapMessage);
          
          // Apply filters
          if (unreadOnly && unifiedMessage.isRead) continue;
          if (flaggedOnly && !unifiedMessage.isFlagged) continue;

          allMessages.push(unifiedMessage);
        }
        
        console.log(`  ✅ Found ${imapMessages.length} IMAP messages`);
      } catch (error) {
        console.warn(`  ⚠️  IMAP query failed: ${error.message}`);
      }
    }

    // Step 3: Deduplicate messages
    console.log('🔀 Deduplicating messages...');
    const { uniqueMessages } = this.deduplicator.deduplicate(allMessages);
    
    console.log(`  ✅ ${uniqueMessages.length} unique messages after deduplication`);
    
    // Sort by date (newest first)
    uniqueMessages.sort((a, b) => b.date.getTime() - a.date.getTime());
    
    return uniqueMessages.slice(0, limit);
  }

  /**
   * Get comprehensive email statistics
   */
  async getStatistics(options: HybridQueryOptions = {}): Promise<HybridEmailStats> {
    const messages = await this.getMessages({ ...options, includeContent: false });
    const { stats: deduplicationStats } = this.deduplicator.deduplicate(messages);
    
    const stats: HybridEmailStats = {
      totalMessages: messages.length,
      uniqueMessages: messages.length,
      unreadMessages: messages.filter(m => !m.isRead).length,
      flaggedMessages: messages.filter(m => m.isFlagged).length,
      byAccount: {},
      bySource: {
        macMail: messages.filter(m => m.source === 'mac-mail').length,
        imap: messages.filter(m => m.source === 'imap').length
      },
      topSenders: [],
      deduplicationStats
    };

    // Calculate by-account statistics
    messages.forEach(message => {
      const account = message.account;
      if (!stats.byAccount[account]) {
        stats.byAccount[account] = {
          total: 0,
          unread: 0,
          source: message.source,
          accountType: message.accountType
        };
      }
      
      stats.byAccount[account].total++;
      if (!message.isRead) {
        stats.byAccount[account].unread++;
      }
    });

    // Calculate top senders
    const senderCounts: Record<string, number> = {};
    messages.forEach(message => {
      const sender = this.normalizeSender(message.from);
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;
    });

    stats.topSenders = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([sender, count]) => ({ sender, count }));

    return stats;
  }

  /**
   * Search messages across all sources
   */
  async searchMessages(query: string, options: HybridQueryOptions = {}): Promise<UnifiedMessage[]> {
    const messages = await this.getMessages({ ...options, includeContent: true });
    const searchTerms = query.toLowerCase().split(/\s+/);
    
    return messages.filter(message => {
      const searchableText = [
        message.subject,
        message.from,
        message.textContent,
        message.htmlContent
      ].join(' ').toLowerCase();
      
      return searchTerms.every(term => searchableText.includes(term));
    });
  }

  /**
   * Get message content from EMLX file
   */
  private async addMessageContent(unifiedMessage: UnifiedMessage, macMessage: MacMailMessage): Promise<void> {
    try {
      const accountUuid = this.extractAccountUuid(macMessage);
      const emlxPath = this.emlxParser.getEmlxPath(accountUuid, macMessage.mailboxName, macMessage.messageId);
      
      if (await this.emlxParser.emlxExists(accountUuid, macMessage.mailboxName, macMessage.messageId)) {
        const emlxMessage = await this.emlxParser.parseEmlxFile(emlxPath);
        unifiedMessage.textContent = emlxMessage.textContent;
        unifiedMessage.htmlContent = emlxMessage.htmlContent;
        unifiedMessage.to = emlxMessage.to;
        unifiedMessage.cc = emlxMessage.cc;
      }
    } catch (error) {
      console.warn(`Failed to load EMLX content for message ${macMessage.messageId}: ${error.message}`);
    }
  }

  /**
   * Get IMAP messages using existing infrastructure
   */
  private async getImapMessages(daysBack: number, limit: number, targetAccounts: string[]): Promise<any[]> {
    // This would integrate with the existing IMAP client
    // For now, return empty array as placeholder
    return [];
  }

  /**
   * Load IMAP configuration
   */
  private loadImapConfig(): void {
    try {
      const configPath = join(__dirname, '../../.imap-accounts.json');
      if (existsSync(configPath)) {
        this.imapConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch (error) {
      console.warn('Failed to load IMAP config:', error.message);
    }
  }

  /**
   * Extract account UUID from Mac Mail message
   */
  private extractAccountUuid(message: MacMailMessage): string {
    // This would need to be implemented based on how we store account mapping
    // For now, return a placeholder
    return 'unknown-account-uuid';
  }

  /**
   * Normalize sender for statistics
   */
  private normalizeSender(sender: string): string {
    return sender
      .replace(/<[^>]+>/, '')
      .replace(/"/g, '')
      .trim();
  }

  /**
   * Find duplicate messages across sources
   */
  async findDuplicates(options: HybridQueryOptions = {}): Promise<{
    duplicateGroups: UnifiedMessage[][];
    stats: DeduplicationStats;
  }> {
    const messages = await this.getMessages(options);
    return this.deduplicator.findPotentialDuplicates(messages);
  }

  /**
   * Get available accounts from all sources
   */
  async getAvailableAccounts(): Promise<Array<{
    name: string;
    type: string;
    source: 'mac-mail' | 'imap';
    messageCount?: number;
  }>> {
    const accounts: Array<{
      name: string;
      type: string;
      source: 'mac-mail' | 'imap';
      messageCount?: number;
    }> = [];

    // Get Mac Mail accounts
    try {
      const macAccounts = await this.macMailDb.getMailboxes();
      macAccounts.forEach(account => {
        accounts.push({
          name: account.name,
          type: account.type,
          source: 'mac-mail',
          messageCount: account.mailboxes.reduce((sum, mb) => sum + mb.unseenCount, 0)
        });
      });
    } catch (error) {
      console.warn('Failed to get Mac Mail accounts:', error.message);
    }

    // Get IMAP accounts
    if (this.imapConfig?.accounts) {
      this.imapConfig.accounts.forEach(account => {
        accounts.push({
          name: account.name,
          type: 'IMAP',
          source: 'imap'
        });
      });
    }

    return accounts;
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.macMailDb.close();
  }
}