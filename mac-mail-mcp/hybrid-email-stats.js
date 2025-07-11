#!/usr/bin/env node

import { connect as tlsConnect } from 'tls';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '.imap-accounts.json');
const execAsync = promisify(exec);

// IMAP handler for Gmail accounts
class GmailIMAPHandler {
  constructor(config) {
    this.config = config;
  }
  
  async getRecentMessages(daysBack = 2, limit = 200) {
    const socket = tlsConnect({
      host: this.config.host,
      port: this.config.port,
      rejectUnauthorized: false,
      servername: this.config.host
    });
    
    let buffer = '';
    let commandTag = 1;
    
    const sendCommand = (command) => {
      return new Promise((resolve, reject) => {
        const tag = `A${String(commandTag++).padStart(3, '0')}`;
        const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
        
        const handler = (data) => {
          buffer += data.toString();
          if (buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`)) {
            clearTimeout(timeout);
            socket.removeListener('data', handler);
            const result = buffer;
            buffer = '';
            resolve(result);
          }
        };
        
        socket.on('data', handler);
        socket.write(`${tag} ${command}\r\n`);
      });
    };
    
    try {
      // Connect and authenticate
      await new Promise(resolve => {
        socket.once('connect', () => {
          setTimeout(resolve, 1000);
        });
      });
      
      await sendCommand(`LOGIN "${this.config.username}" "${this.config.password}"`);
      
      // Select All Mail
      await sendCommand('EXAMINE "[Gmail]/All Mail"');
      
      // Search for recent messages
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - daysBack);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${targetDate.getDate()}-${months[targetDate.getMonth()]}-${targetDate.getFullYear()}`;
      
      const searchResponse = await sendCommand(`UID SEARCH SINCE ${dateStr}`);
      const searchMatch = searchResponse.match(/\* SEARCH([^\r\n]*)/);
      const uids = searchMatch && searchMatch[1] ? searchMatch[1].trim().split(' ').filter(id => id) : [];
      
      const messages = [];
      const recentUids = uids.slice(-limit).reverse();
      
      // Fetch in batches
      for (let i = 0; i < recentUids.length; i += 20) {
        const batch = recentUids.slice(i, i + 20).join(',');
        
        const fetchData = await sendCommand(
          `UID FETCH ${batch} (FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`
        );
        
        // Parse messages
        const msgParts = fetchData.split(/\* \d+ FETCH/).slice(1);
        
        for (const part of msgParts) {
          const dateMatch = part.match(/INTERNALDATE "([^"]+)"/);
          const headerMatch = part.match(/\{(\d+)\}\r\n([\s\S]*?)(?=\r\n\)|\r\n\* |\r\nA\d+)/);
          const flagsMatch = part.match(/FLAGS \(([^)]*)\)/);
          
          if (dateMatch && headerMatch) {
            const headers = headerMatch[2];
            const fromMatch = headers.match(/From: ([^\r\n]+)/i);
            const subjectMatch = headers.match(/Subject: ([^\r\n]+)/i);
            
            messages.push({
              date: new Date(dateMatch[1]),
              from: fromMatch ? fromMatch[1].trim() : 'Unknown',
              subject: subjectMatch ? subjectMatch[1].trim() : '(no subject)',
              isRead: !flagsMatch || flagsMatch[1].includes('\\Seen'),
              account: this.config.username,
              source: 'IMAP'
            });
          }
        }
      }
      
      await sendCommand('LOGOUT');
      socket.end();
      
      return messages;
    } catch (error) {
      socket.end();
      throw error;
    }
  }
}

// Mac Mail handler for non-Gmail accounts
class MacMailHandler {
  async getRecentMessages(targetAccounts = [], daysBack = 2, limit = 20) {
    console.log(`  📱 Querying Mac Mail (limit: ${limit} messages)...`);
    
    // Build account filter
    const accountFilter = targetAccounts.length > 0 
      ? targetAccounts.map(acc => `(name of account of it contains "${acc}")`).join(' or ')
      : 'true';
    
    const script = `
      tell application "Mail"
        set resultList to {}
        set messageCount to 0
        set cutoffDate to (current date) - (${daysBack} * days)
        
        try
          -- Get just the first N messages from inbox
          set recentMessages to messages 1 through ${limit * 2} of inbox
          
          repeat with msg in recentMessages
            try
              if date received of msg > cutoffDate then
                if ${accountFilter} then
                  set msgInfo to {msgSubject:subject of msg, msgSender:sender of msg, ¬
                    msgDate:(date received of msg) as string, msgRead:read status of msg, ¬
                    msgAccount:name of account of mailbox of msg}
                  
                  set end of resultList to msgInfo
                  set messageCount to messageCount + 1
                  
                  if messageCount ≥ ${limit} then exit repeat
                end if
              end if
            end try
          end repeat
          
          return resultList
        on error errMsg
          return {}
        end try
      end tell
    `;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
        timeout: 30000
      });
      
      const messages = [];
      
      // Parse AppleScript record format
      const msgPattern = /\{msgSubject:([^,}]+), msgSender:([^,}]+), msgDate:([^,}]+), msgRead:([^,}]+), msgAccount:([^}]+)\}/g;
      let match;
      
      while ((match = msgPattern.exec(stdout)) !== null) {
        messages.push({
          subject: match[1].trim(),
          from: match[2].trim(),
          date: new Date(match[3].trim()),
          isRead: match[4].trim() === 'true',
          account: match[5].trim(),
          source: 'Mac Mail'
        });
      }
      
      return messages;
    } catch (error) {
      console.log(`  ⚠️  Mac Mail query failed: ${error.message}`);
      return [];
    }
  }
}

