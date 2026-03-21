
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'daily_digest.json');

function load() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function today() {
  return new Date().toISOString().slice(0,10);
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate()+1);
  return d.toISOString().slice(0,10);
}

function setDigest(chatId, reminders, goal, raw) {
  const data = load();
  if (!data[chatId]) data[chatId] = {};
  data[chatId][tomorrow()] = {
    reminders,
    goal,
    rawUserReply: raw,
    createdAt: new Date().toISOString()
  };
  save(data);
}

function getDigest(chatId, date) {
  const data = load();
  if (!data[chatId]) return null;
  return data[chatId][date] || null;
}

function formatDigest(chatId, weather, quote) {
  const date = today();
  const entry = getDigest(chatId, date);

  if (!entry) {
    return `Good morning ☀️\n\nYou didn't set a plan last night.\nWhat's the ONE thing you want to achieve today?`;
  }

  const reminders = entry.reminders.map(r => "• " + r).join("\n");

  return `Good morning ☀️

Weather: ${weather}

Reminders:
${reminders}

Today's One Goal:
${entry.goal}

Quote of the day:
"${quote}"`;
}

module.exports = {
  setDigest,
  getDigest,
  formatDigest
};
