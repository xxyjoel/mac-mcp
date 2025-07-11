# 🧪 How to Test Mac Calendar MCP

## Quick Start (30 seconds)

```bash
# 1. Build the project
npm run build

# 2. Run the test
node test-it-yourself.js
```

That's it! The test will check if everything is working.

## What Gets Tested?

✅ **Connection** - Can connect to MCP server  
✅ **Calendar List** - Can see all your calendars  
✅ **Event Reading** - Can read today's events  
✅ **Cache Performance** - Verifies cache is working  

## Expected Output

```
🧪 Mac Calendar MCP Test Suite

⚡ Starting tests...

1️⃣ Testing connection...
   ✅ Connected successfully!

2️⃣ Getting your calendars...
   ✅ You have 27 calendars
   📅 Examples: Home, Work, Personal...

3️⃣ Checking today's events...
   ✅ Found 2 events in Work calendar
   📌 Example: "Team Standup"

4️⃣ Testing cache performance...
   ✅ First query: 1523ms
   ✅ Cached query: 2ms (761x faster!)

══════════════════════════════════════════════════

🎉 SUCCESS! Your Mac Calendar MCP is working perfectly!
```

## Manual Testing

### Test individual features:

```javascript
// Test 1: List your calendars
await client.callTool('get_calendar_info', {});

// Test 2: Get today's events
await client.callTool('list_events', {
  startDate: '2025-07-07',
  endDate: '2025-07-07',
  calendarName: 'Work'
});

// Test 3: Search for meetings
await client.callTool('search_events', {
  query: 'meeting',
  startDate: '2025-07-07',
  endDate: '2025-07-14'
});

// Test 4: Count events
await client.callTool('get_event_count', {
  calendarName: 'Personal'
});
```

## Performance Benchmarks

Good performance indicators:
- **First query**: 1-3 seconds ✅
- **Cached query**: 1-5ms ✅
- **Calendar list**: < 1 second ✅
- **Search**: 1-5 seconds ✅

## Troubleshooting Failed Tests

### ❌ "Calendar operation timed out"
- Use specific calendar names
- Use smaller date ranges
- Check if calendar has many events

### ❌ "Cannot read calendars"
1. Check permissions:
   ```bash
   osascript -e 'tell application "Calendar" to count calendars'
   ```
2. Grant access in System Preferences → Privacy → Calendar

### ❌ "Connection failed"
1. Rebuild: `npm run build`
2. Check for errors: `npm run typecheck`
3. Check Node version: `node --version` (need 18+)

## Advanced Testing

### Test with different timeouts:
```bash
MCP_CALENDAR_TIMEOUT=300000 node test-it-yourself.js
```

### Test specific calendars:
```javascript
// Edit quick-test.js to test your specific calendars
const myCalendars = ['Work Gmail', 'Personal iCloud', 'Shared Team'];
```

### Check cache database:
```bash
sqlite3 ~/.mac-calendar-mcp/calendar-cache.db "SELECT name, event_count FROM calendars;"
```

## Load Testing

```javascript
// Run multiple queries in parallel
const promises = calendars.map(cal => 
  client.callTool('get_event_count', { calendarName: cal })
);
await Promise.all(promises);
```

## Success Criteria

Your installation is working if:
- ✅ All 5 tests in quick-test.js pass
- ✅ Cache provides 100x+ speedup
- ✅ No timeout errors for specific calendars
- ✅ Can search for events successfully

Happy testing! 🎉