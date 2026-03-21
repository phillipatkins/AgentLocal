// whatsapp/core/dependencyCheck.js
const { exec } = require('child_process');

const REQUIRED_BINARIES = ["ffmpeg", "yt-dlp", "aria2c", "scrot", "espeak-ng", "node", "playwright"];

function checkBinary(binName) {
  return new Promise((resolve) => {
    exec(`which ${binName}`, (err, stdout) => {
      resolve({ binName, found: Boolean(stdout && stdout.trim()) });
    });
  });
}

async function doctor() {
  const results = await Promise.all(REQUIRED_BINARIES.map(checkBinary));
  const missing = results.filter(r => !r.found).map(r => r.binName);
  return {
    ok: missing.length === 0,
    missing,
    results
  };
}

module.exports = { doctor };
