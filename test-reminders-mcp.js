#!/usr/bin/env node

/**
 * Test Reminders MCP Database Access
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const APPLE_EPOCH_OFFSET = 978307200;

function appleToJSDate(appleTime) {
  if (!appleTime || appleTime === 0) return null;
  return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
}

async function testRemindersDatabase() {
  console.log('✅ REMINDERS MCP DATABASE TEST');
  console.log('==============================\n');
  
  const dbPath = join(
    homedir(),
    'Library',
    'Group Containers',
    'group.com.apple.reminders',
    'Container_v1',
    'Stores',
    'Data-local.sqlite'
  );
  
  let db;
  
  try {
    console.log('🔌 Connecting to Reminders database...');
    db = new Database(dbPath, { readonly: true });
    
    // Test connection
    const totalReminders = db.prepare('SELECT COUNT(*) as count FROM ZREMCDREMINDER').get();
    console.log(`  ✅ Connected - ${totalReminders.count} total reminders\n`);
    
    // Get statistics
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN ZCOMPLETED = 0 THEN 1 END) as active,
        COUNT(CASE WHEN ZCOMPLETED = 1 THEN 1 END) as completed,
        COUNT(CASE WHEN ZFLAGGED = 1 THEN 1 END) as flagged
      FROM ZREMCDREMINDER
      WHERE ZTITLE IS NOT NULL
    `).get();
    
    console.log(`📊 Statistics:`);
    console.log(`  Total reminders: ${stats.total}`);
    console.log(`  Active: ${stats.active}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Flagged: ${stats.flagged}`);
    
    // Get lists
    console.log(`\n📝 Reminder Lists:`);
    const listsQuery = `
      SELECT 
        l.Z_PK as list_id,
        l.ZNAME as name,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = l.Z_PK) as total_count,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = l.Z_PK AND ZCOMPLETED = 0) as active_count
      FROM ZREMCDOBJECT l
      WHERE l.ZNAME IS NOT NULL
        AND l.Z_ENT = (SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'REMCDList')
      ORDER BY l.ZNAME
      LIMIT 10
    `;
    
    const lists = db.prepare(listsQuery).all();
    
    if (lists.length === 0) {
      console.log(`  No lists found`);
    } else {
      lists.forEach(list => {
        console.log(`  📝 ${list.name} (${list.active_count} active / ${list.total_count} total)`);
      });
    }
    
    // Get active reminders
    console.log(`\n📋 Active Reminders (last 10):`);
    const activeRemindersQuery = `
      SELECT 
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZCOMPLETED = 0
        AND r.ZTITLE IS NOT NULL
      ORDER BY 
        CASE WHEN r.ZDUEDATE IS NOT NULL THEN 0 ELSE 1 END,
        r.ZDUEDATE ASC,
        r.ZPRIORITY DESC
      LIMIT 10
    `;
    
    const activeReminders = db.prepare(activeRemindersQuery).all();
    
    if (activeReminders.length === 0) {
      console.log(`  No active reminders`);
    } else {
      activeReminders.forEach((reminder, i) => {
        const dueDate = appleToJSDate(reminder.due_date);
        const dueDateStr = dueDate ? dueDate.toLocaleDateString() : 'No due date';
        
        console.log(`  ${i + 1}. ${reminder.title}`);
        if (reminder.notes) console.log(`     Notes: ${reminder.notes.substring(0, 50)}...`);
        console.log(`     Due: ${dueDateStr}`);
        console.log(`     List: ${reminder.list_name || 'Default'}`);
        if (reminder.priority > 0) console.log(`     Priority: ${reminder.priority}`);
        if (reminder.flagged) console.log(`     🚩 Flagged`);
      });
    }
    
    // Get overdue reminders
    const nowApple = (Date.now() / 1000) - APPLE_EPOCH_OFFSET;
    const overdueQuery = `
      SELECT COUNT(*) as count
      FROM ZREMCDREMINDER
      WHERE ZCOMPLETED = 0
        AND ZDUEDATE < ?
        AND ZDUEDATE IS NOT NULL
    `;
    
    const overdue = db.prepare(overdueQuery).get(nowApple);
    
    if (overdue.count > 0) {
      console.log(`\n⚠️  ${overdue.count} overdue reminders!`);
    }
    
    // Search test
    console.log(`\n🔍 Search Test:`);
    const searchTerm = 'email';
    const searchQuery = `
      SELECT COUNT(*) as count
      FROM ZREMCDREMINDER
      WHERE (ZTITLE LIKE ? OR ZNOTES LIKE ?)
        AND ZTITLE IS NOT NULL
    `;
    
    const searchResult = db.prepare(searchQuery).get(`%${searchTerm}%`, `%${searchTerm}%`);
    console.log(`  Found ${searchResult.count} reminders containing "${searchTerm}"`);
    
    console.log(`\n✅ Reminders MCP Database Test Results:`);
    console.log(`  ✅ Direct SQLite access: SUCCESS`);
    console.log(`  ✅ ${stats.total} reminders accessible`);
    console.log(`  ✅ ${lists.length} lists found`);
    console.log(`  ✅ Full reminder data available (title, notes, due dates, etc.)`);
    console.log(`  ✅ Search functionality: Working`);
    
  } catch (error) {
    console.error('❌ Reminders database test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Ensure Reminders.app has been opened at least once');
    console.error('  2. Check database exists at:', dbPath);
    console.error('  3. Grant Terminal Full Disk Access in System Preferences');
  } finally {
    if (db) db.close();
  }
}

testRemindersDatabase();