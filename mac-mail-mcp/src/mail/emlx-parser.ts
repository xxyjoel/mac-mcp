import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface EmlxMessage {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  date: Date;
  contentType: string;
  textContent?: string;
  htmlContent?: string;
  attachments: EmlxAttachment[];
  headers: Record<string, string>;
  metadata: EmlxMetadata;
}

export interface EmlxAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface EmlxMetadata {
  conversationId?: number;
  dateLastViewed?: Date;
  dateReceived: Date;
  flags: number;
  remoteId?: string;
}

export class EmlxParser {
  private mailDataPath: string;

  constructor(mailVersion: string = 'V10') {
    this.mailDataPath = path.join(os.homedir(), 'Library', 'Mail', mailVersion);
  }

  /**
   * Parse an EMLX file given its full path
   */
  async parseEmlxFile(emlxPath: string): Promise<EmlxMessage> {
    try {
      const content = await fs.readFile(emlxPath, 'utf-8');
      return this.parseEmlxContent(content);
    } catch (error) {
      throw new Error(`Failed to read EMLX file ${emlxPath}: ${error.message}`);
    }
  }

  /**
   * Parse EMLX content string
   */
  parseEmlxContent(content: string): EmlxMessage {
    // EMLX format: byte count + email content + XML metadata
    const lines = content.split('\n');
    
    // First line contains the byte count
    const byteCount = parseInt(lines[0].trim());
    if (isNaN(byteCount)) {
      throw new Error('Invalid EMLX format: missing byte count');
    }

    // Find the XML metadata at the end
    const xmlStartIndex = content.lastIndexOf('<?xml');
    if (xmlStartIndex === -1) {
      throw new Error('Invalid EMLX format: missing XML metadata');
    }

    // Extract email content and XML metadata
    const emailContent = content.substring(content.indexOf('\n') + 1, xmlStartIndex).trim();
    const xmlContent = content.substring(xmlStartIndex);

    // Parse XML metadata
    const metadata = this.parseXmlMetadata(xmlContent);

    // Parse email headers and body
    const { headers, body } = this.parseEmailContent(emailContent);

    // Extract common headers
    const messageId = headers['message-id'] || '';
    const from = headers['from'] || '';
    const to = this.parseAddressList(headers['to'] || '');
    const cc = this.parseAddressList(headers['cc'] || '');
    const bcc = this.parseAddressList(headers['bcc'] || '');
    const subject = this.decodeHeader(headers['subject'] || '');
    const date = new Date(headers['date'] || metadata.dateReceived);
    const contentType = headers['content-type'] || 'text/plain';

    // Parse body content
    const { textContent, htmlContent, attachments } = this.parseBody(body, contentType);

    return {
      messageId,
      from: this.decodeHeader(from),
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      date,
      contentType,
      textContent,
      htmlContent,
      attachments,
      headers,
      metadata
    };
  }

  /**
   * Build EMLX file path from Mac Mail database info
   */
  buildEmlxPath(accountUuid: string, mailboxPath: string, messageId: number): string {
    // Extract relative path components from mailbox URL
    // Example: "imap://joel%40bottlecosts.com@imap.gmail.com/INBOX" 
    // becomes "INBOX.mbox"
    
    const urlParts = mailboxPath.split('/');
    const mailboxName = urlParts[urlParts.length - 1] || 'INBOX';
    const mboxName = mailboxName === 'INBOX' ? 'INBOX.mbox' : `${mailboxName}.mbox`;
    
    // Mac Mail stores messages in a hierarchical structure
    // Example: ~/Library/Mail/V10/{account-uuid}/{mailbox}.mbox/{sub-folders}/Data/{dirs}/Messages/{id}.emlx
    
    // Generate directory structure based on message ID
    const idStr = messageId.toString();
    const dirLevels = Math.max(3, Math.ceil(idStr.length / 2));
    const dirs = [];
    
    for (let i = 0; i < dirLevels && i * 2 < idStr.length; i++) {
      const start = i * 2;
      const end = Math.min(start + 2, idStr.length);
      dirs.push(idStr.substring(start, end));
    }
    
    return path.join(
      this.mailDataPath,
      accountUuid,
      mboxName,
      'Data',
      ...dirs,
      'Messages',
      `${messageId}.emlx`
    );
  }

  /**
   * Parse XML metadata from EMLX file
   */
  private parseXmlMetadata(xmlContent: string): EmlxMetadata {
    const metadata: EmlxMetadata = {
      dateReceived: new Date(),
      flags: 0
    };

    try {
      // Simple regex parsing for plist XML
      const conversationMatch = xmlContent.match(/<key>conversation-id<\/key>\s*<integer>(\d+)<\/integer>/);
      if (conversationMatch) {
        metadata.conversationId = parseInt(conversationMatch[1]);
      }

      const dateLastViewedMatch = xmlContent.match(/<key>date-last-viewed<\/key>\s*<integer>(\d+)<\/integer>/);
      if (dateLastViewedMatch) {
        metadata.dateLastViewed = new Date(parseInt(dateLastViewedMatch[1]) * 1000);
      }

      const dateReceivedMatch = xmlContent.match(/<key>date-received<\/key>\s*<integer>(\d+)<\/integer>/);
      if (dateReceivedMatch) {
        metadata.dateReceived = new Date(parseInt(dateReceivedMatch[1]) * 1000);
      }

      const flagsMatch = xmlContent.match(/<key>flags<\/key>\s*<integer>(\d+)<\/integer>/);
      if (flagsMatch) {
        metadata.flags = parseInt(flagsMatch[1]);
      }

      const remoteIdMatch = xmlContent.match(/<key>remote-id<\/key>\s*<string>([^<]+)<\/string>/);
      if (remoteIdMatch) {
        metadata.remoteId = remoteIdMatch[1];
      }
    } catch (error) {
      console.warn('Failed to parse XML metadata:', error.message);
    }

    return metadata;
  }

