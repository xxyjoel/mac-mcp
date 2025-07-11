#!/usr/bin/env node
import { MailClient } from './dist/mail/client.js';
import { SecurityManager } from './dist/mail/security.js';

console.log('🧪 Mac Mail MCP - Quick Test\n');

const client = new MailClient();
const security = new SecurityManager();

async function runTest() {
  try {
    // Check permissions
    console.log('1️⃣ Checking Mail permissions...');
    await security.checkPermissions('mail.read');
    console.log('✅ Mail permissions granted\n');
    
    // List folders
    console.log('2️⃣ Listing mail folders...');
    const folders = await client.listFolders();
    console.log(`Found ${folders.length} folders`);
    
    // Show first few folders
    folders.slice(0, 5).forEach(folder => {
      console.log(`  - ${folder.name} (${folder.accountName}): ${folder.messageCount} messages, ${folder.unreadCount} unread`);
    });
    
    if (folders.length > 5) {
      console.log(`  ... and ${folders.length - 5} more folders`);
    }
    
    // List recent messages from INBOX
    console.log('\n3️⃣ Getting recent messages from INBOX...');
    const messages = await client.listMessages('INBOX', 5);
    console.log(`Found ${messages.length} recent messages:`);
    
    messages.forEach((msg, i) => {
      console.log(`\n  Message ${i + 1}:`);
      console.log(`    Subject: ${msg.subject}`);
      console.log(`    From: ${msg.sender}`);
      console.log(`    Date: ${new Date(msg.dateReceived).toLocaleString()}`);
      console.log(`    Mailbox: ${msg.mailbox} (${msg.accountName})`);
      if (msg.snippet) {
        console.log(`    Preview: ${msg.snippet.substring(0, 50)}...`);
      }
    });
    
    // Test search
    console.log('\n4️⃣ Testing search (searching for "test")...');
    const searchResults = await client.searchMessages('test', 'subject', 3);
    console.log(`Found ${searchResults.length} messages with "test" in subject`);
    
    console.log('\n✅ All tests passed! Mac Mail MCP is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.message.includes('permissions')) {
      console.error('\n💡 To fix this:');
      console.error('1. Open System Preferences > Security & Privacy > Privacy > Automation');
      console.error('2. Find Terminal (or your terminal app) in the list');
      console.error('3. Check the box next to Mail');
    }
  }
}

runTest();