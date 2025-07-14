# Mac MCP Suite

A powerful collection of Model Context Protocol (MCP) servers that provide direct, secure access to your Mac's Mail, Calendar, Notes, and Reminders data. Built for developers and power users who want programmatic access to their macOS applications.

## Features

- **Direct Database Access**: Blazing fast queries with no AppleScript timeouts
- **Security First**: Read-only access with comprehensive security features
- **High Performance**: Handle 300K+ emails, thousands of calendar events
- **Privacy Focused**: All processing happens locally, no data leaves your Mac
- **Easy Integration**: Works with any MCP-compatible client

## Quick Start

### Automated Installation

```bash
curl -fsSL https://raw.githubusercontent.com/xxyjoel/mac-mcp/main/install.sh | bash
```

This will install all four MCP servers and set up your environment. See [INSTALLATION.md](INSTALLATION.md) for detailed instructions.

### Requirements

- macOS 10.14 (Mojave) or later
- Node.js 18 or later
- Terminal with Full Disk Access (for Mail only)

## Available MCP Servers

### Mac Mail MCP
Access your email metadata with lightning speed:
- Query 300K+ messages instantly
- Advanced search and filtering
- Multi-account aggregation
- Deduplication support

### Mac Calendar MCP
Manage your calendar data programmatically:
- List all calendars and events
- Search across date ranges
- Event statistics and analytics
- Smart caching for performance

### Mac Notes MCP
Access your Notes metadata:
- List folders and notes
- Search by title or content
- Track modification dates
- Password-protected note awareness

### Mac Reminders MCP
Interact with your reminders:
- View active and completed tasks
- Search across all lists
- Priority and due date sorting
- Completion statistics

## Security

Security is our top priority. Read our [Security Guide](SECURITY.md) for details on:

- Read-only database access
- Permission model and verification
- Input sanitization and validation
- Rate limiting and resource protection
- Audit logging

Key security features:
- ✅ Read-only access (cannot modify your data)
- ✅ Local processing only (no network access)
- ✅ Minimal permissions required
- ✅ Full audit trail
- ✅ Open source for transparency

## Usage Examples

### With Claude Desktop

Add to your `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mac-mail": {
      "command": "node",
      "args": ["~/.mac-mcp/mac-mail-mcp/dist/index.js"]
    },
    "mac-calendar": {
      "command": "node",
      "args": ["~/.mac-mcp/mac-calendar-mcp/dist/index.js"]
    }
  }
}
```

### Command Line

```bash
# Get email statistics
mac-mail-mcp

# List today's calendar events  
mac-calendar-mcp

# Search recent notes
mac-notes-mcp

# View active reminders
mac-reminders-mcp
```

### Example Queries

```javascript
// Get emails from the last 2 days
const recentEmails = await mailClient.getRecentMessages(2);

// Search calendar events
const meetings = await calendarClient.searchEvents("meeting", 7);

// Get all reminder lists
const lists = await remindersClient.getLists();

// Search notes by title
const notes = await notesClient.searchNotes("project");
```

## Performance

Our direct database approach delivers exceptional performance:

| Operation | AppleScript | Mac MCP | Improvement |
|-----------|-------------|---------|-------------|
| Query 1000 emails | 30s timeout | 0.2s | 150x faster |
| List all calendars | 5-10s | 0.001s | 5000x faster |
| Search notes | 3-5s | 0.05s | 60x faster |
| Count reminders | 2-3s | 0.01s | 200x faster |

## Documentation

- [Installation Guide](INSTALLATION.md) - Detailed setup instructions
- [Security Guide](SECURITY.md) - Security features and best practices
- [Contributing](CONTRIBUTING.md) - How to contribute
- Individual service docs:
  - [Mail MCP](mac-mail-mcp/README.md)
  - [Calendar MCP](mac-calendar-mcp/README.md)
  - [Notes MCP](mac-notes-mcp/README.md)
  - [Reminders MCP](mac-reminders-mcp/README.md)

## Semantic Versioning

This project follows [Semantic Versioning](https://semver.org/):

```bash
# Patch release (bug fixes)
npm version patch

# Minor release (new features)
npm version minor

# Major release (breaking changes)
npm version major
```

### Current Version

v0.1.0

## Privacy

- **No data collection**: We don't collect any user data
- **No analytics**: No telemetry or usage tracking
- **No network access**: Everything runs locally
- **Open source**: Audit the code yourself

## Troubleshooting

Common issues and solutions:

1. **"Database access denied"**
   - Grant Full Disk Access to Terminal
   - See [Permissions Setup](INSTALLATION.md#permissions-setup)

2. **"Database not found"**
   - Open the respective app once
   - Let it sync/initialize

3. **Performance issues**
   - Use specific date ranges
   - Leverage built-in caching
   - See performance tips in docs

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Repository

https://github.com/xxyjoel/mac-mcp

## Acknowledgments

Built with:
- [Model Context Protocol](https://github.com/anthropics/mcp) by Anthropic
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for database access
- Love for the macOS ecosystem

---

**Note**: This project is not affiliated with Apple Inc. All trademarks are property of their respective owners.