'use strict';

const https    = require('https');
const { execSync } = require('child_process');
const path     = require('path');

const REPO_RAW = 'https://raw.githubusercontent.com/AgentLocal-hub/AgentLocal/main/package.json';
const ROOT     = path.resolve(__dirname, '..');

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    https.get(REPO_RAW, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).version || null); }
        catch { reject(new Error('Bad JSON')); }
      });
    }).on('error', reject);
  });
}

function semverGt(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function runUpdate() {
  console.log('\nPulling latest code...');
  execSync('git pull origin main', { cwd: ROOT, stdio: 'inherit' });
  console.log('\nInstalling any new dependencies...');
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  console.log('\nUpdate complete. Please restart.\n');
  process.exit(0);
}

/**
 * Check GitHub for a newer version.
 * If found, prompt the user (via readline rl if provided, else raw stdin).
 * @param {import('readline').Interface|null} rl  - existing readline interface or null
 */
async function checkForUpdate(rl = null) {
  let local, latest;
  try {
    local  = require('../package.json').version;
    latest = await fetchLatestVersion();
  } catch {
    return; // silently skip if offline or repo unreachable
  }

  if (!latest || !semverGt(latest, local)) return;

  console.log(`\n  Update available: v${local} → v${latest}`);
  const answer = await new Promise(resolve => {
    if (rl) {
      rl.question('  Update now? [Y/n] ', resolve);
    } else {
      // raw stdin prompt (used in index.js)
      process.stdout.write('  Update now? [Y/n] ');
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', d => {
        process.stdin.pause();
        resolve(d.trim());
      });
    }
  });

  if (/^y$/i.test(answer) || answer === '') {
    runUpdate();
  } else {
    console.log('  Skipping update.\n');
  }
}

module.exports = { checkForUpdate };
