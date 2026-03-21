const { execSync } = require('child_process');
const fs = require('fs');
const { screenshotCmd, tmpFile } = require('../utils/platform');

let cachedResult = null;
let cachedAt = 0;
const CACHE_MS = 1000;

function olog(message) {
  console.log(`[OCR] ${message}`);
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function captureScreen(outputPath) {
  execSync(screenshotCmd(outputPath), { shell: true });
  return outputPath;
}

function parseTsv(tsv) {
  const lines = String(tsv || '').split('\n').slice(1);
  const boxes = [];

  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 12) continue;

    const text = String(cols[11] || '').trim();
    if (!text) continue;

    boxes.push({
      text,
      confidence: Number(cols[10]) || 0,
      bbox: {
        x: Number(cols[6]) || 0,
        y: Number(cols[7]) || 0,
        w: Number(cols[8]) || 0,
        h: Number(cols[9]) || 0
      }
    });
  }

  return boxes;
}

function getOCR(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedResult && (now - cachedAt) < CACHE_MS) {
    return cachedResult;
  }

  const screenshot = tmpFile('desktop_agent', '.png');
  captureScreen(screenshot);

  const tsv = execSync(`tesseract ${screenshot} stdout --psm 6 tsv`, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  const boxes = parseTsv(tsv);
  cachedResult = {
    screenshot,
    boxes,
    capturedAt: now
  };
  cachedAt = now;

  olog(`captured ${boxes.length} text boxes`);

  try {
    if (fs.existsSync(screenshot)) {
      fs.unlinkSync(screenshot);
    }
  } catch (_) {}

  return cachedResult;
}

function invalidateOCRCache() {
  cachedResult = null;
  cachedAt = 0;
}

module.exports = {
  getOCR,
  invalidateOCRCache
};
