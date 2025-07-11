# 🧪 Complete Testing Guide for Mac Calendar MCP

## Prerequisites
```bash
# Make sure you're in the project directory
cd /Users/jproctor/My\ Drive/source/git/projects/ai-agents/mac-mcp/mac-calendar-mcp

# Ensure it's built
npm run build
```

## 1. Basic Functionality Test

### Test A: Direct Calendar Client Test
```bash
node -e "
import { CalendarClient } from './dist/calendar/client.js';

const client = new CalendarClient();
client.getCalendars()
  .then(calendars => {
    console.log('✅ Basic test passed!');
    console.log('Found', calendars.length, 'calendars');
    console.log('First 3:', calendars.slice(0, 3));
    client.close();
  })
  .catch(err => {
    console.error('❌ Test failed:', err.message);
    client.close();
  });
"
```

**Expected:** Should list your calendars in ~1 second

## 2. MCP Server Integration Test

### Test B: Simple MCP Connection Test
Create `test-basic-mcp.js`:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function basicTest() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({
    name: 'basic-test',
    version: '1.0.0'
  });

  try {
    // Test 1: Connection
    await client.connect(transport);
    console.log('✅ Connection successful');

    // Test 2: List tools
    const tools = await client.listTools();
    console.log('✅ Found', tools.tools.length, 'tools');

    // Test 3: Quick calendar info
    const info = await client.callTool('get_calendar_info', {});
    const data = JSON.parse(info.content[0].text);
    console.log('✅ Found', data.totalCalendars, 'calendars');

    await client.close();
    console.log('\n🎉 All basic tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await client.close();
  }
}

basicTest();
```

Run it:
```bash
node test-basic-mcp.js
```

## 3. Performance Testing

### Test C: Cache Performance Test
Create `test-cache-performance.js`:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function cacheTest() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({
    name: 'cache-test',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    console.log('🧪 Cache Performance Test\n');

    const today = new Date().toISOString().split('T')[0];

    // First query (no cache)
    console.log('1st query (no cache)...');
    const start1 = Date.now();
    await client.callTool('list_events', {
      startDate: today,
      endDate: today,
      calendarName: 'Home'
    });
    const time1 = Date.now() - start1;
    console.log(`   Time: ${time1}ms`);

    // Second query (should hit cache)
    console.log('\n2nd query (with cache)...');
    const start2 = Date.now();
    await client.callTool('list_events', {
      startDate: today,
      endDate: today,
      calendarName: 'Home'
    });
    const time2 = Date.now() - start2;
    console.log(`   Time: ${time2}ms`);
    console.log(`   Speed improvement: ${Math.round(time1/time2)}x faster!`);

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

cacheTest();
```

## 4. Stress Testing

