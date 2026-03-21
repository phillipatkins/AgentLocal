const { exec } = require('child_process');
const { promisify } = require('util');

const run = promisify(exec);

async function listWindows() {
  const { stdout } = await run('wmctrl -l');
  const lines = stdout.trim() ? stdout.trim().split('\n') : [];

  return lines.map((line) => {
    const parts = line.split(/\s+/);
    return {
      id: parts[0],
      desktop: parts[1],
      host: parts[2],
      title: parts.slice(3).join(' ')
    };
  });
}

async function getActiveWindow() {
  const { stdout } = await run('xdotool getactivewindow getwindowname');
  return stdout.trim();
}

async function focusWindow(title) {
  const safeTitle = String(title || '').replace(/"/g, '\\"');
  await run(`wmctrl -a "${safeTitle}"`);
  return true;
}

async function moveMouse(x, y) {
  await run(`xdotool mousemove ${Number(x)} ${Number(y)}`);
  return true;
}

async function clickMouse(button = 1) {
  await run(`xdotool click ${Number(button)}`);
  return true;
}

async function typeText(text) {
  const safeText = String(text || '').replace(/"/g, '\\"');
  await run(`xdotool type --delay 10 "${safeText}"`);
  return true;
}

async function pressKey(key) {
  await run(`xdotool key ${key}`);
  return true;
}

module.exports = {
  listWindows,
  getActiveWindow,
  focusWindow,
  moveMouse,
  clickMouse,
  typeText,
  pressKey
};