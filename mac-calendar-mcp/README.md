# 📅 Mac Calendar MCP Server

A high-performance MCP (Model Context Protocol) server that provides secure, read-only access to macOS Calendar data. Built with TypeScript and featuring both AppleScript and native EventKit implementations for optimal performance.

## ✨ Features

- **🚀 Blazing Fast**: EventKit implementation is 1000x faster than AppleScript
- **🔒 Secure**: Read-only access with system-level permission checks
- **💾 Smart Caching**: SQLite-based cache for instant repeated queries
- **🎯 Flexible Queries**: Filter by date range, calendar name, or search terms
- **📊 Rich Data**: Access events, calendars, and metadata
- **🔧 Easy Integration**: Works with Claude Desktop, VS Code, and any MCP client

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/mac-calendar-mcp.git
cd mac-calendar-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Optional: Build the Swift helper for 1000x performance boost
swiftc -o calendar-helper src/calendar/calendar-helper.swift -framework EventKit -framework Foundation

# Test it works
node quick-test.js
```

## 🔧 Installation

### For Claude Desktop

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

See [INSTALLATION.md](INSTALLATION.md) for detailed setup instructions for VS Code, Warp CLI, and other MCP clients.

## 📋 Available Tools

### 1. `get_calendar_info`
Get a list of all calendars with their names and IDs.

### 2. `list_events`
List events within a date range, optionally filtered by calendar.
```json
{
  "startDate": "2025-07-07",
  "endDate": "2025-07-07",
  "calendarName": "Work"  // Optional
}
```

### 3. `search_events`
Search for events by title or description.
```json
{
  "query": "meeting",
  "startDate": "2025-07-01",  // Optional
  "endDate": "2025-07-31"     // Optional
}
```

### 4. `get_event`
Get details of a specific event by ID.

### 5. `get_event_count`
Get the total number of events in a specific calendar.

## 🏗️ Architecture

The server supports two implementations:

1. **AppleScript** (fallback): Compatible with all macOS versions but slower
2. **EventKit** (recommended): Native Swift helper providing 1000x performance improvement

```
mac-calendar-mcp/
├── src/
│   ├── calendar/
│   │   ├── client.ts           # AppleScript implementation
│   │   ├── eventkit-client.ts  # EventKit implementation
│   │   ├── calendar-helper.swift # Swift EventKit helper
│   │   └── security.ts         # Permission management
│   ├── cache/
│   │   └── database.ts         # SQLite caching layer
│   └── tools/
│       └── schemas.ts          # Zod validation schemas
└── dist/                       # Compiled JavaScript
```

## 🔒 Security

- **Read-only access**: Cannot create, modify, or delete events
- **System permissions**: Requires explicit calendar access in macOS settings
- **No credentials**: Uses system-level calendar access
- **Input validation**: All inputs validated with Zod schemas

## ⚡ Performance

With the EventKit implementation:
- Query 5,000+ events in ~100ms
- Instant response for cached queries
- Handles large calendars without timeouts
- Efficient date-range filtering at the database level

## 🧪 Testing

```bash
# Quick functionality test
node quick-test.js

# Test EventKit performance
node test-eventkit.js

# Interactive calendar exploration
node test-it-yourself.js

# Weekly summary example
node weekly-summary.js
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built on the [Model Context Protocol](https://modelcontextprotocol.com) specification
- Inspired by the need for AI assistants to access calendar data securely
- Thanks to the Anthropic team for the MCP SDK

## 🐛 Troubleshooting

### "Calendar operation timed out"
- Use specific calendar names instead of querying all calendars
- Install the Swift helper for better performance
- Increase timeout: `export MCP_CALENDAR_TIMEOUT=300000`

### "Calendar access denied"
1. Check System Preferences → Privacy & Security → Calendar
2. Ensure Terminal (or your app) has permission
3. Run `osascript -e 'tell application "Calendar" to count calendars'` to test

### Cache issues
- Clear cache: `rm -rf ~/.mac-calendar-mcp`
- Cache auto-expires after 15 minutes for recent events

## 📊 Performance Comparison

| Implementation | 5,000 Events Query | 10 Events Query | Calendar List |
|----------------|-------------------|-----------------|---------------|
| AppleScript    | 120s (timeout)    | 2-5s           | 1-2s          |
| EventKit       | 100ms            | 10ms           | 5ms           |
| Cached         | 1ms              | 1ms            | 1ms           |

---

Made with ❤️ for the MCP community