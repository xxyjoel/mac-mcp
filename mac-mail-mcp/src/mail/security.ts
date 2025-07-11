import { exec } from "child_process";
import { promisify } from "util";
import * as cheerio from 'cheerio';

const execAsync = promisify(exec);

export class SecurityManager {
  private static grantedPermissions = new Set<string>();

  async checkPermissions(permission: string): Promise<void> {
    // Check if we've already verified this permission in this session
    if (SecurityManager.grantedPermissions.has(permission)) {
      return;
    }

    if (permission !== "mail.read") {
      throw new Error(`Invalid permission requested: ${permission}`);
    }

    // Test if we can access Mail
    const testScript = `
      tell application "Mail"
        try
          count of accounts
          return "granted"
        on error
          return "denied"
        end try
      end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${testScript}'`, {
        timeout: 5000,
      });

      if (stdout.trim() === "denied") {
        throw new Error(
          "Mail access denied. Please grant permission in System Preferences > Security & Privacy > Privacy > Automation"
        );
      }

      // Cache the successful permission check
      SecurityManager.grantedPermissions.add(permission);
    } catch (error: any) {
      throw new Error(`Failed to check Mail permissions: ${error.message}`);
    }
  }

  /**
   * Sanitize email content to prevent script injection and XSS
   */
  sanitizeEmailContent(content: string): string {
    // Remove potentially dangerous scripts
    let sanitized = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove event handlers
    sanitized = sanitized.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
    
    // Remove javascript: protocols
    sanitized = sanitized.replace(/javascript:/gi, '');
    
    // Remove data URIs that could contain scripts
    sanitized = sanitized.replace(/data:text\/html[^,]*,/gi, '');
    
    return sanitized;
  }

  /**
   * Convert HTML email to plain text for safer display
   */
  htmlToPlainText(html: string): string {
    try {
      const $ = cheerio.load(html);
      
      // Remove script and style elements
      $('script, style').remove();
      
      // Convert links to show URL
      $('a').each((_, elem) => {
        const $elem = $(elem);
        const href = $elem.attr('href');
        const text = $elem.text();
        if (href && href !== text) {
          $elem.replaceWith(`${text} (${href})`);
        }
      });
      
      // Convert line breaks
      $('br').replaceWith('\n');
      $('p').append('\n\n');
      $('div').append('\n');
      
      // Get text content
      let text = $.text();
      
      // Clean up excessive whitespace
      text = text.replace(/\n{3,}/g, '\n\n');
      text = text.trim();
      
      return text;
    } catch (error) {
      // If parsing fails, return sanitized original
      return this.sanitizeEmailContent(html);
    }
  }

  /**
   * Validate email addresses to prevent injection
   */
  validateEmailAddress(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sanitize folder names to prevent path traversal
   */
  sanitizeFolderName(folderName: string): string {
    // Remove path traversal attempts
    return folderName.replace(/\.\./g, '').replace(/[\/\\]/g, '_');
  }

  /**
   * Check if content size is within safe limits
   */
  checkContentSize(content: string, maxSizeKB: number = 1024): void {
    const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
    if (sizeKB > maxSizeKB) {
      throw new Error(`Content size ${sizeKB.toFixed(2)}KB exceeds maximum allowed size of ${maxSizeKB}KB`);
    }
  }

  /**
   * Rate limiting check
   */
  private static requestCounts = new Map<string, { count: number; resetTime: number }>();
  
  checkRateLimit(operation: string, maxRequests: number = 100, windowMs: number = 60000): void {
    const now = Date.now();
    const key = operation;
    
    const current = SecurityManager.requestCounts.get(key);
    
    if (!current || now > current.resetTime) {
      SecurityManager.requestCounts.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return;
    }
    
    if (current.count >= maxRequests) {
      const waitTime = Math.ceil((current.resetTime - now) / 1000);
      throw new Error(`Rate limit exceeded for ${operation}. Please wait ${waitTime} seconds.`);
    }
    
    current.count++;
  }
}