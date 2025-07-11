import { MacMailMessage } from './mac-mail-db.js';

export interface UnifiedMessage {
  id: string;
  globalMessageId?: number;
  messageIdHeader?: string;
  subject: string;
  from: string;
  to?: string[];
  cc?: string[];
  date: Date;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  account: string;
  accountType: string;
  mailbox: string;
  source: 'mac-mail' | 'imap';
  textContent?: string;
  htmlContent?: string;
  remoteId?: string;
  conversationId?: number;
  originalData?: any;
}

export interface DeduplicationStats {
  totalMessages: number;
  uniqueMessages: number;
  duplicatesRemoved: number;
  bySource: {
    macMail: number;
    imap: number;
  };
  deduplicationMethods: {
    globalMessageId: number;
    messageIdHeader: number;
    contentHash: number;
    fuzzyMatch: number;
  };
}

export class MessageDeduplicator {
  private seenGlobalIds = new Set<number>();
  private seenMessageIds = new Set<string>();
  private seenContentHashes = new Set<string>();
  private fuzzyMatches = new Map<string, UnifiedMessage>();

  /**
   * Deduplicate a collection of messages from multiple sources
   */
  deduplicate(messages: UnifiedMessage[]): {
    uniqueMessages: UnifiedMessage[];
    stats: DeduplicationStats;
  } {
    const uniqueMessages: UnifiedMessage[] = [];
    const stats: DeduplicationStats = {
      totalMessages: messages.length,
      uniqueMessages: 0,
      duplicatesRemoved: 0,
      bySource: { macMail: 0, imap: 0 },
      deduplicationMethods: {
        globalMessageId: 0,
        messageIdHeader: 0,
        contentHash: 0,
        fuzzyMatch: 0
      }
    };

    // Clear previous state
    this.reset();

    // Sort by date (newest first) to prefer newer messages in case of duplicates
    const sortedMessages = [...messages].sort((a, b) => b.date.getTime() - a.date.getTime());

    for (const message of sortedMessages) {
      const isDuplicate = this.isDuplicate(message, stats);
      
      if (!isDuplicate) {
        uniqueMessages.push(message);
        this.recordMessage(message);
      }

      // Update source statistics
      if (message.source === 'mac-mail') {
        stats.bySource.macMail++;
      } else {
        stats.bySource.imap++;
      }
    }

    stats.uniqueMessages = uniqueMessages.length;
    stats.duplicatesRemoved = stats.totalMessages - stats.uniqueMessages;

    return { uniqueMessages, stats };
  }

  /**
   * Check if a message is a duplicate using multiple strategies
   */
  private isDuplicate(message: UnifiedMessage, stats: DeduplicationStats): boolean {
    // Strategy 1: Global Message ID (Mac Mail specific)
    if (message.globalMessageId && this.seenGlobalIds.has(message.globalMessageId)) {
      stats.deduplicationMethods.globalMessageId++;
      return true;
    }

    // Strategy 2: Message-ID header (RFC standard)
    if (message.messageIdHeader && this.seenMessageIds.has(message.messageIdHeader)) {
      stats.deduplicationMethods.messageIdHeader++;
      return true;
    }

    // Strategy 3: Content hash (for messages without proper IDs)
    const contentHash = this.generateContentHash(message);
    if (this.seenContentHashes.has(contentHash)) {
      stats.deduplicationMethods.contentHash++;
      return true;
    }

    // Strategy 4: Fuzzy matching (similar subject + sender + date within window)
    const fuzzyKey = this.generateFuzzyKey(message);
    const existingMessage = this.fuzzyMatches.get(fuzzyKey);
    if (existingMessage && this.isFuzzyMatch(message, existingMessage)) {
      stats.deduplicationMethods.fuzzyMatch++;
      return true;
    }

    return false;
  }

  /**
   * Record a message as seen to prevent future duplicates
   */
  private recordMessage(message: UnifiedMessage): void {
    if (message.globalMessageId) {
      this.seenGlobalIds.add(message.globalMessageId);
    }

    if (message.messageIdHeader) {
      this.seenMessageIds.add(message.messageIdHeader);
    }

    const contentHash = this.generateContentHash(message);
    this.seenContentHashes.add(contentHash);

    const fuzzyKey = this.generateFuzzyKey(message);
    this.fuzzyMatches.set(fuzzyKey, message);
  }

