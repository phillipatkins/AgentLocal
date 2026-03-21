
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const botConfig = require('./bot_config');

const MEMORY_FILE = path.resolve(process.cwd(), 'memory.txt');
const IDENTITY_FILE = path.resolve(process.cwd(), 'identity.txt');
const SYSTEM_FILE = path.resolve(process.cwd(), 'system_prompt.txt');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DIGEST_FILE = path.join(DATA_DIR, 'daily_digest.json');
const REFLECTIONS_FILE = path.join(DATA_DIR, 'reflections.json');
const SCHEDULER_FILE = path.join(DATA_DIR, 'scheduler_state.json');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const HABITS_FILE = path.join(DATA_DIR, 'habits.json');
const MOOD_FILE = path.join(DATA_DIR, 'mood.json');
const PERSONALITIES_DIR = path.resolve(process.cwd(), 'personalities');

let USER_NAME = 'User';
let BOT_NAME = 'Peen';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureFile(filePath, fallback) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  try {
    ensureFile(filePath, fallback);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp.' + process.pid + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readText(filePath, fallback = '') {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function readMemoryContent() {
  return readText(MEMORY_FILE, '').trim();
}

function readIdentity() {
  const id = readText(IDENTITY_FILE, '').trim();
  const u = id.match(/User name:\s*(.+?)(?:\n|$)/i);
  const b = id.match(/Bot name:\s*(.+?)(?:\n|$)/i);
  if (u) USER_NAME = u[1].trim();
  if (b) BOT_NAME = b[1].trim();
}

function writeIdentity() {
  fs.writeFileSync(
    IDENTITY_FILE,
    `User name: ${USER_NAME}\nBot name: ${BOT_NAME}\n`,
    'utf8'
  );
}

function getSettings() {
  return readJson(SETTINGS_FILE, {
    personality: 'casual',
    fontStyle: 'normal',
    hackerMode: false,
    knownChats: {}
  });
}

function getFontStyle() {
  return getSettings().fontStyle || 'normal';
}

function setFontStyle(font) {
  const settings = getSettings();
  settings.fontStyle = String(font || 'normal');
  saveSettings(settings);
  return settings.fontStyle;
}

function getHackerMode() {
  return Boolean(getSettings().hackerMode);
}

function setHackerMode(value) {
  const settings = getSettings();
  settings.hackerMode = Boolean(value);
  saveSettings(settings);
  return settings.hackerMode;
}

function saveSettings(settings) {
  writeJson(SETTINGS_FILE, settings);
}

function getPersonality() {
  return getSettings().personality || 'casual';
}

function setPersonality(value) {
  const allowed = ['casual', 'professional', 'sarcastic'];
  const next = allowed.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'casual';
  const settings = getSettings();
  settings.personality = next;
  saveSettings(settings);
  return next;
}

function touchChat(chatId, senderName = '') {
  if (!chatId) return;
  const settings = getSettings();
  settings.knownChats[String(chatId)] = {
    senderName: senderName || settings.knownChats[String(chatId)]?.senderName || '',
    updatedAt: new Date().toISOString()
  };
  saveSettings(settings);
}

function getKnownChatIds() {
  return Object.keys(getSettings().knownChats || {});
}

function getUserNameForChat(chatId) {
  if (!chatId) return USER_NAME;
  const settings = getSettings();
  return settings.knownChats?.[String(chatId)]?.senderName || USER_NAME;
}

function personalityFallback(name) {
  const map = {
    casual: [
      'Personality mode: casual.',
      'Sound natural, warm and human.',
      'Do not overuse the user name.',
      'Do not sound robotic or overly formal.',
      'Keep replies conversational and direct.'
    ].join('\n'),
    professional: [
      'Personality mode: professional.',
      'Be clear, calm, polished and helpful.',
      'Keep the tone confident and respectful.',
      'Avoid slang unless the user uses it first.'
    ].join('\n'),
    sarcastic: [
      'Personality mode: sarcastic.',
      'Use light dry humour occasionally.',
      'Stay helpful and never mean.',
      'Do not force sarcasm into every reply.'
    ].join('\n')
  };
  return map[name] || map.casual;
}

