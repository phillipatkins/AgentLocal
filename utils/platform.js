'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { execSync, spawnSync } = require('child_process');

// ─── OS detection ─────────────────────────────────────────────────────────────
const isWindows = process.platform === 'win32';
const isMac     = process.platform === 'darwin';
const isLinux   = process.platform === 'linux';
// WSL reports linux but WSLENV or /proc/version contains "microsoft"
const isWSL = isLinux && (() => {
  try { return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'); }
  catch { return false; }
})();

// ─── Temp directory ───────────────────────────────────────────────────────────
function tmpFile(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}${ext}`);
}

// ─── Command existence ────────────────────────────────────────────────────────
function cmdExists(cmd) {
  const check = isWindows ? `where ${cmd}` : `which ${cmd}`;
  try { execSync(check, { stdio: 'ignore' }); return true; } catch { return false; }
}

function pyModuleExists(mod) {
  const py = cmdExists('python3') ? 'python3' : cmdExists('python') ? 'python' : null;
  if (!py) return false;
  try {
    execSync(`${py} -c "import ${mod}"`, { stdio: 'ignore', shell: true, timeout: 5000 });
    return true;
  } catch { return false; }
}

// ─── Python command ───────────────────────────────────────────────────────────
function pythonCmd() {
  if (cmdExists('python3')) return 'python3';
  if (cmdExists('python'))  return 'python';
  return 'python3';
}

function pipCmd() {
  if (cmdExists('pip3')) return 'pip3';
  if (cmdExists('pip'))  return 'pip';
  return 'pip3';
}

// ─── Package manager ──────────────────────────────────────────────────────────
function pkgManager() {
  if (isWindows) return 'winget';           // or choco
  if (isMac)     return cmdExists('brew') ? 'brew' : null;
  // Linux — detect distro
  if (cmdExists('apt-get'))  return 'apt';
  if (cmdExists('dnf'))      return 'dnf';
  if (cmdExists('yum'))      return 'yum';
  if (cmdExists('pacman'))   return 'pacman';
  if (cmdExists('zypper'))   return 'zypper';
  return null;
}

function installCmd(pkg, mgr) {
  const m = mgr || pkgManager();
  switch (m) {
    case 'apt':    return `sudo apt-get install -y ${pkg}`;
    case 'dnf':    return `sudo dnf install -y ${pkg}`;
    case 'yum':    return `sudo yum install -y ${pkg}`;
    case 'pacman': return `sudo pacman -S --noconfirm ${pkg}`;
    case 'zypper': return `sudo zypper install -y ${pkg}`;
    case 'brew':   return `brew install ${pkg}`;
    default:       return null;
  }
}

// Package name mapping per manager
const PKG_NAMES = {
  ffmpeg:     { apt: 'ffmpeg',    brew: 'ffmpeg',    dnf: 'ffmpeg',      pacman: 'ffmpeg'      },
  'espeak-ng':{ apt: 'espeak-ng', brew: 'espeak-ng', dnf: 'espeak-ng',   pacman: 'espeak-ng'   },
  aria2c:     { apt: 'aria2',     brew: 'aria2',     dnf: 'aria2',       pacman: 'aria2'       },
  scrot:      { apt: 'scrot',     brew: null,        dnf: 'scrot',       pacman: 'scrot'       },
  git:        { apt: 'git',       brew: 'git',       dnf: 'git',         pacman: 'git'         },
};

function pkgInstallCmd(tool) {
  const mgr = pkgManager();
  if (!mgr) return null;
  const key = mgr === 'apt' ? 'apt' : mgr;
  const name = PKG_NAMES[tool]?.[key] || tool;
  if (!name) return null;
  return installCmd(name, mgr);
}

// ─── Screenshot command ───────────────────────────────────────────────────────
function screenshotCmd(outputPath) {
  const q = JSON.stringify(outputPath);
  if (isWindows) {
    // PowerShell screenshot
    return `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save(${q}) }"`;
  }
  if (isMac) {
    return `screencapture -x ${q}`;
  }
  // Linux — prefer scrot, fallback to gnome-screenshot, then import (ImageMagick)
  if (cmdExists('scrot'))             return `scrot ${q}`;
  if (cmdExists('gnome-screenshot'))  return `gnome-screenshot -f ${q}`;
  if (cmdExists('import'))            return `import -window root ${q}`;
  if (cmdExists('spectacle'))         return `spectacle -b -o ${q}`;
  return `scrot ${q}`; // fallback with a clear error
}

