#!/usr/bin/env node

import { HybridEmailClient } from './src/mail/hybrid-email-client.js';
import { MacMailDatabase } from './src/mail/mac-mail-db.js';

async function testHybridMailAccess() {
  console.log('🧪 Testing Hybrid Mac Mail Access');
  console.log('================================\n');

  const client = new HybridEmailClient();
  
  try {
    // Test 1: Initialize and connect
    console.log('🔌 Initializing hybrid client...');
    await client.initialize();
    console.log('  ✅ Connected successfully\n');

    // Test 2: Get basic statistics
    console.log('📊 Getting email statistics...');
    const stats = await client.getStatistics({ daysBack: 2, limit: 100 });
    
    console.log(`  Total messages: ${stats.totalMessages}`);
    console.log(`  Unique messages: ${stats.uniqueMessages}`);
    console.log(`  Unread: ${stats.unreadMessages} (${Math.round(stats.unreadMessages/stats.totalMessages*100)}%)`);
    console.log(`  Flagged: ${stats.flaggedMessages}`);
    console.log(`\n  By Source:`);
    console.log(`    Mac Mail: ${stats.bySource.macMail}`);
    console.log(`    IMAP: ${stats.bySource.imap}`);
    
    if (stats.deduplicationStats.duplicatesRemoved > 0) {
      console.log(`\n  📋 Deduplication:`);
      console.log(`    Duplicates removed: ${stats.deduplicationStats.duplicatesRemoved}`);
      console.log(`    Methods used: ${JSON.stringify(stats.deduplicationStats.deduplicationMethods, null, 6)}`);
    }

    // Test 3: Show accounts
    console.log(`\n📧 By Account:`);
    Object.entries(stats.byAccount)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .forEach(([account, data]) => {
        console.log(`  ${account} (${data.source}):`);
        console.log(`    Total: ${data.total}, Unread: ${data.unread}`);
      });

    // Test 4: Top senders
    console.log(`\n👥 Top Senders:`);
    stats.topSenders.slice(0, 10).forEach(({ sender, count }) => {
      const displaySender = sender.length > 40 ? sender.substring(0, 37) + '...' : sender;
      console.log(`  ${displaySender}: ${count} emails`);
    });

    // Test 5: Get recent messages
    console.log(`\n📋 Recent Messages (last 10):`);
    const messages = await client.getMessages({ daysBack: 2, limit: 10, includeContent: false });
    
    messages.forEach((msg, i) => {
      const time = msg.date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const status = msg.isRead ? '' : '📬 ';
      const source = msg.source === 'mac-mail' ? '🖥️' : '📧';
      
      console.log(`\n${i + 1}. ${time} ${status}${source} ${msg.subject.substring(0, 50)}...`);
      console.log(`   From: ${msg.from.substring(0, 40)}...`);
      console.log(`   Account: ${msg.account} (${msg.accountType})`);
      if (msg.globalMessageId) {
        console.log(`   Global ID: ${msg.globalMessageId}`);
      }
    });

    // Test 6: Available accounts
    console.log(`\n🗂️  Available Accounts:`);
    const accounts = await client.getAvailableAccounts();
    accounts.forEach(account => {
      const source = account.source === 'mac-mail' ? '🖥️' : '📧';
      console.log(`  ${source} ${account.name} (${account.type})`);
      if (account.messageCount !== undefined) {
        console.log(`    Unseen: ${account.messageCount}`);
      }
    });

    // Test 7: Test duplicate detection
    console.log(`\n🔍 Testing duplicate detection...`);
    const { duplicateGroups } = await client.findDuplicates({ daysBack: 7, limit: 500 });
    
    if (duplicateGroups.length > 0) {
      console.log(`  Found ${duplicateGroups.length} groups of potential duplicates:`);
      duplicateGroups.slice(0, 3).forEach((group, i) => {
        console.log(`\n  Group ${i + 1} (${group.length} messages):`);
        group.forEach(msg => {
          console.log(`    ${msg.source}: "${msg.subject.substring(0, 40)}..." from ${msg.from.substring(0, 30)}`);
        });
      });
    } else {
      console.log(`  ✅ No duplicates found`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.close();
  }
}

// Test direct Mac Mail database access
async function testDirectDatabaseAccess() {
  console.log('\n\n🗃️  Testing Direct Database Access');
  console.log('=================================\n');

  const db = new MacMailDatabase();
  
  try {
    await db.connect();
    
    // Get overall statistics
    const stats = await db.getStatistics();
    console.log('📊 Database Statistics:');
    console.log(`  Total messages: ${stats.totalMessages.toLocaleString()}`);
    console.log(`  Unread messages: ${stats.unreadMessages.toLocaleString()}`);
    console.log(`  Flagged messages: ${stats.flaggedMessages.toLocaleString()}`);
    console.log(`  Total accounts: ${stats.totalAccounts}`);
    console.log(`  Total mailboxes: ${stats.totalMailboxes}`);

    // Get recent messages
    console.log('\n📋 Testing recent message query...');
    const recentMessages = await db.getRecentMessages(2, 20);
    console.log(`  Retrieved ${recentMessages.length} recent messages`);
    
    if (recentMessages.length > 0) {
      console.log('\n  Sample messages:');
      recentMessages.slice(0, 5).forEach((msg, i) => {
        console.log(`    ${i + 1}. ${msg.subject.substring(0, 40)}...`);
        console.log(`       From: ${msg.sender.substring(0, 30)}... (${msg.accountType})`);
        console.log(`       Date: ${msg.dateReceived.toLocaleString()}`);
        console.log(`       Read: ${msg.isRead}, Flagged: ${msg.isFlagged}`);
      });
    }

    // Test mailbox enumeration
    console.log('\n📁 Testing mailbox enumeration...');
    const mailboxes = await db.getMailboxes();
    console.log(`  Found ${mailboxes.length} accounts with mailboxes:`);
    
    mailboxes.forEach(account => {
      console.log(`\n  ${account.name} (${account.type}):`);
      account.mailboxes.slice(0, 5).forEach(mb => {
        console.log(`    ${mb.name}: ${mb.unseenCount} unseen`);
      });
      if (account.mailboxes.length > 5) {
        console.log(`    ... and ${account.mailboxes.length - 5} more mailboxes`);
      }
    });

  } catch (error) {
    console.error('❌ Database test failed:', error.message);
  } finally {
    db.close();
  }
}

// Run tests
console.log('Starting hybrid Mac Mail tests...\n');

testDirectDatabaseAccess()
  .then(() => testHybridMailAccess())
  .catch(console.error);