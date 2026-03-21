
const { execSync } = require('child_process');

function log(...args) {
  console.log('[DESKTOP]', ...args);
}

async function clickText() {
  throw new Error('clickText is not used for browser-runner tasks in this build.');
}

async function typeText(text) {
  log('type', text);
  execSync(`xdotool type --delay 10 ${JSON.stringify(String(text))}`);
}

async function pressKey(k) {
  log('key', k);
  execSync(`xdotool key ${k}`);
}

async function openBrowser() {
  log('open firefox');
  execSync('firefox >/dev/null 2>&1 &');
}

module.exports = {
  clickText,
  typeText,
  pressKey,
  openBrowser
};
