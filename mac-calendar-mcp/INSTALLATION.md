# 📅 Mac Calendar MCP - Installation Guide

Connect your Mac Calendar to Claude, VS Code, or any MCP-compatible tool!

## Prerequisites

- macOS 10.15 or later
- Node.js 18 or later
- Calendar.app installed
- Terminal access to grant calendar permissions

## Quick Install

```bash
# Clone the repository
git clone https://github.com/yourusername/mac-calendar-mcp.git
cd mac-calendar-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Test it works
node quick-test.js
```

## Grant Calendar Permissions

**Important:** The first time you run the server, macOS will ask for calendar permissions.

1. Run any test script: `node quick-test.js`
2. macOS will prompt: "Terminal would like to access your calendar"
3. Click "OK" to grant permission
4. If you missed the prompt, go to:
   - System Preferences → Security & Privacy → Privacy → Calendar
   - Check the box next to Terminal (or your terminal app)

## Installation for Different Tools

### 🤖 Claude Desktop

Add to your Claude configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mac-calendar": {
      "command": "node",
      "args": ["/absolute/path/to/mac-calendar-mcp/dist/index.js"],
      "env": {
        "MCP_CALENDAR_TIMEOUT": "180000"
      }
    }
  }
}
```

### 💻 VS Code (via MCP extension)

1. Install the MCP extension for VS Code
2. Add to your VS Code settings.json:

```json
{
  "mcp.servers": {
    "mac-calendar": {
      "command": "node",
      "args": ["/absolute/path/to/mac-calendar-mcp/dist/index.js"],
      "env": {
        "MCP_CALENDAR_TIMEOUT": "180000"
      }
    }
  }
}
```

### 🚀 Warp Terminal (via MCP CLI)

1. Install the MCP CLI:
```bash
npm install -g @modelcontextprotocol/cli
```

2. Configure MCP:
```bash
mcp configure add mac-calendar
```

3. When prompted, enter:
```
Command: node
Arguments: /absolute/path/to/mac-calendar-mcp/dist/index.js
Environment Variables: MCP_CALENDAR_TIMEOUT=180000
```

### 🔧 Generic MCP Configuration

For any MCP-compatible tool, use this configuration:

```json
{
  "id": "mac-calendar",
  "name": "Mac Calendar",
  "description": "Read-only access to Mac Calendar events",
  "protocol": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/mac-calendar-mcp/dist/index.js"],
  "env": {
    "MCP_CALENDAR_TIMEOUT": "180000"
  }
}
```

## Available Tools

Once installed, you'll have access to these tools:

### 1. `get_calendar_info`
Get a list of all calendars
```json
{
  "tool": "get_calendar_info",
  "arguments": {}
}
```

### 2. `list_events`
List events within a date range
```json
{
  "tool": "list_events",
  "arguments": {
    "startDate": "2025-07-07",
    "endDate": "2025-07-07",
    "calendarName": "Work"  // Optional
  }
}
```

### 3. `search_events`
Search for events by title or description
```json
{
  "tool": "search_events",
  "arguments": {
    "query": "meeting",
    "startDate": "2025-07-01",  // Optional
    "endDate": "2025-07-31"     // Optional
  }
}
```

### 4. `get_event`
Get details of a specific event
```json
{
  "tool": "get_event",
  "arguments": {
    "eventId": "event-unique-id"
  }
}
```

### 5. `get_event_count`
Get the total number of events in a calendar
```json
{
  "tool": "get_event_count",
  "arguments": {
    "calendarName": "Personal"
  }
}
```

## Environment Variables

- `MCP_CALENDAR_TIMEOUT`: Override default timeout (milliseconds)
  - Default: 120000 (2 minutes)
  - Search operations: 180000 (3 minutes)
  - Example: `export MCP_CALENDAR_TIMEOUT=300000` (5 minutes)

## Performance Tips

1. **Always specify calendar names** - Much faster than searching all calendars
2. **Use small date ranges** - Single day or week is optimal
3. **Cache is automatic** - Second queries are ~1000x faster
4. **First query is slower** - Includes permission check (~1 second)

## Troubleshooting

### "Calendar operation timed out"
- Use specific calendar names: `"Work"` not all calendars
- Increase timeout: `export MCP_CALENDAR_TIMEOUT=300000`
- Check calendar size: `node quick-test.js`

### "Calendar access denied"
1. Check System Preferences → Privacy → Calendar
2. Ensure your terminal app has permission
3. Try running: `osascript -e 'tell application "Calendar" to count calendars'`

### "Cannot connect to MCP server"
1. Ensure built: `npm run build`
2. Check path is absolute in configuration
3. Test directly: `node dist/index.js`

### Cache Issues
- Cache location: `~/.mac-calendar-mcp/calendar-cache.db`
- Clear cache: `rm -rf ~/.mac-calendar-mcp`
- Cache auto-expires: 15 minutes for recent events

## Example Usage in Claude

Once installed, you can ask Claude:

- "What's on my calendar today?"
- "Do I have any meetings this week?"
- "Search my calendar for budget meetings"
- "How many events are in my Work calendar?"
- "Show me tomorrow's schedule"

## Security

- **Read-only access** - Cannot create, modify, or delete events
- **Local only** - No network access, all data stays on your Mac
- **Permission required** - macOS requires explicit calendar permission
- **No credentials stored** - Uses system calendar access

## Contributing

Found a bug or want to contribute? Visit:
https://github.com/yourusername/mac-calendar-mcp

## License

MIT License - See LICENSE file for details