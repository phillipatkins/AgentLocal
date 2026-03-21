const { exec } = require('child_process');
const { promisify } = require('util');
const { screenshotCmd, tmpFile } = require('../utils/platform');

const run = promisify(exec);

async function findText(text) {

  const screenshot = tmpFile('screen', '.png');

  await run(screenshotCmd(screenshot), { shell: true });

  const cmd = `tesseract ${screenshot} stdout tsv`;

  const { stdout } = await run(cmd);

  const lines = stdout.split('\n');

  const results = [];

  for (const line of lines.slice(1)) {

    const parts = line.split('\t');

    if (parts.length < 12) continue;

    const word = parts[11];

    if (!word) continue;

    if (word.toLowerCase().includes(text.toLowerCase())) {

      const x = parseInt(parts[6]);
      const y = parseInt(parts[7]);
      const w = parseInt(parts[8]);
      const h = parseInt(parts[9]);

      results.push({
        text: word,
        x: x + w/2,
        y: y + h/2
      });

    }

  }

  return results;

}

module.exports = { findText };