function getPersonalityPrompt() {
  const name = getPersonality();
  const filePath = path.join(PERSONALITIES_DIR, `${name}.txt`);
  const text = readText(filePath, '').trim();
  return text || personalityFallback(name);
}

function getSystemPrompt() {
  readIdentity();
  const memory = readMemoryContent();
  const template = readText(SYSTEM_FILE, '').trim();
  return [
    template
      .replace(/{{BOT_NAME}}/g, BOT_NAME)
      .replace(/{{USER_NAME}}/g, USER_NAME)
      .replace(/{{MEMORY}}/g, memory || 'none'),
    '',
    getPersonalityPrompt()
  ].filter(Boolean).join('\n');
}

function loadAll() {
  readIdentity();
  ensureDir(DATA_DIR);
  ensureFile(SETTINGS_FILE, { personality: 'casual', knownChats: {} });
  ensureFile(DIGEST_FILE, {});
  ensureFile(REFLECTIONS_FILE, []);
  ensureFile(SCHEDULER_FILE, {});
  ensureFile(LOCATIONS_FILE, {});
  ensureFile(HABITS_FILE, {});
  ensureFile(MOOD_FILE, []);
  console.log(chalk.cyan('✓ Memory loaded'));
  console.log(chalk.cyan('✓ Identity loaded'));
  console.log(chalk.cyan('✓ Settings loaded'));
}

// ─── Habit Tracking ───────────────────────────────────────────────────────────

function logHabit(chatId, habit, value = true) {
  const data = readJson(HABITS_FILE, {});
  const key = String(chatId);
  data[key] = data[key] || {};
  const habitKey = String(habit).toLowerCase().trim();
  data[key][habitKey] = data[key][habitKey] || [];
  data[key][habitKey].push({
    date: todayDateString(),
    value,
    loggedAt: new Date().toISOString()
  });
  writeJson(HABITS_FILE, data);
  return { habit: habitKey, date: todayDateString(), value };
}

