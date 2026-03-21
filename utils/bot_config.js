const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'bot_config.json');

const DEFAULTS = {
  setup_complete: false,
  botName:        'Bert',
  userName:       'User',
  personality:    'casual',
  model:          'qwen2.5:7b-instruct',
  braveApiKey:    '',
  openAiApiKey:   '',
  timezone:       'Europe/London',
  systemPromptExtra: '',
  features: {
    voice:           true,
    search:          true,
    stockAlerts:     true,
    morningDigest:   true,
    newsDrops:       true,
    checkins:        true,
    eveningPrompt:   true,
    nightReflection: true,
    statusUpdates:   true,
    emojiReactions:  true,
    followUpThoughts:true,
  },
  schedule: {
    morningDigest:   '08:00',
    newsDrop:        '10:00',
    middayCheckin:   '12:00',
    eveningCheckin:  '18:00',
    eveningPrompt:   '20:00',
    nightReflection: '23:30',
  },
  behavior: {
    emojiReactionChance:  0.20,
    followUpChance:       0.12,
    maxHistoryMessages:   50,
  },
  allowedNumbers: [],
  admins: [],
  tools: {
    webSearch:          true,
    torrents:           true,
    youtube:            true,
    voice:              true,
    terminal:           false,
    browser:            false,
    vision:             false,
    stockAlerts:        true,
    gptRelay:           true,
    grokRelay:          true,
  },
  workspace: {
    path:               '',
    allowRead:          true,
    allowWrite:         true,
    allowCommandExecution: false,
  },
  systemPrompt: {
    role:         '',
    traits:       '',
    context:      '',
    rules:        '',
    extra:        '',
  },
};

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return deepMerge(DEFAULTS, saved);
    }
  } catch {}
  return { ...DEFAULTS };
}

function save(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

function isSetupComplete() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return false;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return cfg.setup_complete === true;
  } catch { return false; }
}

// Singleton — loaded once at startup
let _loaded = null;
function get() {
  if (!_loaded) _loaded = load();
  return _loaded;
}

module.exports = { get, load, save, isSetupComplete, DEFAULTS };
