# Security Guidelines for Mac Calendar MCP Server

## Overview

This document outlines the security considerations and best practices for the Mac Calendar MCP Server.

## Security Principles

### 1. Principle of Least Privilege
- Server operates with **read-only** access to calendar data
- No ability to create, modify, or delete calendar events
- Limited to querying existing calendar information

### 2. Permission Model
- Requires explicit system-level calendar permissions
- Permission checks performed before every operation
- Clear error messages when permissions are denied

### 3. Input Validation
- All user inputs validated using Zod schemas
- Date formats strictly enforced (ISO 8601)
- Query strings sanitized before AppleScript execution

## Implementation Details

### AppleScript Security
- Commands executed through Node.js child processes
- Limited AppleScript commands (no file system access)
- Error handling prevents script injection

### Data Access Patterns
```typescript
// Permission check before any operation
await securityManager.checkPermissions("calendar.read");

// Input validation with Zod
const validatedArgs = listEventsToolSchema.parse(args);
```

### Error Handling
- Sensitive system errors are caught and sanitized
- User-friendly error messages returned
- No internal system paths exposed

## Threat Model

### Potential Risks
1. **Unauthorized Calendar Access**
   - Mitigation: System-level permission requirements
   - User must explicitly grant calendar access

2. **Data Exfiltration**
   - Mitigation: Read-only access limits exposure
   - No bulk export functionality

3. **Script Injection**
   - Mitigation: Input validation and sanitization
   - Limited AppleScript command set

### Security Boundaries
- MCP transport layer (stdio) provides isolation
- No network access or external dependencies
- Runs with user-level permissions only

## Best Practices for Users

1. **Review Permissions**
   - Only grant calendar access when needed
   - Periodically review System Preferences permissions

2. **Audit Usage**
   - Monitor MCP server logs for unusual activity
   - Check which tools are being called

3. **Update Regularly**
   - Keep the server updated with security patches
   - Review changelog for security updates

## Comparison with apple-mcp

Unlike the apple-mcp project, this implementation:
- Focuses solely on calendar access (reduced attack surface)
- Implements explicit permission checks
- Uses input validation on all parameters
- Provides detailed security documentation
- Follows security-by-design principles

## Future Enhancements

1. **OAuth 2.0 Integration**
   - Token-based authentication
   - Refresh token management
   - Scoped permissions

2. **Audit Logging**
   - Track all calendar access attempts
   - Integration with system logging

3. **Rate Limiting**
   - Prevent abuse through request throttling
   - Configurable limits per operation

## Reporting Security Issues

If you discover a security vulnerability:
1. Do not open a public issue
2. Email security details privately
3. Include steps to reproduce
4. Allow time for patch before disclosure