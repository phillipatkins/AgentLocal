const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const { screenshotCmd, tmpFile } = require('../utils/platform');

const run = promisify(exec);

async function captureScreen() {

  const file = tmpFile('screen', '.png');

  await run(screenshotCmd(file), { shell: true });

  return file;
}

async function readScreenText(file) {

  const { stdout } = await run(`tesseract ${file} stdout`);

  return stdout;
}

async function screenOCR() {

  const screenshot = await captureScreen();

  const text = await readScreenText(screenshot);

  return {
    screenshot,
    text
  };

}

module.exports = { screenOCR };