// Main hybrid analysis
async function hybridEmailAnalysis() {
  console.log("🔀 Hybrid Email Analysis - Last 2 Days");
  console.log("=====================================\n");
  
  const allMessages = [];
  const results = {
    imap: { success: 0, failed: 0 },
    macmail: { success: 0, failed: 0 }
  };
  
  // Step 1: Process IMAP accounts (Gmail)
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    console.log(`📧 Processing ${config.accounts.length} IMAP accounts...\n`);
    
    for (const account of config.accounts) {
      console.log(`🔄 ${account.name} (IMAP)...`);
      
      try {
        const handler = new GmailIMAPHandler(account.config);
        const messages = await handler.getRecentMessages(2, 200);
        allMessages.push(...messages);
        results.imap.success++;
        console.log(`  ✅ Found ${messages.length} messages\n`);
      } catch (error) {
        results.imap.failed++;
        console.log(`  ❌ Failed: ${error.message}\n`);
      }
    }
  }
  
  // Step 2: Check Mac Mail for other accounts
  console.log("🖥️  Checking Mac Mail for additional accounts...\n");
  
  // Get list of Mac Mail accounts
  const accountListScript = `
    tell application "Mail"
      try
        set accountNames to {}
        repeat with acct in accounts
          set end of accountNames to name of acct
        end repeat
        return accountNames
      on error
        return {}
      end try
    end tell
  `;
  
  try {
    const { stdout } = await execAsync(`osascript -e '${accountListScript}'`, { timeout: 10000 });
    const macAccounts = stdout.trim().split(', ').filter(a => a);
    
    // Filter out Gmail accounts we already processed
    const imapEmails = existsSync(CONFIG_FILE) 
      ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')).accounts.map(a => a.name)
      : [];
    
    const nonGmailAccounts = macAccounts.filter(acc => 
      !imapEmails.some(email => acc.includes(email))
    );
    
    if (nonGmailAccounts.length > 0) {
      console.log(`Found ${nonGmailAccounts.length} non-Gmail accounts:`, nonGmailAccounts.join(', '));
      
      const macHandler = new MacMailHandler();
      const macMessages = await macHandler.getRecentMessages(nonGmailAccounts, 2, 30);
      
      if (macMessages.length > 0) {
        allMessages.push(...macMessages);
        results.macmail.success = nonGmailAccounts.length;
        console.log(`  ✅ Retrieved ${macMessages.length} messages from Mac Mail\n`);
      }
    } else {
      console.log("No additional non-Gmail accounts found in Mac Mail\n");
    }
  } catch (error) {
    console.log(`Mac Mail account check failed: ${error.message}\n`);
  }
  
  // Step 3: Analyze combined results
  if (allMessages.length === 0) {
    console.log("No messages found across any accounts");
    return;
  }
  
  // Sort by date
  allMessages.sort((a, b) => b.date - a.date);
  
  console.log("📊 COMBINED STATISTICS");
  console.log("====================\n");
  
  const stats = {
    total: allMessages.length,
    unread: allMessages.filter(m => !m.isRead).length,
    bySource: {
      imap: allMessages.filter(m => m.source === 'IMAP').length,
      macmail: allMessages.filter(m => m.source === 'Mac Mail').length
    }
  };
  
  console.log(`Total emails: ${stats.total}`);
  console.log(`  📥 From IMAP: ${stats.bySource.imap}`);
  console.log(`  🖥️  From Mac Mail: ${stats.bySource.macmail}`);
  console.log(`  📬 Unread: ${stats.unread} (${Math.round(stats.unread/stats.total*100)}%)\n`);
  
  // By account
  const byAccount = {};
  allMessages.forEach(msg => {
    const account = msg.account || 'Unknown';
    if (!byAccount[account]) {
      byAccount[account] = { total: 0, unread: 0, source: msg.source };
    }
    byAccount[account].total++;
    if (!msg.isRead) byAccount[account].unread++;
  });
  
  console.log("📧 BY ACCOUNT:");
  Object.entries(byAccount)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([account, data]) => {
      console.log(`\n${account} (${data.source}):`);
      console.log(`  Total: ${data.total} messages`);
      console.log(`  Unread: ${data.unread}`);
    });
  
  // Top senders
  const senders = {};
  allMessages.forEach(msg => {
    const sender = msg.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    senders[sender] = (senders[sender] || 0) + 1;
  });
  
  console.log("\n👥 TOP SENDERS (All Accounts):");
  Object.entries(senders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([sender, count]) => {
      const short = sender.length > 35 ? sender.substring(0, 32) + '...' : sender;
      console.log(`  ${short}: ${count} emails`);
    });
  
  // Recent messages
  console.log("\n📋 RECENT MESSAGES (Combined):");
  console.log("=============================\n");
  
  allMessages.slice(0, 20).forEach((msg, i) => {
    const time = msg.date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const status = msg.isRead ? '' : '📬 ';
    
    console.log(`${i + 1}. ${time} ${status}${msg.subject.substring(0, 50)}...`);
    console.log(`   From: ${msg.from.substring(0, 40)}...`);
    console.log(`   Account: ${msg.account} (${msg.source})\n`);
  });
  
  // Summary
  console.log("📊 PROCESSING SUMMARY:");
  console.log(`✅ IMAP: ${results.imap.success} succeeded, ${results.imap.failed} failed`);
  console.log(`✅ Mac Mail: ${results.macmail.success} accounts queried`);
  
  if (stats.bySource.macmail < 20 && results.macmail.success > 0) {
    console.log(`\n⚠️  Mac Mail returned limited results due to performance constraints`);
    console.log(`   Consider adding these accounts via IMAP for better access`);
  }
}

console.log("Starting hybrid email analysis...\n");
hybridEmailAnalysis().catch(console.error);