// ─── Kill stale browser process ───────────────────────────────────────────────
function killStaleBrowser(pattern) {
  try {
    if (isWindows) {
      execSync('taskkill /F /IM chrome.exe /T 2>nul & taskkill /F /IM chromium.exe /T 2>nul', { stdio: 'ignore', shell: true });
    } else {
      execSync(`pkill -f "${pattern}" 2>/dev/null || true`, { stdio: 'ignore', shell: true });
    }
  } catch { /* ignore */ }
}

// ─── Browser / Chrome profile path ───────────────────────────────────────────
function chromeBrowserProfilePath() {
  const home = os.homedir();
  if (isWindows) return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  if (isMac)     return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(home, '.config', 'google-chrome'); // Linux default
}

// ─── Chromium binary name (for remote-debug launch) ──────────────────────────
function chromiumBinary() {
  const candidates = isWindows
    ? ['chrome', 'chromium', 'chromium-browser']
    : isMac
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium',
       'chromium', 'google-chrome']
    : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const c of candidates) {
    if (cmdExists(c)) return c;
  }
  return candidates[0]; // best guess
}

// ─── TTS engine ───────────────────────────────────────────────────────────────
function ttsEngine() {
  if (cmdExists('piper'))     return 'piper';
  if (cmdExists('espeak-ng')) return 'espeak-ng';
  if (cmdExists('espeak'))    return 'espeak';
  if (isWindows)              return 'powershell-sapi'; // Windows SAPI via PowerShell
  if (isMac)                  return 'say';             // macOS built-in
  return null;
}

function ttsSpeakCmd(text, outputWav) {
  const engine = ttsEngine();
  const safeText = JSON.stringify(String(text || ''));
  const q = JSON.stringify(outputWav);
  switch (engine) {
    case 'piper':
      return `echo ${safeText} | piper --output_file ${q}`;
    case 'espeak-ng':
      return `espeak-ng -w ${q} ${safeText}`;
    case 'espeak':
      return `espeak -w ${q} ${safeText}`;
    case 'say':
      // macOS: speak to AIFF then convert with ffmpeg
      return `say -o ${q} --data-format=LEF32@22050 ${safeText}`;
    case 'powershell-sapi':
      return `powershell -Command "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile(${JSON.stringify(outputWav)}); $s.Speak(${JSON.stringify(text)}); $s.Dispose()"`;
    default:
      return null;
  }
}

// ─── Ollama installer command ─────────────────────────────────────────────────
function ollamaInstallCmd() {
  if (isWindows) return null; // manual install — point to ollama.ai
  if (isMac)     return 'brew install ollama 2>/dev/null || curl -fsSL https://ollama.com/install.sh | sh';
  return 'curl -fsSL https://ollama.com/install.sh | sh'; // Linux
}

// ─── yt-dlp install ───────────────────────────────────────────────────────────
function ytdlpInstallCmd() {
  if (cmdExists('pip3') || cmdExists('pip')) {
    return `${pipCmd()} install yt-dlp`;
  }
  if (isWindows) return null;
  const binPath = '/usr/local/bin/yt-dlp';
  return `sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${binPath} && sudo chmod a+rx ${binPath}`;
}

module.exports = {
  isWindows, isMac, isLinux, isWSL,
  tmpFile,
  cmdExists, pyModuleExists,
  pythonCmd, pipCmd,
  pkgManager, installCmd, pkgInstallCmd,
  screenshotCmd,
  killStaleBrowser,
  chromeBrowserProfilePath,
  chromiumBinary,
  ttsEngine, ttsSpeakCmd,
  ollamaInstallCmd, ytdlpInstallCmd,
};