function getHabitStreak(chatId, habit) {
  const data = readJson(HABITS_FILE, {});
  const logs = data[String(chatId)]?.[String(habit).toLowerCase().trim()] || [];
  if (!logs.length) return 0;

  const dates = [...new Set(logs.map(l => l.date))].sort().reverse();
  let streak = 0;
  const today = todayDateString();
  let cursor = new Date(today);

  for (const date of dates) {
    const d = new Date(date);
    const expected = cursor.toISOString().slice(0, 10);
    if (date === expected) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function getHabitStats(chatId) {
  const data = readJson(HABITS_FILE, {});
  const chatHabits = data[String(chatId)] || {};
  const result = {};
  for (const habit of Object.keys(chatHabits)) {
    const logs = chatHabits[habit];
    const today = todayDateString();
    const loggedToday = logs.some(l => l.date === today);
    const streak = getHabitStreak(chatId, habit);
    result[habit] = { streak, loggedToday, totalLogs: logs.length };
  }
  return result;
}

// ─── Mood Tracking ────────────────────────────────────────────────────────────

function logMood(chatId, mood, notes = '') {
  const data = readJson(MOOD_FILE, []);
  const entry = {
    chatId: String(chatId),
    date: todayDateString(),
    mood: String(mood).trim(),
    notes: String(notes).trim(),
    loggedAt: new Date().toISOString()
  };
  data.push(entry);
  writeJson(MOOD_FILE, data);
  return entry;
}

function getMoodHistory(chatId, days = 7) {
  const data = readJson(MOOD_FILE, []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return data
    .filter(m => m.chatId === String(chatId) && new Date(m.date) >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function refreshIdentity() {
  readIdentity();
}

function setBotName(name) {
  BOT_NAME = String(name || '').trim() || 'Peen';
  writeIdentity();
}

function setUserName(name) {
  USER_NAME = String(name || '').trim() || 'User';
  writeIdentity();
}

function getDigestStore() {
  return readJson(DIGEST_FILE, {});
}

function saveDigestStore(data) {
  writeJson(DIGEST_FILE, data);
}

function tomorrowDateString(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayDateString(from = new Date()) {
  return new Date(from).toISOString().slice(0, 10);
}

function setDailyDigestPlan(chatId, payload, forDate = tomorrowDateString()) {
  const store = getDigestStore();
  const key = String(chatId);
  store[key] = store[key] || {};
  store[key][forDate] = {
    ...payload,
    forDate,
    updatedAt: new Date().toISOString()
  };
  saveDigestStore(store);
  touchChat(chatId);
  return store[key][forDate];
}

function getDailyDigestPlan(chatId, forDate = todayDateString()) {
  const store = getDigestStore();
  return store[String(chatId)]?.[forDate] || null;
}

function getSchedulerState() {
  return readJson(SCHEDULER_FILE, {});
}

function setSchedulerMarker(kind, chatId, dateKey, value = true) {
  const state = getSchedulerState();
  state[kind] = state[kind] || {};
  state[kind][String(chatId)] = state[kind][String(chatId)] || {};
  state[kind][String(chatId)][dateKey] = value;
  writeJson(SCHEDULER_FILE, state);
}

function getSchedulerMarker(kind, chatId, dateKey) {
  const state = getSchedulerState();
  return Boolean(state?.[kind]?.[String(chatId)]?.[dateKey]);
}

function saveReflection(chatId, reflection) {
  const data = readJson(REFLECTIONS_FILE, []);
  data.push({
    chatId: String(chatId),
    createdAt: new Date().toISOString(),
    ...reflection
  });
  writeJson(REFLECTIONS_FILE, data);
  return data[data.length - 1];
}

function getRecentReflections(chatId, limit = 5) {
  const data = readJson(REFLECTIONS_FILE, []);
  return data
    .filter(item => String(item.chatId) === String(chatId))
    .slice(-limit);
}

function setLastLocation(chatId, payload) {
  const data = readJson(LOCATIONS_FILE, {});
  data[String(chatId)] = {
    ...payload,
    updatedAt: new Date().toISOString()
  };
  writeJson(LOCATIONS_FILE, data);
}

function getLastLocation(chatId) {
  const data = readJson(LOCATIONS_FILE, {});
  return data[String(chatId)] || null;
}

// ─── Allowlist helpers ────────────────────────────────────────────────────────

function getAllowedNumbers() {
  const cfg = botConfig.get();
  return cfg.allowedNumbers || [];
}

function isNumberAllowed(number) {
  const cfg = botConfig.get();
  const allowed = cfg.allowedNumbers || [];
  if (!allowed.length) return true;
  return allowed.includes(String(number));
}

function addAllowedNumber(number) {
  const cfg = botConfig.get();
  const allowed = cfg.allowedNumbers || [];
  const num = String(number);
  if (!allowed.includes(num)) {
    cfg.allowedNumbers = [...allowed, num];
    botConfig.save(cfg);
  }
}

function removeAllowedNumber(number) {
  const cfg = botConfig.get();
  const num = String(number);
  cfg.allowedNumbers = (cfg.allowedNumbers || []).filter(n => n !== num);
  botConfig.save(cfg);
}

function clearAllowedNumbers() {
  const cfg = botConfig.get();
  cfg.allowedNumbers = [];
  botConfig.save(cfg);
}

const api = {
  loadAll,
  refreshIdentity,
  setBotName,
  setUserName,
  getSystemPrompt,
  getUserName: () => USER_NAME,
  getBotName: () => BOT_NAME,
  getPersonality,
  setPersonality,
  getPersonalityPrompt,
  touchChat,
  getKnownChatIds,
  setDailyDigestPlan,
  getDailyDigestPlan,
  todayDateString,
  tomorrowDateString,
  setSchedulerMarker,
  getSchedulerMarker,
  saveReflection,
  getRecentReflections,
  setLastLocation,
  getLastLocation,
  logHabit,
  getHabitStreak,
  getHabitStats,
  logMood,
  getMoodHistory,
  getFontStyle,
  setFontStyle,
  getHackerMode,
  setHackerMode,
  getUserNameForChat,
  recordHabit: (chatId, habit) => logHabit(chatId, habit),
  getAllowedNumbers,
  isNumberAllowed,
  addAllowedNumber,
  removeAllowedNumber,
  clearAllowedNumbers,
};

Object.defineProperty(api, 'BOT_NAME', {
  get() {
    return BOT_NAME;
  },
  set(value) {
    BOT_NAME = String(value || '').trim() || 'Peen';
  }
});

module.exports = api;