  /**
   * Parse email content into headers and body
   */
  private parseEmailContent(content: string): { headers: Record<string, string>; body: string } {
    const lines = content.split('\n');
    const headers: Record<string, string> = {};
    let headerComplete = false;
    let currentHeader = '';
    let bodyStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!headerComplete) {
        if (line.trim() === '') {
          headerComplete = true;
          bodyStart = i + 1;
          break;
        }

        // Check if this is a header continuation
        if (line.match(/^\s+/) && currentHeader) {
          headers[currentHeader] += ' ' + line.trim();
        } else {
          // New header
          const headerMatch = line.match(/^([^:]+):\s*(.*)$/);
          if (headerMatch) {
            currentHeader = headerMatch[1].toLowerCase();
            headers[currentHeader] = headerMatch[2];
          }
        }
      }
    }

    const body = lines.slice(bodyStart).join('\n');
    return { headers, body };
  }

  /**
   * Parse email body content
   */
  private parseBody(body: string, contentType: string): {
    textContent?: string;
    htmlContent?: string;
    attachments: EmlxAttachment[];
  } {
    const attachments: EmlxAttachment[] = [];
    let textContent: string | undefined;
    let htmlContent: string | undefined;

    if (contentType.includes('multipart/')) {
      // Parse multipart content
      const boundaryMatch = contentType.match(/boundary=([^;]+)/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1].replace(/"/g, '');
        const parts = body.split(`--${boundary}`);

        for (const part of parts) {
          if (part.trim() === '' || part.trim() === '--') continue;

          const { headers: partHeaders, body: partBody } = this.parseEmailContent(part);
          const partContentType = partHeaders['content-type'] || '';

          if (partContentType.includes('text/plain')) {
            textContent = this.decodeContent(partBody, partHeaders['content-transfer-encoding']);
          } else if (partContentType.includes('text/html')) {
            htmlContent = this.decodeContent(partBody, partHeaders['content-transfer-encoding']);
          } else if (partHeaders['content-disposition']?.includes('attachment')) {
            const filenameMatch = partHeaders['content-disposition'].match(/filename=([^;]+)/);
            if (filenameMatch) {
              attachments.push({
                filename: filenameMatch[1].replace(/"/g, ''),
                contentType: partContentType,
                size: partBody.length,
                contentId: partHeaders['content-id']
              });
            }
          }
        }
      }
    } else {
      // Single part message
      if (contentType.includes('text/html')) {
        htmlContent = this.decodeContent(body, '');
      } else {
        textContent = this.decodeContent(body, '');
      }
    }

    return { textContent, htmlContent, attachments };
  }

  /**
   * Decode content based on transfer encoding
   */
  private decodeContent(content: string, encoding?: string): string {
    if (!encoding) return content;

    switch (encoding.toLowerCase()) {
      case 'quoted-printable':
        return content
          .replace(/=\r?\n/g, '')
          .replace(/=([A-F0-9]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      case 'base64':
        try {
          return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf-8');
        } catch {
          return content;
        }
      default:
        return content;
    }
  }

  /**
   * Decode RFC 2047 encoded headers
   */
  private decodeHeader(header: string): string {
    return header.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (match, charset, encoding, encoded) => {
      try {
        if (encoding.toUpperCase() === 'B') {
          return Buffer.from(encoded, 'base64').toString('utf-8');
        } else if (encoding.toUpperCase() === 'Q') {
          return encoded.replace(/_/g, ' ').replace(/=([A-F0-9]{2})/g, (m, hex) => 
            String.fromCharCode(parseInt(hex, 16))
          );
        }
      } catch {
        // Fall back to original if decoding fails
      }
      return match;
    });
  }

  /**
   * Parse comma-separated address list
   */
  private parseAddressList(addresses: string): string[] {
    if (!addresses.trim()) return [];
    
    return addresses
      .split(',')
      .map(addr => this.decodeHeader(addr.trim()))
      .filter(addr => addr.length > 0);
  }

  /**
   * Check if EMLX file exists for given message
   */
  async emlxExists(accountUuid: string, mailboxPath: string, messageId: number): Promise<boolean> {
    const emlxPath = this.buildEmlxPath(accountUuid, mailboxPath, messageId);
    try {
      await fs.access(emlxPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get EMLX file path for message
   */
  getEmlxPath(accountUuid: string, mailboxPath: string, messageId: number): string {
    return this.buildEmlxPath(accountUuid, mailboxPath, messageId);
  }
}