  /**
   * Generate a content-based hash for messages
   */
  private generateContentHash(message: UnifiedMessage): string {
    const content = [
      message.subject?.toLowerCase().trim(),
      message.from?.toLowerCase().trim(),
      message.date.toISOString().substring(0, 16), // Date to minute precision
      message.account?.toLowerCase()
    ].filter(Boolean).join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Generate a fuzzy matching key for similar message detection
   */
  private generateFuzzyKey(message: UnifiedMessage): string {
    // Normalize subject by removing common prefixes and whitespace
    const normalizedSubject = (message.subject || '')
      .toLowerCase()
      .replace(/^(re:|fwd?:|fw:)\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50);

    const normalizedSender = (message.from || '')
      .toLowerCase()
      .replace(/<[^>]+>/, '')
      .replace(/["\s]/g, '')
      .trim();

    // Group by hour to catch near-duplicate sends
    const hourKey = new Date(message.date).toISOString().substring(0, 13);

    return `${normalizedSubject}|${normalizedSender}|${hourKey}`;
  }

  /**
   * Check if two messages are fuzzy matches
   */
  private isFuzzyMatch(message1: UnifiedMessage, message2: UnifiedMessage): boolean {
    // Must be from same sender
    if (this.normalizeSender(message1.from) !== this.normalizeSender(message2.from)) {
      return false;
    }

    // Must have similar subjects
    if (this.calculateSimilarity(message1.subject || '', message2.subject || '') < 0.8) {
      return false;
    }

    // Must be within 24 hours of each other
    const timeDiff = Math.abs(message1.date.getTime() - message2.date.getTime());
    if (timeDiff > 24 * 60 * 60 * 1000) {
      return false;
    }

    return true;
  }

  /**
   * Normalize sender for comparison
   */
  private normalizeSender(sender: string): string {
    return (sender || '')
      .toLowerCase()
      .replace(/<[^>]+>/, '')
      .replace(/["\s]/g, '')
      .trim();
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const matrix = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,     // deletion
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }

    const maxLength = Math.max(s1.length, s2.length);
    return (maxLength - matrix[s2.length][s1.length]) / maxLength;
  }

  /**
   * Convert Mac Mail message to unified format
   */
  static fromMacMail(message: MacMailMessage): UnifiedMessage {
    return {
      id: `mac-mail-${message.messageId}`,
      globalMessageId: message.globalMessageId,
      messageIdHeader: message.messageIdHeader,
      subject: message.subject,
      from: message.sender,
      date: message.dateReceived,
      isRead: message.isRead,
      isFlagged: message.isFlagged,
      hasAttachments: message.hasAttachments,
      account: message.accountName,
      accountType: message.accountType,
      mailbox: message.mailboxName,
      source: 'mac-mail',
      remoteId: message.remoteId,
      conversationId: message.conversationId,
      originalData: message
    };
  }

  /**
   * Convert IMAP message to unified format
   */
  static fromIMAP(message: any): UnifiedMessage {
    return {
      id: `imap-${message.account}-${message.date?.getTime() || Date.now()}`,
      messageIdHeader: message.messageId,
      subject: message.subject || '(no subject)',
      from: message.from || 'Unknown',
      to: message.to ? [message.to] : undefined,
      date: message.date || new Date(),
      isRead: message.isRead || false,
      isFlagged: message.isFlagged || false,
      hasAttachments: message.hasAttachments || false,
      account: message.account,
      accountType: 'IMAP',
      mailbox: 'INBOX',
      source: 'imap',
      textContent: message.textContent,
      htmlContent: message.htmlContent,
      originalData: message
    };
  }

  /**
   * Reset internal state for fresh deduplication
   */
  private reset(): void {
    this.seenGlobalIds.clear();
    this.seenMessageIds.clear();
    this.seenContentHashes.clear();
    this.fuzzyMatches.clear();
  }

  /**
   * Find potential duplicates without removing them
   */
  findPotentialDuplicates(messages: UnifiedMessage[]): {
    duplicateGroups: UnifiedMessage[][];
    stats: DeduplicationStats;
  } {
    const duplicateGroups: UnifiedMessage[][] = [];
    const processed = new Set<string>();
    
    const { uniqueMessages, stats } = this.deduplicate(messages);
    
    // Find groups of similar messages
    for (const message of messages) {
      if (processed.has(message.id)) continue;
      
      const group = [message];
      processed.add(message.id);
      
      for (const other of messages) {
        if (processed.has(other.id) || message.id === other.id) continue;
        
        if (this.areRelated(message, other)) {
          group.push(other);
          processed.add(other.id);
        }
      }
      
      if (group.length > 1) {
        duplicateGroups.push(group);
      }
    }
    
    return { duplicateGroups, stats };
  }

  /**
   * Check if two messages are related (potential duplicates)
   */
  private areRelated(msg1: UnifiedMessage, msg2: UnifiedMessage): boolean {
    // Same global message ID
    if (msg1.globalMessageId && msg2.globalMessageId && msg1.globalMessageId === msg2.globalMessageId) {
      return true;
    }
    
    // Same message ID header
    if (msg1.messageIdHeader && msg2.messageIdHeader && msg1.messageIdHeader === msg2.messageIdHeader) {
      return true;
    }
    
    // Fuzzy match
    return this.isFuzzyMatch(msg1, msg2);
  }
}