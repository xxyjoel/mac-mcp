#!/usr/bin/env node

/**
 * Joel's Personal Mac Stats - Creative Analytics Across All MCP Services
 * Get ready for some mind-blowing insights about your digital life!
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const APPLE_EPOCH_OFFSET = 978307200;

function appleToJSDate(appleTime) {
  if (!appleTime || appleTime === 0) return null;
  return new Date((appleTime + APPLE_EPOCH_OFFSET) * 1000);
}

function getEmoji(hour) {
  if (hour >= 5 && hour < 9) return '☕';
  if (hour >= 9 && hour < 12) return '🌅';
  if (hour >= 12 && hour < 17) return '☀️';
  if (hour >= 17 && hour < 21) return '🌆';
  return '🌙';
}

async function getJoelStats() {
  console.log('🎯 JOEL\'S PERSONAL MAC UNIVERSE ANALYTICS');
  console.log('==========================================');
  console.log('Analyzing your digital footprint across all Apple apps...\n');
  
  const stats = {
    mail: {},
    calendar: {},
    notes: {},
    reminders: {},
    insights: []
  };
  
  // MAIL ANALYTICS
  console.log('📧 EMAIL UNIVERSE ANALYSIS');
  console.log('--------------------------');
  try {
    const mailDb = new Database(
      join(homedir(), 'Library', 'Mail', 'V10', 'MailData', 'Envelope Index'),
      { readonly: true }
    );
    
    // Total email volume
    const total = mailDb.prepare('SELECT COUNT(*) as count FROM messages').get();
    const unread = mailDb.prepare('SELECT COUNT(*) as count FROM messages WHERE read = 0').get();
    
    console.log(`📊 Total Email Empire: ${total.count.toLocaleString()} messages`);
    console.log(`📬 Unread Burden: ${unread.count.toLocaleString()} (${Math.round(unread.count/total.count*100)}%)`);
    
    // Email velocity
    const lastWeek = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
    const weeklyVolume = mailDb.prepare('SELECT COUNT(*) as count FROM messages WHERE date_received > ?').get(lastWeek);
    const dailyAvg = Math.round(weeklyVolume.count / 7);
    
    console.log(`⚡ Email Velocity: ${dailyAvg} emails/day (${weeklyVolume.count} this week)`);
    
    // Top senders
    console.log('\n👥 Your Email Inner Circle:');
    const topSenders = mailDb.prepare(`
      SELECT 
        a.address,
        a.comment,
        COUNT(*) as count
      FROM messages m
      JOIN addresses a ON m.sender = a.ROWID
      WHERE m.date_received > ?
      GROUP BY a.ROWID
      ORDER BY count DESC
      LIMIT 5
    `).all(lastWeek);
    
    topSenders.forEach((sender, i) => {
      const name = sender.comment || sender.address;
      const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
      console.log(`  ${emoji} ${name}: ${sender.count} emails`);
    });
    
    // Email patterns
    const hourlyPattern = mailDb.prepare(`
      SELECT 
        CAST(strftime('%H', datetime(date_received)) AS INTEGER) as hour,
        COUNT(*) as count
      FROM messages
      WHERE date_received > ?
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 1
    `).get(lastWeek);
    
    const peakHour = hourlyPattern?.hour || 0;
    console.log(`\n⏰ Peak Email Hour: ${peakHour}:00 ${getEmoji(peakHour)} (${hourlyPattern?.count || 0} emails)`);
    
    // Job search intensity
    const jobEmails = mailDb.prepare(`
      SELECT COUNT(*) as count
      FROM messages m
      JOIN subjects s ON m.subject = s.ROWID
      WHERE m.date_received > ?
        AND (s.subject LIKE '%job%' OR s.subject LIKE '%opportunity%' OR s.subject LIKE '%position%' OR s.subject LIKE '%linkedin%')
    `).get(lastWeek);
    
    console.log(`💼 Job Hunt Intensity: ${jobEmails.count} career-related emails this week`);
    
    stats.mail = { total: total.count, unread: unread.count, dailyAvg, jobEmails: jobEmails.count };
    mailDb.close();
    
  } catch (error) {
    console.log(`❌ Mail analysis failed: ${error.message}`);
  }
  
  // CALENDAR ANALYTICS
  console.log('\n\n📅 CALENDAR LIFESTYLE ANALYSIS');
  console.log('-------------------------------');
  try {
    const calendarDb = new Database(
      join(homedir(), 'Library', 'Group Containers', 'group.com.apple.calendar', 'Calendar.sqlitedb'),
      { readonly: true }
    );
    
    // Meeting load
    const now = (Date.now() / 1000) - APPLE_EPOCH_OFFSET;
    const weekAgo = now - (7 * 24 * 60 * 60);
    const monthAgo = now - (30 * 24 * 60 * 60);
    
    const weeklyMeetings = calendarDb.prepare(`
      SELECT COUNT(*) as count
      FROM CalendarItem
      WHERE start_date > ? AND start_date < ?
        AND (summary LIKE '%meeting%' OR summary LIKE '%call%' OR summary LIKE '%sync%' OR summary LIKE '%standup%')
    `).get(weekAgo, now);
    
    console.log(`🤝 Meeting Load: ${weeklyMeetings.count} meetings this week`);
    
    // Work-life balance
    const personalEvents = calendarDb.prepare(`
      SELECT COUNT(*) as count
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      WHERE ci.start_date > ? AND ci.start_date < ?
        AND c.title = 'Personal'
    `).get(monthAgo, now);
    
    const workEvents = calendarDb.prepare(`
      SELECT COUNT(*) as count
      FROM CalendarItem ci
      JOIN Calendar c ON ci.calendar_id = c.ROWID
      WHERE ci.start_date > ? AND ci.start_date < ?
        AND (c.title LIKE '%work%' OR c.title LIKE '%@%')
    `).get(monthAgo, now);
    
    const balance = personalEvents.count > 0 ? Math.round((personalEvents.count / (personalEvents.count + workEvents.count)) * 100) : 0;
    console.log(`⚖️  Work-Life Balance: ${balance}% personal time`);
    console.log(`   📊 Personal: ${personalEvents.count} events | Work: ${workEvents.count} events`);
    
    // Busiest day
    const busiestDay = calendarDb.prepare(`
      SELECT 
        date(start_date + 978307200, 'unixepoch') as day,
        COUNT(*) as count
      FROM CalendarItem
      WHERE start_date > ? AND start_date < ?
      GROUP BY day
      ORDER BY count DESC
      LIMIT 1
    `).get(monthAgo, now);
    
    if (busiestDay) {
      console.log(`📈 Busiest Day: ${busiestDay.day} (${busiestDay.count} events)`);
    }
    
    // Upcoming week
    const nextWeek = now + (7 * 24 * 60 * 60);
    const upcoming = calendarDb.prepare(`
      SELECT COUNT(*) as count
      FROM CalendarItem
      WHERE start_date > ? AND start_date < ?
    `).get(now, nextWeek);
    
    console.log(`🔮 Next Week: ${upcoming.count} events scheduled`);
    
    stats.calendar = { weekly: weeklyMeetings.count, balance, upcoming: upcoming.count };
    calendarDb.close();
    
  } catch (error) {
    console.log(`❌ Calendar analysis failed: ${error.message}`);
  }
  
  // NOTES ANALYTICS
  console.log('\n\n📝 NOTES & KNOWLEDGE BASE');
  console.log('-------------------------');
  try {
    const notesDb = new Database(
      join(homedir(), 'Library', 'Group Containers', 'group.com.apple.notes', 'NoteStore.sqlite'),
      { readonly: true }
    );
    
    const noteEntity = notesDb.prepare("SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICNote'").get();
    const folderEntity = notesDb.prepare("SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = 'ICFolder'").get();
    
    const totalNotes = notesDb.prepare('SELECT COUNT(*) as count FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?').get(noteEntity?.Z_ENT || 11);
    const totalFolders = notesDb.prepare('SELECT COUNT(*) as count FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?').get(folderEntity?.Z_ENT || 14);
    
    console.log(`📚 Knowledge Repository: ${totalNotes.count} notes across ${totalFolders.count} folders`);
    
    // Note creation velocity
    const monthAgoApple = (Date.now() / 1000) - APPLE_EPOCH_OFFSET - (30 * 24 * 60 * 60);
    const recentNotes = notesDb.prepare(`
      SELECT COUNT(*) as count
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ? AND ZMODIFICATIONDATE > ?
    `).get(noteEntity?.Z_ENT || 11, monthAgoApple);
    
    console.log(`✍️  Recent Activity: ${recentNotes.count} notes updated in last 30 days`);
    
    // Password protected notes
    const lockedNotes = notesDb.prepare(`
      SELECT COUNT(*) as count
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ? AND ZISPASSWORDPROTECTED = 1
    `).get(noteEntity?.Z_ENT || 11);
    
    if (lockedNotes.count > 0) {
      console.log(`🔒 Secret Vault: ${lockedNotes.count} password-protected notes`);
    }
    
    // Pinned notes
    const pinnedNotes = notesDb.prepare(`
      SELECT COUNT(*) as count
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = ? AND ZISPINNED = 1
    `).get(noteEntity?.Z_ENT || 11);
    
    if (pinnedNotes.count > 0) {
      console.log(`📌 Priority Notes: ${pinnedNotes.count} pinned for quick access`);
    }
    
    stats.notes = { total: totalNotes.count, recent: recentNotes.count, locked: lockedNotes.count };
    notesDb.close();
    
  } catch (error) {
    console.log(`❌ Notes analysis failed: ${error.message}`);
  }
  
  // REMINDERS ANALYTICS
  console.log('\n\n✅ TASK MANAGEMENT STYLE');
  console.log('------------------------');
  try {
    const remindersDb = new Database(
      join(homedir(), 'Library', 'Group Containers', 'group.com.apple.reminders', 'Container_v1', 'Stores', 'Data-local.sqlite'),
      { readonly: true }
    );
    
    const total = remindersDb.prepare('SELECT COUNT(*) as count FROM ZREMCDREMINDER').get();
    const completed = remindersDb.prepare('SELECT COUNT(*) as count FROM ZREMCDREMINDER WHERE ZCOMPLETED = 1').get();
    const active = remindersDb.prepare('SELECT COUNT(*) as count FROM ZREMCDREMINDER WHERE ZCOMPLETED = 0').get();
    
    if (total.count > 0) {
      const completionRate = Math.round((completed.count / total.count) * 100);
      console.log(`📊 Task Completion Rate: ${completionRate}%`);
      console.log(`   ✅ Completed: ${completed.count} | 🔄 Active: ${active.count}`);
      
      // Overdue tasks
      const nowApple = (Date.now() / 1000) - APPLE_EPOCH_OFFSET;
      const overdue = remindersDb.prepare(`
        SELECT COUNT(*) as count
        FROM ZREMCDREMINDER
        WHERE ZCOMPLETED = 0 AND ZDUEDATE < ? AND ZDUEDATE IS NOT NULL
      `).get(nowApple);
      
      if (overdue.count > 0) {
        console.log(`⚠️  Overdue Tasks: ${overdue.count} need attention!`);
      }
    } else {
      console.log(`🧘 Zen Mode: No reminders - living in the moment!`);
    }
    
    stats.reminders = { total: total.count, completed: completed.count, active: active.count };
    remindersDb.close();
    
  } catch (error) {
    console.log(`❌ Reminders analysis failed: ${error.message}`);
  }
  
  // CREATIVE INSIGHTS
  console.log('\n\n🎨 JOEL\'S DIGITAL PERSONALITY INSIGHTS');
  console.log('======================================\n');
  
  // Email personality
  if (stats.mail.unread > 10000) {
    console.log(`📬 Email Style: "Inbox Zero? More like Inbox Infinity!" (${stats.mail.unread.toLocaleString()} unread)`);
  } else if (stats.mail.unread > 1000) {
    console.log(`📬 Email Style: "Selective Reader" - You know what's important`);
  }
  
  // Job search insight
  if (stats.mail.jobEmails > 50) {
    console.log(`💼 Career Mode: "Active Hunter" - ${stats.mail.jobEmails} job-related emails show you're on the move!`);
  } else if (stats.mail.jobEmails > 20) {
    console.log(`💼 Career Mode: "Opportunist" - Keeping options open with ${stats.mail.jobEmails} career emails`);
  }
  
  // Work-life insight
  if (stats.calendar.balance > 40) {
    console.log(`⚖️  Lifestyle: "Balance Master" - ${stats.calendar.balance}% personal time is impressive!`);
  } else if (stats.calendar.balance < 20) {
    console.log(`⚖️  Lifestyle: "Work Warrior" - Only ${stats.calendar.balance}% personal time. Time for a break?`);
  }
  
  // Digital footprint
  const totalDigitalItems = stats.mail.total + stats.calendar.upcoming + stats.notes.total + stats.reminders.total;
  console.log(`\n🌐 Total Digital Footprint: ${totalDigitalItems.toLocaleString()} items across all apps`);
  
  // Fun calculations
  if (stats.mail.total > 0) {
    const emailYears = Math.round(stats.mail.total / 365 / stats.mail.dailyAvg);
    console.log(`📧 Email Archive: ${emailYears}+ years of email history`);
  }
  
  if (stats.notes.total > 0) {
    const avgNotesPerWeek = Math.round(stats.notes.recent / 4);
    console.log(`📝 Note Velocity: ~${avgNotesPerWeek} notes/week recently`);
  }
  
  // Final summary
  console.log('\n🏆 DIGITAL LIFE SUMMARY');
  console.log('======================');
  console.log(`📧 Email Empire: ${stats.mail.total.toLocaleString()} messages (${Math.round(stats.mail.unread/stats.mail.total*100)}% unread)`);
  console.log(`📅 Time Managed: ${stats.calendar.weekly} meetings/week, ${stats.calendar.upcoming} upcoming`);
  console.log(`📝 Knowledge Base: ${stats.notes.total} notes (${stats.notes.locked} secured)`);
  console.log(`✅ Task System: ${stats.reminders.total} total tasks`);
  
  console.log('\n✨ Your Mac is a productivity powerhouse with instant access to everything!');
}

getJoelStats().catch(console.error);