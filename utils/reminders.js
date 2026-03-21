const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/reminders.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function save(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

// Parse natural language reminder phrases.
// Supported:
//   "remind me in 30 minutes to call John"
//   "remind me in 2 hours to take medication"
//   "remind me at 3pm to submit the report"
//   "remind me at 15:30 to leave"
//   "remind me tomorrow at 9am to check emails"
// Returns { dueAt: Date, text: string } or null
function parseReminderText(input) {
  const reminderMatch = input.match(/^remind(?:\s+me)?\s+(.+)$/i);
  if (!reminderMatch) return null;

  const rest = reminderMatch[1].trim();

  // "in X minutes/hours/days to Y"
  const inMatch = rest.match(/^in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?)\s+(?:to\s+)?(.+)$/i);
  if (inMatch) {
    const qty = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const text = inMatch[3].trim();
    const dueAt = new Date();
    if (unit.startsWith('min')) dueAt.setMinutes(dueAt.getMinutes() + qty);
    else if (unit.startsWith('hour') || unit.startsWith('hr')) dueAt.setHours(dueAt.getHours() + qty);
    else if (unit.startsWith('day')) dueAt.setDate(dueAt.getDate() + qty);
    return { dueAt, text };
  }

  // "tomorrow at 3pm to Y" / "tomorrow at 15:00 to Y"
  const tomorrowMatch = rest.match(/^tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to\s+)?(.+)$/i);
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1]);
    const minute = parseInt(tomorrowMatch[2] || '0');
    const ampm = (tomorrowMatch[3] || '').toLowerCase();
    const text = tomorrowMatch[4].trim();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 1);
    dueAt.setHours(hour, minute, 0, 0);
    return { dueAt, text };
  }

  // "at 3pm to Y" / "at 15:00 to Y"
  const atMatch = rest.match(/^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to\s+)?(.+)$/i);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const minute = parseInt(atMatch[2] || '0');
    const ampm = (atMatch[3] || '').toLowerCase();
    const text = atMatch[4].trim();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const dueAt = new Date();
    dueAt.setHours(hour, minute, 0, 0);
    // Already passed today → push to tomorrow
    if (dueAt <= new Date()) dueAt.setDate(dueAt.getDate() + 1);
    return { dueAt, text };
  }

  return null;
}

function addReminder(chatId, text, dueAt) {
  const list = load();
  list.push({ chatId, text, dueAt: dueAt.toISOString(), created: new Date().toISOString() });
  save(list);
}

function listReminders(chatId) {
  return load().filter(r => r.chatId === chatId);
}

function deleteReminder(chatId, index) {
  const list = load();
  const userList = list.filter(r => r.chatId === chatId);
  if (index < 0 || index >= userList.length) return false;
  const target = userList[index];
  const newList = list.filter(r => !(r.chatId === chatId && r.dueAt === target.dueAt && r.text === target.text));
  save(newList);
  return true;
}

function formatDueAt(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = d - now;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin} min`;
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `today at ${hh}:${mm}`;
  const isTomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  if (isTomorrow) return `tomorrow at ${hh}:${mm}`;
  return `${d.toLocaleDateString()} at ${hh}:${mm}`;
}

let sendMessageFn = null;
let loopStarted = false;

function init(sendFn) {
  sendMessageFn = sendFn;
  if (loopStarted) return;
  loopStarted = true;
  setInterval(() => {
    const now = new Date();
    const list = load();
    const due = list.filter(r => new Date(r.dueAt) <= now);
    const remaining = list.filter(r => new Date(r.dueAt) > now);
    for (const r of due) {
      if (sendMessageFn) {
        try { sendMessageFn(r.chatId, `⏰ *Reminder:* ${r.text}`); } catch {}
      }
    }
    if (due.length > 0) save(remaining);
  }, 60000);
}

module.exports = {
  init,
  parseReminderText,
  addReminder,
  listReminders,
  deleteReminder,
  formatDueAt,
};
