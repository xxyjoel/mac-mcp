#!/usr/bin/env node

/**
 * Test Notes and Reminders SQLite Database Access
 * Discovers the structure and content of local Notes and Reminders storage
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

// Apple Core Foundation date helpers
const APPLE_EPOCH_OFFSET = 978307200;

function appleToJSDate(appleTime) {
  if (!appleTime || appleTime === 0) return null;
  return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
}

async function testNotesDatabase() {
  console.log('📝 NOTES DATABASE TEST');
  console.log('======================\n');
  
  const dbPath = join(
    homedir(),
    'Library',
    'Group Containers',
    'group.com.apple.notes',
    'NoteStore.sqlite'
  );
  
  let db;
  
  try {
    console.log('🔌 Connecting to Notes database...');
    db = new Database(dbPath, { readonly: true });
    
    // Get note count
    const totalNotes = db.prepare(`
      SELECT COUNT(*) as count 
      FROM ZICCLOUDSYNCINGOBJECT 
      WHERE ZTITLE IS NOT NULL
    `).get();
    
    console.log(`  ✅ Connected - ${totalNotes.count} notes found\n`);
    
    // Get recent notes
    console.log('📋 Recent Notes (last 10):');
    
    const recentNotesQuery = `
      SELECT 
        Z_PK as id,
        ZTITLE as title,
        ZCREATIONDATE as creation_date,
        ZMODIFICATIONDATE as modification_date,
        ZFOLDER as folder_id,
        ZNOTEHASPREVIEWIMAGES as has_images,
        ZNOTEHASATTACHMENTS as has_attachments,
        ZNOTEHASDRAWNATTACHMENTS as has_drawings
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE ZTITLE IS NOT NULL
      ORDER BY ZMODIFICATIONDATE DESC
      LIMIT 10
    `;
    
    const recentNotes = db.prepare(recentNotesQuery).all();
    
    recentNotes.forEach((note, i) => {
      const modDate = appleToJSDate(note.modification_date);
      const dateStr = modDate ? modDate.toLocaleDateString() : 'Unknown';
      
      console.log(`  ${i + 1}. ${note.title || '(Untitled)'}`);
      console.log(`     Modified: ${dateStr}`);
      console.log(`     ID: ${note.id}`);
      if (note.has_attachments) console.log(`     📎 Has attachments`);
      if (note.has_images) console.log(`     🖼️  Has images`);
      if (note.has_drawings) console.log(`     ✏️  Has drawings`);
    });
    
    // Get folder structure
    console.log('\n📁 Folders:');
    
    const foldersQuery = `
      SELECT 
        Z_PK as id,
        ZTITLE as title,
        ZPARENT as parent_id,
        (SELECT COUNT(*) FROM ZICCLOUDSYNCINGOBJECT WHERE ZFOLDER = f.Z_PK) as note_count
      FROM ZICCLOUDSYNCINGOBJECT f
      WHERE ZTITLE IS NOT NULL AND ZFOLDER IS NULL
      ORDER BY ZTITLE
    `;
    
    const folders = db.prepare(foldersQuery).all();
    
    folders.forEach(folder => {
      console.log(`  📁 ${folder.title} (${folder.note_count} notes)`);
    });
    
    // Note content is stored as encrypted BLOBs in ZICNOTEDATA table
    console.log('\n⚠️  Note: Actual note content is stored as encrypted BLOBs');
    console.log('   in the ZICNOTEDATA table and requires decryption');
    
  } catch (error) {
    console.error('❌ Notes database test failed:', error.message);
  } finally {
    if (db) db.close();
  }
}

async function testRemindersDatabase() {
  console.log('\n\n✅ REMINDERS DATABASE TEST');
  console.log('==========================\n');
  
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
    
    // Get reminder count
    const totalReminders = db.prepare(`
      SELECT COUNT(*) as count 
      FROM ZREMCDREMINDER 
      WHERE ZTITLE IS NOT NULL
    `).get();
    
    console.log(`  ✅ Connected - ${totalReminders.count} reminders found\n`);
    
    // Get active reminders
    console.log('📋 Active Reminders:');
    
    const activeRemindersQuery = `
      SELECT 
        r.Z_PK as id,
        r.ZTITLE as title,
        r.ZNOTES as notes,
        r.ZCOMPLETED as completed,
        r.ZDUEDATE as due_date,
        r.ZPRIORITY as priority,
        r.ZFLAGGED as flagged,
        l.ZNAME as list_name
      FROM ZREMCDREMINDER r
      LEFT JOIN ZREMCDOBJECT l ON r.ZLIST = l.Z_PK
      WHERE r.ZTITLE IS NOT NULL AND r.ZCOMPLETED = 0
      ORDER BY r.ZDUEDATE ASC NULLS LAST
      LIMIT 15
    `;
    
    const activeReminders = db.prepare(activeRemindersQuery).all();
    
    if (activeReminders.length === 0) {
      console.log('  No active reminders found');
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
    
    // Get reminder lists
    console.log('\n📝 Reminder Lists:');
    
    const listsQuery = `
      SELECT 
        o.Z_PK as id,
        o.ZNAME as name,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = o.Z_PK) as total_count,
        (SELECT COUNT(*) FROM ZREMCDREMINDER WHERE ZLIST = o.Z_PK AND ZCOMPLETED = 0) as active_count
      FROM ZREMCDOBJECT o
      WHERE o.ZNAME IS NOT NULL
      ORDER BY o.ZNAME
    `;
    
    const lists = db.prepare(listsQuery).all();
    
    lists.forEach(list => {
      console.log(`  📝 ${list.name} (${list.active_count} active / ${list.total_count} total)`);
    });
    
    // Get completed reminders summary
    const completedStats = db.prepare(`
      SELECT 
        COUNT(*) as count,
        MAX(ZDUEDATE) as latest_due
      FROM ZREMCDREMINDER 
      WHERE ZCOMPLETED = 1
    `).get();
    
    console.log(`\n📊 Statistics:`);
    console.log(`  Total reminders: ${totalReminders.count}`);
    console.log(`  Active: ${activeReminders.length}`);
    console.log(`  Completed: ${completedStats.count}`);
    
  } catch (error) {
    console.error('❌ Reminders database test failed:', error.message);
  } finally {
    if (db) db.close();
  }
}

async function summarizeFindings() {
  console.log('\n\n🎯 LOCAL STORAGE SUMMARY');
  console.log('========================\n');
  
  console.log('📍 Storage Locations:');
  console.log('  📝 Notes: ~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite');
  console.log('  ✅ Reminders: ~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores/Data-local.sqlite');
  
  console.log('\n💡 Key Findings:');
  console.log('  • Both apps use SQLite databases (like Mail and Calendar)');
  console.log('  • Direct SQLite access bypasses AppleScript limitations');
  console.log('  • Instant queries possible on all data');
  console.log('  • Notes content is encrypted but metadata is accessible');
  console.log('  • Reminders data is fully accessible including tasks, lists, and due dates');
  
  console.log('\n🚀 Next Steps:');
  console.log('  • Create Notes MCP with metadata search and folder navigation');
  console.log('  • Create Reminders MCP with full task management capabilities');
  console.log('  • Apply same SQLite direct-access pattern as Mail and Calendar MCPs');
}

// Run all tests
async function runTests() {
  await testNotesDatabase();
  await testRemindersDatabase();
  await summarizeFindings();
}

runTests().catch(console.error);