const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ALLOWED_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');
const MAX_FILE_BYTES = 700 * 1024;
const COMMAND_TIMEOUT_MS = 10000;

function safePath(p) {
  const raw = String(p || '').trim();
  if (!raw) throw new Error('Missing path');

  const resolved = path.resolve(raw);
  const allowedRoot = path.resolve(ALLOWED_ROOT);

  if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path.sep)) {
    throw new Error(`Path not allowed: ${resolved}`);
  }

  return resolved;
}

function screenshotHTML(filePath) {
  return new Promise((resolve) => {
    const outPath = `${filePath}.png`;
    const url = `file://${filePath}`;

    const cmd = [
      'if command -v google-chrome >/dev/null 2>&1; then',
      `  google-chrome --headless --disable-gpu --virtual-time-budget=7000 --run-all-compositor-stages-before-draw --hide-scrollbars --window-size=1440,2200 --screenshot="${outPath}" "${url}";`,
      'elif command -v chromium >/dev/null 2>&1; then',
      `  chromium --headless --disable-gpu --virtual-time-budget=7000 --run-all-compositor-stages-before-draw --hide-scrollbars --window-size=1440,2200 --screenshot="${outPath}" "${url}";`,
      'elif command -v chromium-browser >/dev/null 2>&1; then',
      `  chromium-browser --headless --disable-gpu --virtual-time-budget=7000 --run-all-compositor-stages-before-draw --hide-scrollbars --window-size=1440,2200 --screenshot="${outPath}" "${url}";`,
      'fi'
    ].join(' ');

    exec(cmd, { shell: true }, () => resolve(outPath));
  });
}

async function executeToolCall(call) {
  const tool = String(call.tool || '').trim();
  const args = call.args || {};

  if (tool === 'write_file') {
    const target = safePath(args.path);
    const content = String(args.content || '');

    if (!content.trim()) {
      throw new Error('Refusing to write blank file');
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`Content too large. Max allowed is ${MAX_FILE_BYTES} bytes.`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');

    const stats = fs.statSync(target);
    if (stats.size === 0) {
      throw new Error('File write failed: zero-byte file');
    }

    let previewPath = '';
    if (target.endsWith('.html')) {
      previewPath = await screenshotHTML(target);
    }

    return { status: 'written', path: target, previewPath };
  }

  if (tool === 'read_file') {
    const target = safePath(args.path);
    return fs.readFileSync(target, 'utf8').slice(0, 12000);
  }

  if (tool === 'list_dir') {
    const target = safePath(args.path || ALLOWED_ROOT);
    return fs.readdirSync(target).join('\n');
  }

  if (tool === 'run_command') {
    const command = String(args.command || '').trim();
    if (!command) throw new Error('Missing command');

    return new Promise((resolve, reject) => {
      exec(command, { cwd: ALLOWED_ROOT, timeout: COMMAND_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(String(stdout || stderr || '').trim());
      });
    });
  }

  throw new Error(`Unknown tool: ${tool}`);
}

module.exports = { executeToolCall };
