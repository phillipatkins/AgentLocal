#!/usr/bin/env node
'use strict';

/**
 * First-run setup wizard for the WhatsApp AI Bot.
 * Run with:  node setup.js
 * Re-run at any time to reconfigure.
 */

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { execSync, exec } = require('child_process');

const botConfigUtil = require('./utils/bot_config');
const chalk = require('chalk');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const W = Math.min(process.stdout.columns || 80, 80);
const bar  = () => chalk.hex('#00d4ff')('═'.repeat(W));
const dim  = chalk.gray;
const hi   = chalk.hex('#00d4ff').bold;
const good = chalk.greenBright;
const warn = chalk.hex('#ffb000');
const bad  = chalk.redBright;
const bold = chalk.white.bold;

function banner() {
  console.clear();
  console.log('');
  console.log(bar());
  console.log('');
  console.log(hi('  WhatsApp AI Bot  ·  Setup Wizard'));
  console.log(dim('  Configure your bot before first launch.'));
  console.log('');
  console.log(bar());
  console.log('');
}

function sectionHeader(title) {
  console.log('');
  const text = ` ◆ ${title} `;
  const pad  = Math.max(0, W - text.length - 2);
  console.log(chalk.hex('#00d4ff')(`  ◆ ${chalk.bold(title)} `) + dim('─'.repeat(pad)));
  console.log('');
}

function hint(text) {
  console.log(dim(`  ℹ  ${text}`));
}

function ok(text) {
  console.log(good(`  ✔  ${text}`));
}

function fail(text) {
  console.log(bad(`  ✘  ${text}`));
}

// ─── Prompt helpers ───────────────────────────────────────────────────────────
let rl;

