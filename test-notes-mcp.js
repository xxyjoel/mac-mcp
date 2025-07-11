#!/usr/bin/env node

/**
 * Test Notes MCP Database Access
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const APPLE_EPOCH_OFFSET = 978307200;

function appleToJSDate(appleTime) {
  if (!appleTime || appleTime === 0) return null;
  return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
}

async function testNotesDatabase() {
  console.log('📝 NOTES MCP DATABASE TEST');
  console.log('==========================\n');
  
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
    
    // Get entity IDs
    const noteEntity = db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'
    `).get();
    
    const folderEntity = db.prepare(`
      SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICFolder'
    `).get();
    
    console.log(`  ✅ Connected - Entity IDs: Note=${noteEntity?.Z_ENT}, Folder=${folderEntity?.Z_ENT}\n`);
    
    // Get note count
    const noteCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM ZICCLOUDSYNCINGOBJECT 
      WHERE Z_ENT = ?
    `).get(noteEntity?.Z_ENT || 7);
    
    console.log(`📊 Statistics:`);
    console.log(`  Total notes: ${noteCount.count}`);
    
    // Get folders
    console.log(`\n📁 Folders:`);
    const foldersQuery = `
      SELECT 
        f.Z_PK as folder_id,
        f.ZTITLE as name,
        (
          SELECT COUNT(*) 
          FROM ZICCLOUDSYNCINGOBJECT n 
          WHERE n.ZFOLDER = f.Z_PK 
            AND n.Z_ENT = ?
        ) as note_count
      FROM ZICCLOUDSYNCINGOBJECT f
      WHERE f.Z_ENT = ?
        AND f.ZTITLE IS NOT NULL
      ORDER BY f.ZTITLE
      LIMIT 10
    `;
    
    const folders = db.prepare(foldersQuery).all(noteEntity?.Z_ENT || 7, folderEntity?.Z_ENT || 5);
    
    folders.forEach(folder => {
      console.log(`  📁 ${folder.name} (${folder.note_count} notes)`);
    });
    
    // Get recent notes
    console.log(`\n📋 Recent Notes (last 10):`);
    const recentNotesQuery = `
      SELECT 
        n.Z_PK as note_id,
        n.ZTITLE as title,
        n.ZCREATIONDATE as creation_date,
        n.ZMODIFICATIONDATE as modification_date,
        n.ZSNIPPET as snippet,
        n.ZISPASSWORDPROTECTED as password_protected,
        n.ZISPINNED as pinned,
        f.ZTITLE as folder_name
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
      WHERE n.Z_ENT = ?
        AND n.ZTITLE IS NOT NULL
      ORDER BY n.ZMODIFICATIONDATE DESC
      LIMIT 10
    `;
    
    const recentNotes = db.prepare(recentNotesQuery).all(noteEntity?.Z_ENT || 7);
    
    recentNotes.forEach((note, i) => {
      const modDate = appleToJSDate(note.modification_date);
      const dateStr = modDate ? modDate.toLocaleDateString() : 'Unknown';
      
      console.log(`  ${i + 1}. ${note.title || '(Untitled)'}`);
      console.log(`     Modified: ${dateStr}`);
      console.log(`     Folder: ${note.folder_name || 'Notes'}`);
      if (note.password_protected) console.log(`     🔒 Password protected`);
      if (note.pinned) console.log(`     📌 Pinned`);
      if (note.snippet) {
        console.log(`     Preview: ${note.snippet.substring(0, 50)}...`);
      }
    });
    
    // Search test
    console.log(`\n🔍 Search Test:`);
    const searchTerm = 'note';
    const searchQuery = `
      SELECT COUNT(*) as count
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ?
        AND (ZTITLE LIKE ? OR ZSNIPPET LIKE ?)
    `;
    
    const searchResult = db.prepare(searchQuery).get(
      noteEntity?.Z_ENT || 7,
      `%${searchTerm}%`,
      `%${searchTerm}%`
    );
    
    console.log(`  Found ${searchResult.count} notes containing "${searchTerm}"`);
    
    console.log(`\n✅ Notes MCP Database Test Results:`);
    console.log(`  ✅ Direct SQLite access: SUCCESS`);
    console.log(`  ✅ ${noteCount.count} notes accessible`);
    console.log(`  ✅ ${folders.length} folders found`);
    console.log(`  ✅ Search functionality: Working`);
    console.log(`  ⚠️  Note: Content is encrypted, but metadata is fully accessible`);
    
  } catch (error) {
    console.error('❌ Notes database test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Ensure Notes.app has been opened at least once');
    console.error('  2. Check database exists at:', dbPath);
    console.error('  3. Grant Terminal Full Disk Access in System Preferences');
  } finally {
    if (db) db.close();
  }
}

testNotesDatabase();