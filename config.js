const path = require('path');
const fs   = require('fs');
const { chromeBrowserProfilePath } = require('./utils/platform');

// Load bot_config.json if it exists (written by setup.js)
const BOT_CONFIG_FILE = path.join(process.cwd(), 'data', 'bot_config.json');
const botCfg = (() => {
  try {
    if (fs.existsSync(BOT_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return {};
})();

const HOME        = process.env.HOME || require('os').homedir();
const CHROME_ROOT = process.env.CHROME_USER_DATA_DIR || chromeBrowserProfilePath();
const PROFILE_DIR = process.env.CHROME_PROFILE_DIRECTORY || 'Default';

const BRAVE_API_KEY  = botCfg.braveApiKey  || process.env.BRAVE_API_KEY  || '';
const DEFAULT_MODEL  = botCfg.model        || process.env.DEFAULT_MODEL  || 'qwen2.5:7b-instruct';
const OPENAI_API_KEY = botCfg.openAiApiKey || process.env.OPENAI_API_KEY || '';

module.exports = {
  BRAVE_API_KEY,
  DEFAULT_MODEL,
  OPENAI_API_KEY,

  USER_DATA_DIR:            CHROME_ROOT,
  CHROME_EXECUTABLE_PATH:   process.env.CHROME_EXECUTABLE_PATH || '',
  CHROME_PROFILE_DIRECTORY: PROFILE_DIR,

  BROWSER_CHANNEL:            process.env.BROWSER_CHANNEL || 'chrome',
  BROWSER_HEADLESS:           /^(1|true|yes)$/i.test(process.env.BROWSER_HEADLESS || 'false'),
  BROWSER_LOCALE:             botCfg.locale    || process.env.BROWSER_LOCALE    || 'en-GB',
  BROWSER_TIMEZONE:           botCfg.timezone  || process.env.BROWSER_TIMEZONE  || 'Europe/London',
  BROWSER_SLOW_MO:            Number(process.env.BROWSER_SLOW_MO || 0),
  BROWSER_DEFAULT_TIMEOUT:    Number(process.env.BROWSER_DEFAULT_TIMEOUT    || 15000),
  BROWSER_NAVIGATION_TIMEOUT: Number(process.env.BROWSER_NAVIGATION_TIMEOUT || 45000),
  BROWSER_FINGERPRINT_SEED:   `${CHROME_ROOT}:${PROFILE_DIR}`,
  BROWSER_DOWNLOADS_DIR:      process.env.BROWSER_DOWNLOADS_DIR || path.join(HOME, 'Downloads', 'playwright'),
  BROWSER_EXTRA_ARGS:         (process.env.BROWSER_EXTRA_ARGS || '')
    .split(/\s+(?=--)/).map(x => x.trim()).filter(Boolean),
};
