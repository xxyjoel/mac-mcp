# Security Guide for Mac MCP Suite

This document outlines the security considerations, best practices, and implementation details for the Mac MCP Suite.

## Table of Contents

- [Overview](#overview)
- [Security Architecture](#security-architecture)
- [Data Access & Privacy](#data-access--privacy)
- [Permission Model](#permission-model)
- [Security Features](#security-features)
- [Best Practices](#best-practices)
- [Threat Model](#threat-model)
- [Incident Response](#incident-response)

## Overview

Mac MCP Suite provides read-only access to local macOS application databases. Security is a top priority, with multiple layers of protection to ensure user data remains safe.

### Core Security Principles

1. **Read-Only Access**: All database connections are read-only
2. **Local Only**: No network communication or data transmission
3. **Minimal Permissions**: Only request necessary permissions
4. **Transparent Operation**: All actions are logged and auditable
5. **User Control**: Users maintain full control over access

## Security Architecture

### Database Access Model

```
User Request → MCP Server → Security Manager → SQLite (Read-Only) → Response
                               ↓
                          Permission Check
                          Input Validation
                          Rate Limiting
                          Audit Logging
```

### Component Isolation

Each MCP server runs as a separate process with:
- No shared memory between services
- Independent permission scopes
- Isolated database connections
- Service-specific rate limiting

## Data Access & Privacy

### What We Access

| Service | Database Location | Data Type |
|---------|------------------|-----------|
| Mail | `~/Library/Mail/V10/MailData/Envelope Index` | Email metadata only |
| Calendar | `~/Library/Group Containers/group.com.apple.calendar/` | Event data |
| Notes | `~/Library/Group Containers/group.com.apple.notes/` | Note titles and metadata |
| Reminders | `~/Library/Group Containers/group.com.apple.reminders/` | Reminder data |

### What We DON'T Access

- Email bodies or attachments
- Note content (only titles/metadata)
- Passwords or authentication tokens
- iCloud credentials
- System keychain
- Network connections

### Data Handling

- **No Data Storage**: We don't store any user data
- **No Data Transmission**: All operations are local
- **No Data Modification**: Read-only access enforced
- **Memory Cleanup**: Sensitive data cleared after use

## Permission Model

### macOS Permissions Required

1. **Full Disk Access** (Mail only)
   - Required for `~/Library/Mail/` access
   - Granted through System Preferences
   - Can be revoked at any time

2. **Standard App Permissions** (Calendar, Notes, Reminders)
   - Granted on first access
   - Managed by macOS Privacy framework
   - User prompted automatically

### Permission Verification

```javascript
// Built-in permission checking
const securityCheck = await SecurityManager.checkDatabaseAccess(dbPath);
if (!securityCheck.hasAccess) {
  // Detailed error with remediation steps
  throw new Error(securityCheck.recommendations.join('\n'));
}
```

## Security Features

### 1. Input Validation

All user inputs are sanitized:

```javascript
// SQL injection prevention
const sanitized = SecurityManager.sanitizeSearchQuery(userInput);
// Removes: DROP, DELETE, INSERT, UPDATE, ALTER, etc.
// Escapes: %, _, \
// Limits length: 200 characters max
```

### 2. Rate Limiting

Prevents resource exhaustion:

```javascript
// Per-identifier rate limiting
if (!SecurityManager.checkRateLimit(userId, 100, 60000)) {
  throw new Error('Rate limit exceeded');
}
```

### 3. Result Limiting

Prevents memory exhaustion:

```javascript
// Enforced limits
const limit = SecurityManager.enforceResultLimit(userLimit);
// Max: 1000 results
// Default: 100 results
```

### 4. Date Range Validation

Prevents excessive queries:

```javascript
// Max 1 year range
SecurityManager.validateDateRange(startDate, endDate);
```

### 5. Error Sanitization

Prevents information disclosure:

```javascript
// Sanitizes paths and sensitive info
throw SecurityManager.sanitizeError(error);
// Removes: file paths, table names, SQL queries
```

### 6. Audit Logging

All access is logged:

```javascript
SecurityManager.logAccess('operation_type', {
  timestamp: new Date(),
  // Sensitive data redacted
});
```

## Best Practices

### For Users

1. **Grant Minimal Permissions**
   - Only grant Full Disk Access if using Mail MCP
   - Review permissions regularly in System Preferences

2. **Keep Software Updated**
   - Update Mac MCP Suite regularly
   - Keep macOS and Node.js updated

3. **Monitor Access**
   - Check audit logs if suspicious
   - Revoke permissions if not using

4. **Secure Your System**
   - Use FileVault for disk encryption
   - Enable System Integrity Protection (SIP)
   - Use strong passwords

### For Developers

1. **Never Modify Security Features**
   - Don't bypass permission checks
   - Don't disable input validation
   - Don't increase limits

2. **Handle Sensitive Data Carefully**
   - Don't log sensitive information
   - Clear sensitive data from memory
   - Use Security Manager functions

3. **Follow Secure Coding Practices**
   - Validate all inputs
   - Use parameterized queries
   - Handle errors gracefully

## Threat Model

### Potential Threats

1. **Unauthorized Access**
   - Mitigated by: macOS permission system
   - Additional: Permission verification

2. **SQL Injection**
   - Mitigated by: Input sanitization
   - Additional: Read-only connections

3. **Resource Exhaustion**
   - Mitigated by: Rate limiting
   - Additional: Result limits

4. **Information Disclosure**
   - Mitigated by: Error sanitization
   - Additional: Minimal data access

5. **Privilege Escalation**
   - Mitigated by: Read-only access
   - Additional: No system calls

### Out of Scope

- Network attacks (no network functionality)
- Data exfiltration (no data transmission)
- Malware distribution (read-only, no execution)

## Incident Response

### Reporting Security Issues

**DO NOT** create public GitHub issues for security vulnerabilities.

Instead:
1. Email: security@[domain] (when available)
2. Use GitHub Security Advisories
3. Provide detailed reproduction steps

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix Development**: Based on severity
- **Disclosure**: Coordinated with reporter

### Security Updates

Security updates are released as:
- Patch versions for fixes
- Minor versions for enhancements
- Documented in release notes

## Compliance & Standards

### Privacy Compliance

- No personal data collection
- No analytics or telemetry
- No third-party services
- Local processing only

### Security Standards

- OWASP guidelines for input validation
- Principle of least privilege
- Defense in depth approach
- Secure by default configuration

## Security Checklist

Before each release:

- [ ] All inputs validated
- [ ] Permission checks in place
- [ ] Rate limiting functional
- [ ] Error messages sanitized
- [ ] No sensitive data logged
- [ ] Security tests passing
- [ ] Dependencies updated
- [ ] Security documentation current

## Questions?

For security questions or concerns:
- Review this guide first
- Check [CONTRIBUTING.md](CONTRIBUTING.md) for development
- Contact maintainers for clarification