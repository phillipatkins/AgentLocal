const chalk = require('chalk');

// ─── Tag definitions ──────────────────────────────────────────────────────────
const TAGS = {
  IN:    { color: chalk.cyanBright,         label: 'IN ' },
  OUT:   { color: chalk.magentaBright,      label: 'OUT' },
  CMD:   { color: chalk.blueBright,         label: 'CMD' },
  MEM:   { color: chalk.yellowBright,       label: 'MEM' },
  WEB:   { color: chalk.greenBright,        label: 'WEB' },
  OK:    { color: chalk.greenBright,        label: 'OK ' },
  WARN:  { color: chalk.hex('#ffb000'),     label: 'WRN' },
  ERR:   { color: chalk.redBright,         label: 'ERR' },
  SYS:   { color: chalk.hex('#00d4ff'),    label: 'SYS' },
  TOOL:  { color: chalk.hex('#c3e88d'),    label: 'TLO' },
  DBG:   { color: chalk.gray,              label: 'DBG' },
  SCHED: { color: chalk.hex('#ff9800'),    label: 'SCH' },
  VOICE: { color: chalk.hex('#c792ea'),    label: 'VOX' },
  AI:    { color: chalk.hex('#82aaff'),    label: 'AI ' },
  SETUP: { color: chalk.hex('#00e676'),    label: 'SET' },
  REM:   { color: chalk.hex('#ffcc02'),    label: 'REM' },
};

// ─── Timestamp ────────────────────────────────────────────────────────────────
function ts() {
  return chalk.gray(new Date().toTimeString().slice(0, 8));
}

// ─── Tag renderer ─────────────────────────────────────────────────────────────
function renderTag(type) {
  const t = TAGS[type] || { color: x => x, label: type.slice(0, 3).padEnd(3) };
  return t.color(`[${t.label}]`);
}

// ─── Core log line ────────────────────────────────────────────────────────────
function line(type, text, meta = '', err = null) {
  let out = `${ts()} ${renderTag(type)} ${chalk.white(text)}`;
  if (meta) out += chalk.gray(` │ ${meta}`);
  if (err)  out += chalk.redBright(` │ ${err.message || String(err)}`);
  console.log(out);
}

// ─── Shorthand helpers ────────────────────────────────────────────────────────
const success = (text, meta)      => line('OK',    text, meta);
const warn    = (text, meta)      => line('WARN',  text, meta);
const error   = (text, meta, err) => line('ERR',   text, meta, err);
const info    = (text, meta)      => line('SYS',   text, meta);
const sched   = (text, meta)      => line('SCHED', text, meta);
const voice   = (text, meta)      => line('VOICE', text, meta);
const cmd     = (text, meta)      => line('CMD',   text, meta);

// ─── Debug (only if DEBUG=true) ───────────────────────────────────────────────
function debug(text) {
  if (process.env.DEBUG === 'true') {
    console.log(`${ts()} ${renderTag('DBG')} ${chalk.gray(text)}`);
  }
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function divider(label = '', color = chalk.gray) {
  const width = Math.min(process.stdout.columns || 80, 88);
  if (!label) {
    console.log(color('─'.repeat(width)));
    return;
  }
  const text = `  ${label}  `;
  const pad  = Math.max(0, width - text.length);
  const left = '─'.repeat(Math.floor(pad / 2));
  const rite = '─'.repeat(Math.ceil(pad / 2));
  console.log(color(`${left}${chalk.bold(text)}${rite}`));
}

// ─── Section subheader ────────────────────────────────────────────────────────
function section(label) {
  const width = Math.min(process.stdout.columns || 80, 88);
  console.log('');
  const text = ` ◆ ${label} `;
  const pad  = Math.max(0, width - text.length - 2);
  console.log(chalk.hex('#00d4ff')(`  ◆ ${chalk.bold(label)} `) + chalk.gray('─'.repeat(pad)));
  console.log('');
}

// ─── Key/value stat line ──────────────────────────────────────────────────────
function stat(label, value, valueColor = chalk.white) {
  const padded = chalk.gray((label + ' ').padEnd(24, '·'));
  console.log(`  ${padded} ${valueColor(String(value))}`);
}

// ─── Startup banner ───────────────────────────────────────────────────────────
function banner(botName = 'Bot', version = '1.0') {
  const width = Math.min(process.stdout.columns || 80, 88);
  const bar   = chalk.hex('#00d4ff')('═'.repeat(width));

  console.log('');
  console.log(bar);
  console.log('');

  const title = `  WhatsApp AI Bot  ·  ${botName}`;
  const sub   = `  Ollama + whatsapp-web.js  ·  v${version}`;
  console.log(chalk.hex('#00d4ff').bold(title));
  console.log(chalk.gray(sub));

  console.log('');
  console.log(bar);
  console.log('');
}

// ─── Box for important messages ───────────────────────────────────────────────
function box(title, lines = [], color = chalk.hex('#00d4ff')) {
  const width = Math.min(process.stdout.columns || 80, 60);
  const inner = width - 4;
  const top    = color('╔' + '═'.repeat(width - 2) + '╗');
  const bottom = color('╚' + '═'.repeat(width - 2) + '╝');
  const mid    = (text) => {
    const padded = String(text).slice(0, inner).padEnd(inner);
    return color('║ ') + chalk.white(padded) + color(' ║');
  };
  const empty  = color('║' + ' '.repeat(width - 2) + '║');

  console.log('');
  console.log(top);
  if (title) {
    console.log(color('║ ') + chalk.bold(title.slice(0, inner).padEnd(inner)) + color(' ║'));
    console.log(color('╠' + '═'.repeat(width - 2) + '╣'));
  }
  if (lines.length) {
    console.log(empty);
    lines.forEach(l => console.log(mid(l)));
    console.log(empty);
  }
  console.log(bottom);
  console.log('');
}

module.exports = {
  line,
  debug,
  divider,
  section,
  banner,
  stat,
  box,
  success,
  warn,
  error,
  info,
  sched,
  voice,
  cmd,
};
