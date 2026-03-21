const { execSync } = require('child_process');
const { getOCR } = require('./ocr_cache');

function plog(message) {
  console.log(`[PERCEPTION] ${message}`);
}

function getActiveWindow() {
  try {
    return execSync('xdotool getactivewindow getwindowname', { encoding: 'utf8' }).trim();
  } catch (_) {
    return 'unknown';
  }
}

function buildScreenState(forceFresh = false) {
  const ocr = getOCR(forceFresh);
  const activeWindow = getActiveWindow();

  const state = {
    timestamp: Date.now(),
    activeWindow,
    screenshot: ocr.screenshot,
    textBoxes: ocr.boxes
  };

  plog(`window="${activeWindow}" boxes=${state.textBoxes.length}`);
  return state;
}

module.exports = {
  buildScreenState,
  getActiveWindow
};
