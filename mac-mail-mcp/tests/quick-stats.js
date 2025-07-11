#!/usr/bin/env node

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

async function getQuickStats() {
  console.log('📊 EMAIL SUMMARY - LAST 2 DAYS');
  console.log('==============================\n');
  
  const dbPath = join(homedir(), 'Library', 'Mail', 'V10', 'MailData', 'Envelope Index');
  const db = new Database(dbPath, { readonly: true });
  
  try {
    // Get cutoff timestamp for 2 days ago
    const cutoffTimestamp = Math.floor((Date.now() - (2 * 24 * 60 * 60 * 1000)) / 1000);
    
    // Get recent messages with account info
    const messageQuery = `
      SELECT DISTINCT
        m.ROWID as message_id,
        m.global_message_id,
        COALESCE(s.subject, '[No Subject]') as subject,
        COALESCE(a.address, a.comment, '[Unknown]') as sender,
        m.date_received,
        m.read as is_read,
        m.flagged as is_flagged,
        mb.url as mailbox_url
      FROM messages m
      LEFT JOIN subjects s ON m.subject = s.ROWID
      LEFT JOIN addresses a ON m.sender = a.ROWID
      LEFT JOIN mailboxes mb ON m.mailbox = mb.ROWID
      WHERE m.date_received > ?
      ORDER BY m.date_received DESC
      LIMIT 500
    `;
    
    const messages = db.prepare(messageQuery).all(cutoffTimestamp);
    
    // Extract account info from URLs
    const extractAccount = (url) => {
      const match = url?.match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i);
      return match ? match[0].substring(0, 8) + '...' : 'Unknown';
    };
    
    const getAccountType = (url) => {
      if (!url) return 'Unknown';
      if (url.startsWith('imap://')) return 'IMAP';
      if (url.startsWith('ews://')) return 'Exchange';
      if (url.startsWith('pop://')) return 'POP3';
      return 'Other';
    };
    
    // Process messages
    const processedMessages = messages.map(msg => ({
      ...msg,
      account: extractAccount(msg.mailbox_url),
      accountType: getAccountType(msg.mailbox_url),
      date: new Date(msg.date_received * 1000)
    }));
    
    // Calculate stats
    const totalMessages = processedMessages.length;
    const unreadMessages = processedMessages.filter(m => !m.is_read).length;
    const flaggedMessages = processedMessages.filter(m => m.is_flagged).length;
    
    console.log(`📧 OVERVIEW:`);
    console.log(`  Total emails: ${totalMessages}`);
    console.log(`  Unread: ${unreadMessages} (${Math.round(unreadMessages/totalMessages*100)}%)`);
    console.log(`  Flagged: ${flaggedMessages}`);
    
    // Group by account
    const accountStats = {};
    processedMessages.forEach(msg => {
      const key = `${msg.account} (${msg.accountType})`;
      if (!accountStats[key]) {
        accountStats[key] = { total: 0, unread: 0 };
      }
      accountStats[key].total++;
      if (!msg.is_read) accountStats[key].unread++;
    });
    
    console.log(`\n📧 BY ACCOUNT:`);
    Object.entries(accountStats)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([account, stats]) => {
        console.log(`  ${account}: ${stats.total} emails (${stats.unread} unread)`);
      });
    
    // Top senders
    const senderCounts = {};
    processedMessages.forEach(msg => {
      const sender = msg.sender.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;
    });
    
    console.log(`\n👥 TOP SENDERS:`);
    Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([sender, count]) => {
        const shortSender = sender.length > 35 ? sender.substring(0, 32) + '...' : sender;
        console.log(`  ${shortSender}: ${count}`);
      });
    
    // Recent sample
    console.log(`\n📋 RECENT MESSAGES (last 10):`);
    processedMessages.slice(0, 10).forEach((msg, i) => {
      const time = msg.date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const status = msg.is_read ? '' : '📬 ';
      const flagStatus = msg.is_flagged ? '🚩 ' : '';
      
      console.log(`\n${i + 1}. ${time} ${status}${flagStatus}${msg.subject.substring(0, 50)}...`);
      console.log(`   From: ${msg.sender.substring(0, 40)}...`);
      console.log(`   Account: ${msg.account} (${msg.accountType})`);
    });
    
    // Show duplicates based on global_message_id
    const globalIds = new Set();
    const duplicates = [];
    processedMessages.forEach(msg => {
      if (globalIds.has(msg.global_message_id)) {
        duplicates.push(msg);
      } else {
        globalIds.add(msg.global_message_id);
      }
    });
    
    if (duplicates.length > 0) {
      console.log(`\n🔍 POTENTIAL DUPLICATES:`);
      console.log(`  Found ${duplicates.length} messages with duplicate global IDs`);
    } else {
      console.log(`\n✅ No obvious duplicates found in recent messages`);
    }
    
  } finally {
    db.close();
  }
}

getQuickStats().catch(console.error);