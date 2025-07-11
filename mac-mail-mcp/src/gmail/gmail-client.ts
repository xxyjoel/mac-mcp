import { gmail_v1 } from 'googleapis';
import { GmailAuthManager } from './auth-manager.js';

export interface EmailMessage {
  id: string;
  threadId: string;
  account: string;
  subject: string;
  from: string;
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  date: Date;
  snippet: string;
  body?: string;
  htmlBody?: string;
  labels: string[];
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  attachments?: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface EmailStats {
  account: string;
  totalEmails: number;
  unreadEmails: number;
  starredEmails: number;
  emailsByLabel: Record<string, number>;
  emailsByDate: Record<string, number>;
  topSenders: Array<{ email: string; name: string; count: number }>;
  topThreads: Array<{ subject: string; count: number; lastDate: Date }>;
  attachmentStats: {
    totalAttachments: number;
    totalSize: number;
    byType: Record<string, number>;
  };
}

export interface QueryOptions {
  query?: string;
  maxResults?: number;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  after?: Date;
  before?: Date;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
}

export class GmailClient {
  private authManager: GmailAuthManager;
  private clientCache: Map<string, gmail_v1.Gmail> = new Map();

  constructor(authManager: GmailAuthManager) {
    this.authManager = authManager;
  }

  /**
   * Get Gmail client for account (cached)
   */
  private async getClient(email: string): Promise<gmail_v1.Gmail> {
    if (!this.clientCache.has(email)) {
      const client = await this.authManager.getGmailClient(email);
      this.clientCache.set(email, client);
    }
    return this.clientCache.get(email)!;
  }

  /**
   * Build Gmail search query from options
   */
  private buildQuery(options: QueryOptions): string {
    const parts: string[] = [];

    if (options.query) parts.push(options.query);
    if (options.after) parts.push(`after:${options.after.toISOString().split('T')[0]}`);
    if (options.before) parts.push(`before:${options.before.toISOString().split('T')[0]}`);
    if (options.from) parts.push(`from:${options.from}`);
    if (options.to) parts.push(`to:${options.to}`);
    if (options.subject) parts.push(`subject:${options.subject}`);
    if (options.hasAttachment) parts.push('has:attachment');
    if (options.isUnread) parts.push('is:unread');
    if (options.isStarred) parts.push('is:starred');

    return parts.join(' ');
  }

  /**
   * Parse email message from Gmail API response
   */
  private parseMessage(message: gmail_v1.Schema$Message, account: string): EmailMessage {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';

    // Parse from header
    const fromHeader = getHeader('From');
    const fromMatch = fromHeader.match(/^"?([^"<]+)"?\s*<?([^>]+)>?$/);
    const fromName = fromMatch ? fromMatch[1].trim() : fromHeader;
    const fromEmail = fromMatch ? fromMatch[2].trim() : fromHeader;

    // Get body content
    let body = '';
    let htmlBody = '';
    const parts = this.extractParts(message.payload);
    
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }

    // Get attachments
    const attachments: Attachment[] = [];
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId
        });
      }
    }

    return {
      id: message.id!,
      threadId: message.threadId!,
      account,
      subject: getHeader('Subject'),
      from: fromEmail,
      fromName,
      to: getHeader('To').split(',').map(e => e.trim()),
      cc: getHeader('Cc') ? getHeader('Cc').split(',').map(e => e.trim()) : undefined,
      bcc: getHeader('Bcc') ? getHeader('Bcc').split(',').map(e => e.trim()) : undefined,
      date: new Date(parseInt(message.internalDate!)),
      snippet: message.snippet || '',
      body,
      htmlBody,
      labels: message.labelIds || [],
      isRead: !message.labelIds?.includes('UNREAD'),
      isStarred: message.labelIds?.includes('STARRED') || false,
      hasAttachments: attachments.length > 0,
      attachments
    };
  }

  /**
   * Extract all parts from message payload (recursive)
   */
  private extractParts(payload?: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart[] {
    if (!payload) return [];
    
    const parts: gmail_v1.Schema$MessagePart[] = [];
    
    if (payload.parts) {
      for (const part of payload.parts) {
        parts.push(...this.extractParts(part));
      }
    } else {
      parts.push(payload);
    }
    
    return parts;
  }

  /**
   * List messages from one or all accounts
   */
  async listMessages(accounts?: string[], options: QueryOptions = {}): Promise<EmailMessage[]> {
    const targetAccounts = accounts || this.authManager.getAccounts();
    const allMessages: EmailMessage[] = [];

    await Promise.all(targetAccounts.map(async (email) => {
      try {
        const gmail = await this.getClient(email);
        const query = this.buildQuery(options);

        const response = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: options.maxResults || 100,
          labelIds: options.labelIds,
          includeSpamTrash: options.includeSpamTrash
        });

        if (response.data.messages) {
          // Get full message details
          const messages = await Promise.all(
            response.data.messages.map(msg =>
              gmail.users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: 'full'
              })
            )
          );

          for (const msg of messages) {
            allMessages.push(this.parseMessage(msg.data, email));
          }
        }
      } catch (error) {
        console.error(`Error fetching messages for ${email}:`, error);
      }
    }));

    // Sort by date descending
    return allMessages.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Get detailed statistics for accounts
   */
  async getStats(accounts?: string[], options: QueryOptions = {}): Promise<EmailStats[]> {
    const messages = await this.listMessages(accounts, options);
    const statsByAccount = new Map<string, EmailStats>();

    for (const msg of messages) {
      if (!statsByAccount.has(msg.account)) {
        statsByAccount.set(msg.account, {
          account: msg.account,
          totalEmails: 0,
          unreadEmails: 0,
          starredEmails: 0,
          emailsByLabel: {},
          emailsByDate: {},
          topSenders: [],
          topThreads: [],
          attachmentStats: {
            totalAttachments: 0,
            totalSize: 0,
            byType: {}
          }
        });
      }

      const stats = statsByAccount.get(msg.account)!;
      
      // Basic counts
      stats.totalEmails++;
      if (!msg.isRead) stats.unreadEmails++;
      if (msg.isStarred) stats.starredEmails++;

      // Labels
      for (const label of msg.labels) {
        stats.emailsByLabel[label] = (stats.emailsByLabel[label] || 0) + 1;
      }

      // By date
      const dateKey = msg.date.toISOString().split('T')[0];
      stats.emailsByDate[dateKey] = (stats.emailsByDate[dateKey] || 0) + 1;

      // Attachments
      if (msg.attachments) {
        for (const att of msg.attachments) {
          stats.attachmentStats.totalAttachments++;
          stats.attachmentStats.totalSize += att.size;
          const type = att.mimeType.split('/')[0];
          stats.attachmentStats.byType[type] = (stats.attachmentStats.byType[type] || 0) + 1;
        }
      }
    }

    // Calculate top senders and threads
    for (const stats of statsByAccount.values()) {
      const senderCounts = new Map<string, { name: string; count: number }>();
      const threadSubjects = new Map<string, { count: number; lastDate: Date }>();

      const accountMessages = messages.filter(m => m.account === stats.account);
      
      for (const msg of accountMessages) {
        // Top senders
        const senderKey = msg.from;
        if (!senderCounts.has(senderKey)) {
          senderCounts.set(senderKey, { name: msg.fromName, count: 0 });
        }
        senderCounts.get(senderKey)!.count++;

        // Top threads
        if (!threadSubjects.has(msg.threadId)) {
          threadSubjects.set(msg.threadId, { count: 0, lastDate: msg.date });
        }
        const thread = threadSubjects.get(msg.threadId)!;
        thread.count++;
        if (msg.date > thread.lastDate) thread.lastDate = msg.date;
      }

      // Convert to arrays and sort
      stats.topSenders = Array.from(senderCounts.entries())
        .map(([email, data]) => ({ email, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const threadMap = new Map<string, string>();
      accountMessages.forEach(m => threadMap.set(m.threadId, m.subject));
      
      stats.topThreads = Array.from(threadSubjects.entries())
        .map(([threadId, data]) => ({
          subject: threadMap.get(threadId) || 'Unknown',
          ...data
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    return Array.from(statsByAccount.values());
  }

  /**
   * Send a reply to an email
   */
  async sendReply(
    account: string,
    originalMessageId: string,
    replyBody: string,
    options: {
      cc?: string[];
      bcc?: string[];
      attachments?: Array<{ filename: string; mimeType: string; data: string }>;
    } = {}
  ): Promise<void> {
    const gmail = await this.getClient(account);

    // Get original message
    const original = await gmail.users.messages.get({
      userId: 'me',
      id: originalMessageId,
      format: 'full'
    });

    const headers = original.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';

    // Build reply
    const subject = getHeader('Subject');
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const messageId = getHeader('Message-ID');
    const references = getHeader('References') || messageId;

    // Create email
    const email = [
      `From: ${account}`,
      `To: ${getHeader('From')}`,
      options.cc ? `Cc: ${options.cc.join(', ')}` : '',
      options.bcc ? `Bcc: ${options.bcc.join(', ')}` : '',
      `Subject: ${replySubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${references} ${messageId}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      replyBody
    ].filter(Boolean).join('\r\n');

    const encodedEmail = Buffer.from(email).toString('base64url');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
        threadId: original.data.threadId
      }
    });
  }

  /**
   * Send a new email
   */
  async sendEmail(
    account: string,
    to: string[],
    subject: string,
    body: string,
    options: {
      cc?: string[];
      bcc?: string[];
      attachments?: Array<{ filename: string; mimeType: string; data: string }>;
    } = {}
  ): Promise<void> {
    const gmail = await this.getClient(account);

    const email = [
      `From: ${account}`,
      `To: ${to.join(', ')}`,
      options.cc ? `Cc: ${options.cc.join(', ')}` : '',
      options.bcc ? `Bcc: ${options.bcc.join(', ')}` : '',
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].filter(Boolean).join('\r\n');

    const encodedEmail = Buffer.from(email).toString('base64url');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });
  }

  /**
   * Mark messages as read/unread
   */
  async markAsRead(account: string, messageIds: string[], read: boolean = true): Promise<void> {
    const gmail = await this.getClient(account);

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: messageIds,
        addLabelIds: read ? [] : ['UNREAD'],
        removeLabelIds: read ? ['UNREAD'] : []
      }
    });
  }

  /**
   * Star/unstar messages
   */
  async star(account: string, messageIds: string[], starred: boolean = true): Promise<void> {
    const gmail = await this.getClient(account);

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: messageIds,
        addLabelIds: starred ? ['STARRED'] : [],
        removeLabelIds: starred ? [] : ['STARRED']
      }
    });
  }

  /**
   * Get labels for an account
   */
  async getLabels(account: string): Promise<gmail_v1.Schema$Label[]> {
    const gmail = await this.getClient(account);
    const response = await gmail.users.labels.list({ userId: 'me' });
    return response.data.labels || [];
  }
}