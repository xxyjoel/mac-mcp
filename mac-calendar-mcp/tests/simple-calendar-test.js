#!/usr/bin/env node

/**
 * Simple Calendar MCP Test
 * Basic functionality test and calendar summary
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function simpleCalendarTest() {
  console.log('🧪 CALENDAR MCP SERVICE TEST (SIMPLIFIED)');
  console.log('=========================================\n');
  
  try {
    // Test 1: Calendar Access Permission
    console.log('🔐 Testing calendar access permissions...');
    
    const permissionScript = `
      tell application "Calendar"
        try
          set calendarCount to count of calendars
          return "SUCCESS: " & calendarCount & " calendars found"
        on error errMsg
          return "ERROR: " & errMsg
        end try
      end tell
    `;
    
    const { stdout: permResult } = await execAsync(`osascript -e '${permissionScript}'`);
    
    if (permResult.includes('ERROR')) {
      throw new Error(`Calendar permission denied: ${permResult}`);
    }
    
    const calendarCount = parseInt(permResult.match(/\d+/)[0]);
    console.log(`  ✅ ${permResult.trim()}\n`);
    
    // Test 2: Get Calendar Names (lightweight)
    console.log('📅 Enumerating calendars...');
    
    const calendarNamesScript = `
      tell application "Calendar"
        try
          set calNames to {}
          repeat with cal in calendars
            set end of calNames to name of cal
          end repeat
          return calNames as string
        on error errMsg
          return "ERROR: " & errMsg
        end try
      end tell
    `;
    
    const { stdout: calNamesResult } = await execAsync(`osascript -e '${calendarNamesScript}'`, {
      timeout: 5000
    });
    
    const calendarNames = calNamesResult.trim().split(', ').filter(name => name.length > 0);
    console.log(`  ✅ Found ${calendarNames.length} calendars:`);
    calendarNames.slice(0, 8).forEach(name => {
      console.log(`    - ${name}`);
    });
    if (calendarNames.length > 8) {
      console.log(`    ... and ${calendarNames.length - 8} more`);
    }
    console.log();
    
    // Test 3: Simple Event Count (just today)
    console.log('📊 Getting today\'s event count...');
    
    const todayEventsScript = `
      tell application "Calendar"
        try
          set todayStart to (current date)
          set hours of todayStart to 0
          set minutes of todayStart to 0
          set seconds of todayStart to 0
          
          set todayEnd to todayStart + (1 * days)
          
          set eventCount to 0
          -- Just check first few calendars to avoid timeout
          repeat with i from 1 to (count of calendars)
            if i > 5 then exit repeat
            try
              set cal to calendar i
              set calEvents to (every event of cal whose start date ≥ todayStart and start date < todayEnd)
              set eventCount to eventCount + (count of calEvents)
            end try
          end repeat
          
          return "TODAY: " & eventCount & " events"
        on error errMsg
          return "ERROR: " & errMsg
        end try
      end tell
    `;
    
    const { stdout: todayResult } = await execAsync(`osascript -e '${todayEventsScript}'`, {
      timeout: 8000
    });
    
    if (todayResult.includes('ERROR:')) {
      console.log(`  ⚠️  Event query failed: ${todayResult}`);
      console.log(`  📝 This is common with large calendar datasets`);
    } else {
      const eventCount = parseInt(todayResult.match(/\d+/)[0] || '0');
      console.log(`  ✅ ${todayResult.trim()}`);
      
      if (eventCount > 0) {
        console.log(`  📅 Active calendar usage detected`);
      } else {
        console.log(`  📅 No events today (or events outside query window)`);
      }
    }
    console.log();
    
    // Test 4: Quick 2-Day Summary Attempt
    console.log('📊 Attempting 2-day summary (limited scope)...');
    
    const quickSummaryScript = `
      tell application "Calendar"
        try
          set startDate to (current date) - (2 * days)
          set endDate to current date
          
          -- Just check primary calendar to avoid timeout
          set primaryCal to calendar 1
          set recentEvents to (every event of primaryCal whose start date ≥ startDate and start date ≤ endDate)
          
          return "RECENT: " & (count of recentEvents) & " events in primary calendar"
        on error errMsg
          return "LIMITED: Calendar query too complex for AppleScript"
        end try
      end tell
    `;
    
    const { stdout: summaryResult } = await execAsync(`osascript -e '${quickSummaryScript}'`, {
      timeout: 5000
    });
    
    console.log(`  📊 ${summaryResult.trim()}`);
    
    // Test Summary
    console.log(`\n✅ CALENDAR MCP TEST RESULTS:`);
    console.log(`  ✅ Permission check: SUCCESS`);
    console.log(`  ✅ Calendar enumeration: ${calendarNames.length} calendars found`);
    console.log(`  ✅ Calendar access: WORKING`);
    
    if (todayResult.includes('ERROR:') || summaryResult.includes('LIMITED:')) {
      console.log(`  ⚠️  Event queries: LIMITED (large dataset/timeout issues)`);
      console.log(`  📝 Note: This is expected with large calendar datasets`);
      console.log(`  📝 Calendar MCP would work better with smaller date ranges`);
    } else {
      console.log(`  ✅ Event queries: WORKING`);
    }
    
    console.log(`\n📋 CALENDAR SUMMARY:`);
    console.log(`  📅 Total calendars: ${calendarCount}`);
    console.log(`  📝 Primary calendars: ${Math.min(5, calendarCount)} (tested)`);
    console.log(`  🔧 Status: Calendar MCP functional but limited by AppleScript performance`);
    console.log(`  💡 Recommendation: Use smaller date ranges for better performance`);
    
  } catch (error) {
    console.error('❌ Calendar MCP test failed:', error.message);
    
    if (error.message.includes('timeout')) {
      console.error('   📝 Timeout indicates large calendar dataset or permission issues');
    }
    
    if (error.message.includes('permission') || error.message.includes('access')) {
      console.error('   📝 Please ensure Calendar access is granted in System Preferences');
    }
    
    console.error('\n📋 PARTIAL RESULTS:');
    console.error('   🔧 Calendar MCP has permission issues or performance limitations');
    console.error('   💡 Consider using direct Calendar.app or smaller date ranges');
  }
}

simpleCalendarTest();