function createRl() {
  rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

function ask(question, defaultVal = '') {
  const def = defaultVal ? dim(` [${defaultVal}]`) : '';
  return new Promise(resolve => {
    rl.question(`  ${bold('?')} ${question}${def}: `, answer => {
      const val = answer.trim();
      resolve(val || defaultVal);
    });
  });
}

function askYN(question, defaultVal = true) {
  const hint = defaultVal ? dim(' [Y/n]') : dim(' [y/N]');
  return new Promise(resolve => {
    rl.question(`  ${bold('?')} ${question}${hint}: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultVal);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

function askChoice(question, choices, defaultVal) {
  const choiceStr = choices.map((c, i) => `${dim(`${i + 1}.`)} ${c === defaultVal ? bold(c) : c}`).join('  ');
  return new Promise(resolve => {
    rl.question(`  ${bold('?')} ${question}\n     ${choiceStr}\n  ${bold('>')} `, answer => {
      const a = answer.trim();
      const n = parseInt(a);
      if (n >= 1 && n <= choices.length) return resolve(choices[n - 1]);
      if (choices.includes(a)) return resolve(a);
      resolve(defaultVal);
    });
  });
}

// ─── Ollama helpers ───────────────────────────────────────────────────────────
function getOllamaModels() {
  try {
    const out = execSync('ollama list 2>/dev/null', { timeout: 5000 }).toString();
    const lines = out.trim().split('\n').slice(1); // skip header
    return lines.map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

function ollamaRunning() {
  try {
    execSync('curl -s http://localhost:11434/api/tags 2>/dev/null', { timeout: 3000 });
    return true;
  } catch { return false; }
}

// ─── Check system tools ───────────────────────────────────────────────────────
function checkTool(cmd) {
  try { execSync(`which ${cmd} 2>/dev/null`); return true; } catch { return false; }
}

// ─── Requirements installer ───────────────────────────────────────────────────

function cmdExists(cmd) {
  const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
  try { execSync(`${check} 2>/dev/null`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function pyModuleExists(mod) {
  const py = cmdExists('python3') ? 'python3' : cmdExists('python') ? 'python' : null;
  if (!py) return false;
  try { execSync(`${py} -c "import ${mod}"`, { stdio: 'ignore', shell: true, timeout: 5000 }); return true; } catch { return false; }
}

function ollamaModels() {
  try {
    const out = execSync('ollama list 2>/dev/null', { timeout: 5000 }).toString();
    return out.trim().split('\n').slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}

function sysInstall(tool) {
  const mgr = (() => {
    if (cmdExists('apt-get')) return 'apt';
    if (cmdExists('dnf'))     return 'dnf';
    if (cmdExists('yum'))     return 'yum';
    if (cmdExists('pacman'))  return 'pacman';
    if (cmdExists('brew'))    return 'brew';
    return null;
  })();
  if (!mgr) throw new Error(`No supported package manager found. Please install ${tool} manually.`);
  const pkgNames = {
    ffmpeg:     { apt: 'ffmpeg',    dnf: 'ffmpeg',    yum: 'ffmpeg',    pacman: 'ffmpeg',    brew: 'ffmpeg'    },
    'espeak-ng':{ apt: 'espeak-ng', dnf: 'espeak-ng', yum: 'espeak-ng', pacman: 'espeak-ng', brew: 'espeak'    },
    aria2:      { apt: 'aria2',     dnf: 'aria2',     yum: 'aria2',     pacman: 'aria2',     brew: 'aria2'     },
    scrot:      { apt: 'scrot',     dnf: 'scrot',     yum: 'scrot',     pacman: 'scrot',     brew: null        },
    git:        { apt: 'git',       dnf: 'git',       yum: 'git',       pacman: 'git',       brew: 'git'       },
  };
  const pkg = pkgNames[tool]?.[mgr] || tool;
  if (!pkg) throw new Error(`${tool} is not available via ${mgr} on this platform.`);
  const cmd = mgr === 'brew' ? `brew install ${pkg}` : `sudo ${mgr === 'apt' ? 'apt-get' : mgr} install -y ${pkg}`;
  execSync(cmd, { stdio: 'inherit', shell: true });
}

async function runInstaller(defaultModel) {
  sectionHeader('Requirements');
  console.log('');

  const steps = [
    {
      name: 'Node packages (npm install)',
      check: () => fs.existsSync(path.join(process.cwd(), 'node_modules', 'whatsapp-web.js')),
      install: () => { execSync('npm install', { stdio: 'inherit', cwd: process.cwd() }); },
    },
    {
      name: 'Ollama',
      check: () => cmdExists('ollama'),
      install: () => {
        const ollamaCmd = process.platform === 'darwin'
          ? 'brew install ollama 2>/dev/null || curl -fsSL https://ollama.com/install.sh | sh'
          : process.platform === 'win32'
          ? null  // Windows: manual
          : 'curl -fsSL https://ollama.com/install.sh | sh';
        if (!ollamaCmd) throw new Error('On Windows, download Ollama from https://ollama.ai/download — install manually then re-run setup.');
        execSync(ollamaCmd, { stdio: 'inherit', shell: true });
      },
    },
    {
      name: 'ffmpeg (audio conversion)',
      check: () => cmdExists('ffmpeg'),
      install: () => { sysInstall('ffmpeg'); },
    },
    {
      name: 'espeak-ng (text-to-speech)',
      check: () => cmdExists('espeak-ng'),
      install: () => { sysInstall('espeak-ng'); },
    },
    {
      name: 'aria2c (torrent downloads)',
      check: () => cmdExists('aria2c'),
      install: () => { sysInstall('aria2'); },
    },
    {
      name: 'scrot (desktop screenshots)',
      check: () => cmdExists('scrot'),
      install: () => { sysInstall('scrot'); },
    },
    {
      name: 'yt-dlp (YouTube downloads)',
      check: () => cmdExists('yt-dlp'),
      install: () => {
        const pipBin = cmdExists('pip3') ? 'pip3' : cmdExists('pip') ? 'pip' : null;
        if (!pipBin) throw new Error('pip not found — install Python first');
        execSync(`${pipBin} install yt-dlp`, { stdio: 'inherit', shell: true });
      },
    },
    {
      name: 'faster-whisper (speech-to-text)',
      check: () => pyModuleExists('faster_whisper'),
      install: () => {
        const pipBin2 = cmdExists('pip3') ? 'pip3' : cmdExists('pip') ? 'pip' : null;
        if (!pipBin2) throw new Error('pip not found — install Python first');
        execSync(`${pipBin2} install faster-whisper`, { stdio: 'inherit', shell: true });
      },
    },
    {
      name: 'Playwright Chromium (browser automation + GPT/Grok relay)',
      check: () => false,   // always run — it no-ops if already installed
      install: () => { execSync('npx playwright install chromium', { stdio: 'inherit', shell: true }); },
      optional: true,
    },
  ];

  let allOk = true;
  for (const step of steps) {
    process.stdout.write(`  ${dim('Checking')} ${chalk.white(step.name)}… `);
    if (step.check()) {
      console.log(good('✔ already installed'));
      continue;
    }
    console.log(warn('not found — installing…'));
    try {
      step.install();
      console.log(good(`  ✔  ${step.name} installed successfully`));
    } catch (err) {
      if (step.optional) {
        console.log(warn(`  ⚠  ${step.name} — optional, skipping (${err.message || err})`));
      } else {
        console.log(bad(`  ✘  ${step.name} failed: ${err.message || err}`));
        allOk = false;
      }
    }
  }

  // ── Ollama model ──────────────────────────────────────────────────────────────
  if (cmdExists('ollama')) {
    const models = ollamaModels();
    const model = defaultModel || 'qwen2.5:7b-instruct';
    if (!models.includes(model)) {
      console.log('');
      ok(`Pulling Ollama model: ${model}`);
      hint('This may take several minutes on first download.');
      console.log('');
      try {
        execSync(`ollama pull ${model}`, { stdio: 'inherit', shell: true });
        console.log('');
        ok(`Model ${model} ready`);
      } catch (err) {
        console.log(bad(`  ✘  Failed to pull ${model}: ${err.message || err}`));
      }
    } else {
      console.log(`  ${dim('Checking')} ${chalk.white(`Ollama model: ${model}`)}… ${good('✔ already downloaded')}`);
    }
  }

  console.log('');
  if (allOk) {
    ok('All requirements satisfied.');
  } else {
    console.log(warn('  ⚠  Some requirements failed. You may need to install them manually.'));
  }
  console.log('');
}

// ─── Main setup flow ──────────────────────────────────────────────────────────
async function run() {
  banner();

  const existing = botConfigUtil.load();
  const isReconfigure = existing.setup_complete;

  if (isReconfigure) {
    console.log(warn('  ⚠  A configuration already exists. Running setup will overwrite it.'));
    console.log('');
    const cont = await (async () => {
      createRl();
      return askYN('Continue and reconfigure?', false);
    })();
    if (!cont) {
      rl.close();
      console.log(dim('  Setup cancelled. Existing config unchanged.'));
      process.exit(0);
    }
  } else {
    createRl();
  }

  const cfg = { ...botConfigUtil.DEFAULTS };

  // ── 0. Requirements ──────────────────────────────────────────────────────────
  sectionHeader('Requirements Check');
  hint('Check and install all required tools and system dependencies.');
  hint('Skipping will not affect configuration — you can re-run anytime.');
  console.log('');
  const doInstall = await askYN('Install / verify all requirements now?', !isReconfigure);
  if (doInstall) {
    rl.close();
    await runInstaller(existing.model || cfg.model);
    createRl();
  }

  // ── 1. Identity ─────────────────────────────────────────────────────────────
  sectionHeader('Identity');
  hint('These names are used in conversations and the system prompt.');
  console.log('');

  cfg.botName  = await ask('Bot name', existing.botName  || 'Bert');
  cfg.userName = await ask('Your name', existing.userName || 'User');

  // ── 2. Personality ──────────────────────────────────────────────────────────
  sectionHeader('Personality');
  hint('Controls the tone and style of bot responses.');
  console.log('');

  const personality = await askChoice(
    'Choose a default personality',
    ['casual', 'professional', 'sarcastic'],
    existing.personality || 'casual'
  );
  cfg.personality = personality;

  // ── 3. System prompt ────────────────────────────────────────────────────────
  sectionHeader('System Prompt');
  hint('The base system prompt defines how the bot behaves.');
  hint('You can add extra instructions on top of the default.');
  console.log('');

  const addExtra = await askYN('Add custom instructions to the system prompt?', false);
  if (addExtra) {
    console.log(dim('  Type your extra instructions (press Enter twice to finish):'));
    cfg.systemPromptExtra = await new Promise(resolve => {
      let result = '';
      let lastBlank = false;
      const onLine = line => {
        if (line === '' && lastBlank) {
          rl.removeListener('line', onLine);
          return resolve(result.trim());
        }
        lastBlank = line === '';
        result += (result ? '\n' : '') + line;
      };
      rl.on('line', onLine);
    });
  } else {
    cfg.systemPromptExtra = existing.systemPromptExtra || '';
  }

  // ── 4. Ollama model ─────────────────────────────────────────────────────────
  sectionHeader('AI Model (Ollama)');

  const running = ollamaRunning();
  if (running) {
    ok('Ollama is running');
    const models = getOllamaModels();
    if (models.length) {
      console.log('');
      console.log(dim('  Available models:'));
      models.forEach((m, i) => console.log(`    ${dim(`${i + 1}.`)} ${m}`));
      console.log('');
      const defaultModel = existing.model && models.includes(existing.model)
        ? existing.model
        : models[0];
      const raw = await ask(`Model to use (name or number 1–${models.length})`, defaultModel);
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num >= 1 && num <= models.length) {
        cfg.model = models[num - 1];
        ok(`Selected: ${cfg.model}`);
      } else if (models.includes(raw)) {
        cfg.model = raw;
      } else {
        cfg.model = raw || defaultModel;
      }
    } else {
      hint('No models found. Pull one first: ollama pull qwen2.5:7b-instruct');
      cfg.model = await ask('Model name', existing.model || 'qwen2.5:7b-instruct');
    }
  } else {
    fail('Ollama is not running (start it with: ollama serve)');
    cfg.model = await ask('Model name anyway', existing.model || 'qwen2.5:7b-instruct');
  }

  // ── 5. API Keys ─────────────────────────────────────────────────────────────
  sectionHeader('API Keys');
  hint('Leave blank to skip a feature. Keys are stored locally only.');
  console.log('');

  const existingBrave = existing.braveApiKey || '';
  const braveMask = existingBrave ? dim(`(current: ${existingBrave.slice(0, 6)}...)`) : '';
  hint(`Brave Search API — used for web search and news drops ${braveMask}`);
  cfg.braveApiKey = await ask('Brave Search API key', existingBrave);

  console.log('');

  const existingOAI = existing.openAiApiKey || '';
  const oaiMask = existingOAI ? dim(`(current: ${existingOAI.slice(0, 6)}...)`) : '';
  hint(`OpenAI API key — used for GPT-4o vision (OSRS agent) ${oaiMask}`);
  cfg.openAiApiKey = await ask('OpenAI API key', existingOAI);

  // ── 6. Features ─────────────────────────────────────────────────────────────
  sectionHeader('Features');
  hint('Enable or disable each feature. Press Enter to accept the default.');
  console.log('');

  const ef = existing.features || {};
  cfg.features = {
    voice:            await askYN('Enable voice messages (TTS + speech-to-text)?', ef.voice            ?? (checkTool('piper') || checkTool('espeak-ng'))),
    search:           await askYN('Enable web search (Brave API)?',                ef.search           ?? !!cfg.braveApiKey),
    stockAlerts:      await askYN('Enable stock/crypto price alerts?',             ef.stockAlerts      ?? true),
    morningDigest:    await askYN('Enable morning digest?',                        ef.morningDigest    ?? true),
    newsDrops:        await askYN('Enable daily news drops?',                      ef.newsDrops        ?? !!cfg.braveApiKey),
    checkins:         await askYN('Enable midday/evening check-ins?',              ef.checkins         ?? true),
    eveningPrompt:    await askYN('Enable evening digest prompt?',                 ef.eveningPrompt    ?? true),
    nightReflection:  await askYN('Enable night reflection?',                      ef.nightReflection  ?? true),
    statusUpdates:    await askYN('Enable hourly AI status updates?',              ef.statusUpdates    ?? true),
    emojiReactions:   await askYN('Enable emoji reactions to messages?',           ef.emojiReactions   ?? true),
    followUpThoughts: await askYN('Enable occasional follow-up thoughts?',         ef.followUpThoughts ?? true),
  };

  // ── 7. Allowed Numbers ───────────────────────────────────────────────────────
  sectionHeader('Allowed Numbers (Whitelist)');
  hint('Only these WhatsApp numbers can message the bot.');
  hint('Format: country code + number, e.g. 447911123456');
  hint('Leave blank to allow everyone (useful for private bots).');
  hint('Separate multiple numbers with commas.');
  console.log('');

  const existingAllowed = (existing.allowedNumbers || []).join(', ');
  const allowedRaw = await ask('Allowed numbers (comma-separated, blank = allow all)', existingAllowed);
  if (allowedRaw.trim()) {
    cfg.allowedNumbers = allowedRaw.split(',')
      .map(n => n.trim())
      .filter(Boolean)
      .map(n => {
        if (n.includes('@c.us')) return n;
        return n.replace(/\D/g, '') + '@c.us';
      });
  } else {
    cfg.allowedNumbers = [];
  }

  // ── 8. Tools ──────────────────────────────────────────────────────────────────
  sectionHeader('Tools');
  hint('Enable or disable individual tools/capabilities.');
  console.log('');

  const et = (existing.tools || {});
  cfg.tools = {
    webSearch:  await askYN('Enable web search tool?',                      et.webSearch  ?? true),
    torrents:   await askYN('Enable torrent/magnet search (aria2c)?',       et.torrents   ?? true),
    youtube:    await askYN('Enable YouTube download?',                     et.youtube    ?? true),
    voice:      await askYN('Enable voice messages (TTS/STT)?',             et.voice      ?? true),
    terminal:   await askYN('Enable terminal session tool? ' + warn('⚠ Gives bot shell access'), et.terminal   ?? false),
    browser:    await askYN('Enable browser automation (Playwright)?',      et.browser    ?? false),
    vision:     await askYN('Enable screen vision/describe?',               et.vision     ?? false),
    stockAlerts:await askYN('Enable stock/crypto alerts tool?',             et.stockAlerts ?? true),
    gptRelay:   await askYN('Enable GPT relay (mirrors chats to ChatGPT via browser)?', et.gptRelay ?? true),
    grokRelay:  await askYN('Enable Grok relay (mirrors chats to Grok via browser)?',   et.grokRelay ?? true),
  };
  if (cfg.tools.gptRelay || cfg.tools.grokRelay) {
    hint('GPT/Grok relay requires Chromium open with remote debugging on port 9222.');
    hint('Launch with: chromium --remote-debugging-port=9222');
    hint('Then log into chatgpt.com / grok.com in that browser.');
  }

  // ── 9. Workspace ──────────────────────────────────────────────────────────────
  sectionHeader('Workspace');
  hint('The workspace is the root directory for file operations.');
  console.log('');

  const ew = existing.workspace || {};
  cfg.workspace = {};
  cfg.workspace.path = await ask('Workspace path (blank = ./workspace)', ew.path || '');
  cfg.workspace.allowRead    = await askYN('Allow the bot to read files from workspace?',  ew.allowRead    ?? true);
  cfg.workspace.allowWrite   = await askYN('Allow the bot to write files to workspace?',   ew.allowWrite   ?? true);
  cfg.workspace.allowCommandExecution = await askYN('Allow the bot to execute shell commands?', ew.allowCommandExecution ?? false);
  if (cfg.workspace.allowCommandExecution) {
    console.log(warn('  ⚠  Shell execution enabled — only do this on a trusted private device.'));
  }

  // ── 10. System Prompt Builder ─────────────────────────────────────────────────
  sectionHeader('System Prompt Builder');
  hint("Answer these questions to build the bot's personality and context.");
  hint('Press Enter to skip any question.');
  console.log('');

  const esp = existing.systemPrompt || {};
  const spAnswers = {};
  spAnswers.role    = await ask("What is the bot's role? (e.g. personal assistant, coach, companion)", esp.role    || '');
  spAnswers.traits  = await ask("Describe the bot's personality traits (e.g. witty, concise, warm)",   esp.traits  || '');
  spAnswers.context = await ask("Describe yourself / context the bot should know (e.g. I'm a developer in London)", esp.context || '');
  spAnswers.rules   = await ask('Any rules the bot must follow? (e.g. always reply in English)',        esp.rules   || '');
  spAnswers.extra   = await ask('Any extra instructions?',                                              esp.extra   || '');

  function buildSystemPromptFromAnswers(answers) {
    const parts = [];
    if (answers.role)    parts.push(`You are a ${answers.role}.`);
    if (answers.traits)  parts.push(`Your personality: ${answers.traits}.`);
    if (answers.context) parts.push(`Context: ${answers.context}.`);
    if (answers.rules)   parts.push(`Rules: ${answers.rules}.`);
    if (answers.extra)   parts.push(answers.extra);
    return parts.join(' ').trim();
  }

  cfg.systemPrompt = { ...spAnswers };
  const builtPrompt = buildSystemPromptFromAnswers(spAnswers);

  if (builtPrompt) {
    console.log('');
    console.log(dim('  System prompt preview:'));
    console.log(`  ${chalk.white(builtPrompt)}`);
    console.log('');
    cfg.systemPromptExtra = builtPrompt;
  } else {
    cfg.systemPromptExtra = existing.systemPromptExtra || '';
  }

  // ── 11. Schedule ──────────────────────────────────────────────────────────────
  if (cfg.features.morningDigest || cfg.features.checkins || cfg.features.eveningPrompt) {
    sectionHeader('Schedule');
    hint('Set times for daily events (24-hour format HH:MM).');
    console.log('');

    const es = existing.schedule || {};
    cfg.schedule = {
      morningDigest:   cfg.features.morningDigest  ? await ask('Morning digest time',    es.morningDigest   || '08:00') : (es.morningDigest   || '08:00'),
      newsDrop:        cfg.features.newsDrops       ? await ask('News drop time',         es.newsDrop        || '10:00') : (es.newsDrop        || '10:00'),
      middayCheckin:   cfg.features.checkins        ? await ask('Midday check-in time',   es.middayCheckin   || '12:00') : (es.middayCheckin   || '12:00'),
      eveningCheckin:  cfg.features.checkins        ? await ask('Evening check-in time',  es.eveningCheckin  || '18:00') : (es.eveningCheckin  || '18:00'),
      eveningPrompt:   cfg.features.eveningPrompt   ? await ask('Evening prompt time',    es.eveningPrompt   || '20:00') : (es.eveningPrompt   || '20:00'),
      nightReflection: cfg.features.nightReflection ? await ask('Night reflection time',  es.nightReflection || '23:30') : (es.nightReflection || '23:30'),
    };
  }

  // ── 12. Behaviour ────────────────────────────────────────────────────────────
  sectionHeader('Behaviour');
  hint('Fine-tune how the bot behaves. Press Enter to use defaults.');
  console.log('');

  const eb = existing.behavior || {};
  const reactionPct   = await ask('Emoji reaction chance (0–100%)', Math.round((eb.emojiReactionChance ?? 0.20) * 100).toString());
  const followUpPct   = await ask('Follow-up thought chance (0–100%)', Math.round((eb.followUpChance ?? 0.12) * 100).toString());

  cfg.behavior = {
    emojiReactionChance:  Math.min(1, Math.max(0, Number(reactionPct) / 100)),
    followUpChance:       Math.min(1, Math.max(0, Number(followUpPct) / 100)),
    maxHistoryMessages:   Number(await ask('Max conversation history messages', String(eb.maxHistoryMessages ?? 50))),
  };

  // ── 13. Timezone ─────────────────────────────────────────────────────────────
  sectionHeader('Locale');
  cfg.timezone = await ask('Timezone', existing.timezone || 'Europe/London');

  // ── Save ──────────────────────────────────────────────────────────────────────
  cfg.setup_complete = true;
  botConfigUtil.save(cfg);

  // Update identity.txt
  const identityPath = path.join(process.cwd(), 'identity.txt');
  fs.writeFileSync(identityPath, `User name: ${cfg.userName}\nBot name: ${cfg.botName}\n`, 'utf8');

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('');
  console.log(bar());
  console.log('');
  console.log(good.bold('  ✔  Setup complete! Configuration saved.'));
  console.log('');

  const enabledFeatures = Object.entries(cfg.features).filter(([, v]) => v).map(([k]) => k);
  const disabledFeatures = Object.entries(cfg.features).filter(([, v]) => !v).map(([k]) => k);

  console.log(dim('  Summary:'));
  const statLine = (label, value) => {
    const padded = dim((label + ' ').padEnd(26, '·'));
    console.log(`    ${padded} ${chalk.white(value)}`);
  };
  statLine('Bot name',     cfg.botName);
  statLine('User name',    cfg.userName);
  statLine('Personality',  cfg.personality);
  statLine('Model',        cfg.model);
  statLine('Timezone',     cfg.timezone);
  statLine('Features on',  enabledFeatures.join(', ') || 'none');
  if (disabledFeatures.length) {
    statLine('Features off', disabledFeatures.join(', '));
  }

  console.log('');
  console.log(bar());
  console.log('');

  rl.close();

  // ── WhatsApp Connection ────────────────────────────────────────────────────────
  await connectWhatsApp(cfg);
}

async function connectWhatsApp(cfg) {
  sectionHeader('WhatsApp Connection');
  hint('Scan the QR code with your WhatsApp app to link this device.');
  hint('WhatsApp  →  Linked Devices  →  Link a Device');
  hint('If already linked, it will connect automatically.');
  console.log('');

  // Ask inline since readline is closed — use raw stdin
  const answer = await new Promise(resolve => {
    process.stdout.write(`  ${chalk.white.bold('?')} Connect WhatsApp now? ${chalk.gray('[Y/n]')}: `);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const onData = chunk => {
      const a = chunk.toString().trim().toLowerCase();
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      resolve(a === 'n' || a === 'no' ? false : true);
    };
    process.stdin.on('data', onData);
  });

  if (!answer) {
    console.log('');
    console.log(dim('  Skipped. Run node index.js — it will show the QR code on first launch.'));
    console.log('');
    console.log(bar());
    console.log('');
    process.exit(0);
  }

  console.log('');
  console.log(dim('  Starting WhatsApp client…'));
  console.log('');

  let { Client, LocalAuth } = require('whatsapp-web.js');
  const qrcode = require('qrcode-terminal');

  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  });

  let qrShown = false;

  client.on('qr', qr => {
    if (!qrShown) {
      console.log('');
      console.log(chalk.hex('#00d4ff').bold('  ┌─ Scan this QR code with WhatsApp ──────────────────────┐'));
      console.log('');
    }
    qrShown = true;
    qrcode.generate(qr, { small: true });
    console.log('');
    console.log(chalk.hex('#00d4ff').bold('  └─────────────────────────────────────────────────────────┘'));
    console.log('');
    console.log(dim('  QR codes expire after ~20 seconds. A new one will appear if needed.'));
    console.log('');
  });

  client.on('authenticated', () => {
    console.log(good('  ✔  Authenticated — waiting for WhatsApp to confirm…'));
    console.log('');
  });

  client.on('ready', async () => {
    console.log(good.bold('  ✔  WhatsApp connected successfully!'));
    console.log('');
    console.log(bar());
    console.log('');
    console.log(good.bold('  Setup complete. Start your bot with:'));
    console.log(`    ${chalk.hex('#00d4ff')('node index.js')}`);
    console.log('');
    console.log(bar());
    console.log('');
    await client.destroy();
    process.exit(0);
  });

  client.on('auth_failure', msg => {
    console.log(bad(`  ✘  Authentication failed: ${msg}`));
    console.log(dim('  Delete .wwebjs_auth/ and try again.'));
    process.exit(1);
  });

  client.initialize();
}

// ─── Entry point ──────────────────────────────────────────────────────────────
run().catch(err => {
  console.error(chalk.redBright('\n  Setup failed: ' + (err.message || err)));
  if (rl) rl.close();
  process.exit(1);
});
