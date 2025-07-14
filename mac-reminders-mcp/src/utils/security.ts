/**
 * Security utilities for Mac MCP Suite
 * Provides permission checks, input validation, and error sanitization
 */

import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SecurityCheckResult {
  hasAccess: boolean;
  missingPermissions: string[];
  recommendations: string[];
}

export class SecurityManager {
  /**
   * Check if the process has Full Disk Access
   */
  static async checkFullDiskAccess(): Promise<boolean> {
    try {
      // Try to access a protected path that requires Full Disk Access
      const testPath = `${process.env.HOME}/Library/Mail/V10/MailData/Envelope Index`;
      await fs.access(testPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if we have read access to a specific database
   */
  static async checkDatabaseAccess(dbPath: string): Promise<SecurityCheckResult> {
    const result: SecurityCheckResult = {
      hasAccess: false,
      missingPermissions: [],
      recommendations: []
    };

    try {
      await fs.access(dbPath, fs.constants.R_OK);
      result.hasAccess = true;
    } catch (error) {
      result.missingPermissions.push('Read access to database');
      
      // Check if it's a Full Disk Access issue
      if (dbPath.includes('/Library/Mail/')) {
        const hasFullDiskAccess = await this.checkFullDiskAccess();
        if (!hasFullDiskAccess) {
          result.missingPermissions.push('Full Disk Access');
          result.recommendations.push(
            'Grant Full Disk Access to Terminal or this application:',
            '1. Open System Preferences > Security & Privacy > Privacy',
            '2. Click the lock to make changes',
            '3. Select "Full Disk Access" from the left sidebar',
            '4. Add Terminal or this application to the list',
            '5. Restart the application'
          );
        }
      }
      
      // Check if it's a general permission issue
      if (dbPath.includes('/Library/Group Containers/')) {
        result.recommendations.push(
          'Ensure the application has been opened at least once:',
          `- ${dbPath.includes('calendar') ? 'Calendar' : ''}`,
          `- ${dbPath.includes('notes') ? 'Notes' : ''}`,
          `- ${dbPath.includes('reminders') ? 'Reminders' : ''}`
        );
      }
    }

    return result;
  }

  /**
   * Validate date range to prevent resource exhaustion
   */
  static validateDateRange(startDate: Date, endDate: Date): void {
    const maxRangeMs = 365 * 24 * 60 * 60 * 1000; // 1 year
    const rangeMs = endDate.getTime() - startDate.getTime();
    
    if (rangeMs < 0) {
      throw new Error('End date must be after start date');
    }
    
    if (rangeMs > maxRangeMs) {
      throw new Error('Date range cannot exceed 1 year');
    }
  }

  /**
   * Validate and sanitize search queries
   */
  static sanitizeSearchQuery(query: string): string {
    // Remove potentially dangerous SQL keywords
    const dangerousKeywords = [
      'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 
      'CREATE', 'EXEC', 'EXECUTE', '--', '/*', '*/', ';'
    ];
    
    let sanitized = query;
    dangerousKeywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      sanitized = sanitized.replace(regex, '');
    });
    
    // Limit query length
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }
    
    // Escape special characters for LIKE queries
    sanitized = sanitized
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    
    return sanitized.trim();
  }

  /**
   * Limit result set size to prevent memory exhaustion
   */
  static enforceResultLimit(limit?: number): number {
    const MAX_RESULTS = 1000;
    const DEFAULT_RESULTS = 100;
    
    if (!limit || limit <= 0) {
      return DEFAULT_RESULTS;
    }
    
    return Math.min(limit, MAX_RESULTS);
  }

  /**
   * Sanitize error messages to prevent information disclosure
   */
  static sanitizeError(error: Error): Error {
    const sanitizedMessage = error.message
      // Remove file paths
      .replace(/\/Users\/[^/]+/g, '/Users/***')
      .replace(/\/Library\/[^/]+/g, '/Library/***')
      // Remove specific table/column names
      .replace(/table\s+\w+/gi, 'table ***')
      .replace(/column\s+\w+/gi, 'column ***')
      // Remove SQL snippets
      .replace(/SELECT.*FROM/gi, 'SELECT *** FROM ***')
      .replace(/WHERE.*$/gi, 'WHERE ***');
    
    const sanitizedError = new Error(sanitizedMessage);
    sanitizedError.name = error.name;
    return sanitizedError;
  }

  /**
   * Check if running in a secure context
   */
  static async checkSecureContext(): Promise<{
    isSecure: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    
    // Check if running as root (not recommended)
    if (process.getuid && process.getuid() === 0) {
      warnings.push('Running as root is not recommended for security reasons');
    }
    
    // Check if SIP is enabled (recommended)
    try {
      const { stdout } = await execAsync('csrutil status');
      if (!stdout.includes('enabled')) {
        warnings.push('System Integrity Protection (SIP) is disabled - this reduces system security');
      }
    } catch {
      warnings.push('Could not verify System Integrity Protection status');
    }
    
    // Check if FileVault is enabled (recommended for data encryption)
    try {
      const { stdout } = await execAsync('fdesetup status');
      if (!stdout.includes('FileVault is On')) {
        warnings.push('FileVault is not enabled - consider enabling for data encryption at rest');
      }
    } catch {
      warnings.push('Could not verify FileVault status');
    }
    
    return {
      isSecure: warnings.length === 0,
      warnings
    };
  }

  /**
   * Rate limiting implementation
   */
  private static requestCounts = new Map<string, { count: number; resetTime: number }>();
  
  static checkRateLimit(identifier: string, maxRequests: number = 100, windowMs: number = 60000): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(identifier);
    
    if (!record || now > record.resetTime) {
      this.requestCounts.set(identifier, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }
    
    if (record.count >= maxRequests) {
      return false;
    }
    
    record.count++;
    return true;
  }

  /**
   * Audit log for security-relevant operations
   */
  private static auditLog: Array<{
    timestamp: Date;
    operation: string;
    details: any;
  }> = [];
  
  static logAccess(operation: string, details: any): void {
    this.auditLog.push({
      timestamp: new Date(),
      operation,
      details: {
        ...details,
        // Don't log sensitive data
        query: details.query ? '[REDACTED]' : undefined
      }
    });
    
    // Keep only last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
  }
  
  static getAuditLog(limit: number = 100): typeof SecurityManager.auditLog {
    return this.auditLog.slice(-limit);
  }
}