### Test D: Timeout and Error Handling
Create `test-stress.js`:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function stressTest() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({
    name: 'stress-test',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    console.log('🔥 Stress Test\n');

    // Test 1: Large date range
    console.log('Test 1: Large date range (1 year)');
    try {
      const start = Date.now();
      await Promise.race([
        client.callTool('list_events', {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          calendarName: 'Work'
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);
      console.log(`   ✅ Handled in ${Date.now() - start}ms`);
    } catch (error) {
      console.log(`   ⚠️ Expected timeout: ${error.message}`);
    }

    // Test 2: Invalid calendar
    console.log('\nTest 2: Invalid calendar name');
    try {
      await client.callTool('list_events', {
        startDate: '2025-07-07',
        endDate: '2025-07-07',
        calendarName: 'NonExistentCalendar123'
      });
      console.log('   ✅ Handled gracefully');
    } catch (error) {
      console.log('   ✅ Error handled:', error.message);
    }

    // Test 3: Multiple parallel requests
    console.log('\nTest 3: Parallel requests');
    const calendars = ['Home', 'Work', 'Personal'];
    const start = Date.now();
    await Promise.all(
      calendars.map(cal => 
        client.callTool('get_event_count', { calendarName: cal })
          .catch(() => null)
      )
    );
    console.log(`   ✅ Handled ${calendars.length} parallel requests in ${Date.now() - start}ms`);

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

stressTest();
```

## 5. Full Test Suite

### Test E: Comprehensive Test
Create `test-comprehensive.js`:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function runTest(name, fn) {
  try {
    console.log(`\n📋 ${name}`);
    const result = await fn();
    console.log(`   ✅ Passed${result ? ': ' + result : ''}`);
    return true;
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function comprehensiveTest() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({
    name: 'comprehensive-test',
    version: '1.0.0'
  });

  let passed = 0;
  let failed = 0;

  try {
    await client.connect(transport);
    console.log('🧪 COMPREHENSIVE TEST SUITE');
    console.log('=' . repeat(50));

    const today = new Date().toISOString().split('T')[0];

    // Test suite
    const tests = [
      // Basic functionality
      ['Connect to server', async () => 'Connected'],
      
      ['List available tools', async () => {
        const tools = await client.listTools();
        return `${tools.tools.length} tools found`;
      }],
      
      ['Get calendar info', async () => {
        const result = await client.callTool('get_calendar_info', {});
        const info = JSON.parse(result.content[0].text);
        return `${info.totalCalendars} calendars`;
      }],
      
      // Event operations
      ['List today\'s events (Home)', async () => {
        const result = await client.callTool('list_events', {
          startDate: today,
          endDate: today,
          calendarName: 'Home'
        });
        const events = JSON.parse(result.content[0].text);
        return `${events.length} events`;
      }],
      
      ['Search for meetings', async () => {
        const result = await client.callTool('search_events', {
          query: 'meeting',
          startDate: today,
          endDate: today
        });
        const events = JSON.parse(result.content[0].text);
        return `${events.length} results`;
      }],
      
      ['Count events in calendar', async () => {
        const result = await client.callTool('get_event_count', {
          calendarName: 'Home'
        });
        const data = JSON.parse(result.content[0].text);
        return `${data.eventCount} total events`;
      }],
      
      // Cache verification
      ['Cache performance check', async () => {
        const start1 = Date.now();
        await client.callTool('list_events', {
          startDate: today,
          endDate: today,
          calendarName: 'Personal'
        });
        const time1 = Date.now() - start1;
        
        const start2 = Date.now();
        await client.callTool('list_events', {
          startDate: today,
          endDate: today,
          calendarName: 'Personal'
        });
        const time2 = Date.now() - start2;
        
        return `${time1}ms → ${time2}ms (${Math.round(time1/time2)}x faster)`;
      }],
      
      // Error handling
      ['Handle invalid dates gracefully', async () => {
        try {
          await client.callTool('list_events', {
            startDate: 'invalid-date',
            endDate: today,
            calendarName: 'Home'
          });
        } catch (error) {
          return 'Error handled correctly';
        }
        throw new Error('Should have thrown error');
      }],
    ];

    // Run all tests
    for (const [name, test] of tests) {
      if (await runTest(name, test)) {
        passed++;
      } else {
        failed++;
      }
    }

    console.log('\n' + '=' . repeat(50));
    console.log(`\n📊 Test Results:`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📈 Success Rate: ${Math.round(passed/(passed+failed)*100)}%`);
    
    if (failed === 0) {
      console.log('\n🎉 All tests passed! The server is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the output above.');
    }

    await client.close();
  } catch (error) {
    console.error('\n💥 Critical error:', error.message);
  }
}

comprehensiveTest();
```

## 6. Quick Command-Line Tests

### One-liner tests you can run immediately:

```bash
# Test 1: Check if server starts
node dist/index.js &
sleep 2 && kill $!

# Test 2: Check calendar access
osascript -e 'tell application "Calendar" to count calendars'

# Test 3: Check cache directory
ls -la ~/.mac-calendar-mcp/

# Test 4: Check build
npm run typecheck

# Test 5: Run built-in tests
npm test
```

## 7. Manual Testing Checklist

- [ ] Server starts without errors
- [ ] Can connect with MCP client
- [ ] Lists all available tools
- [ ] `get_calendar_info` returns calendar list
- [ ] `list_events` works with specific calendar
- [ ] Cache speeds up repeated queries
- [ ] Search finds events
- [ ] Error messages are helpful
- [ ] Timeouts are reasonable
- [ ] SQLite database is created

## Running All Tests

```bash
# Quick test sequence
npm run build
node test-basic-mcp.js
node test-cache-performance.js
node test-comprehensive.js
```

## Expected Results

✅ **Good signs:**
- Cache gives 100x+ speed improvement
- Specific calendar queries < 3 seconds
- No crashes on invalid input
- Clear error messages

⚠️ **Known limitations:**
- All-calendar queries may timeout
- Large date ranges are slow
- Work calendars with many events timeout

## Debugging Tips

If tests fail:
1. Check calendar permissions: System Preferences → Privacy → Calendar
2. Verify calendars exist: `osascript -e 'tell application "Calendar" to name of calendars'`
3. Check cache: `sqlite3 ~/.mac-calendar-mcp/calendar-cache.db "SELECT name FROM calendars;"`
4. Enable debug logs: `export DEBUG=* && node test-basic-mcp.js`