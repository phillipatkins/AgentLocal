const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { cmdExists } = require('../utils/platform');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || require('path').join(require('os').homedir(), 'Downloads');
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');
// Find yt-dlp: check PATH first, then common user locations
function findYtdlp() {
  if (cmdExists('yt-dlp')) return 'yt-dlp';
  const home = require('os').homedir();
  const candidates = [
    path.join(home, 'bin', 'yt-dlp'),
    path.join(home, '.local', 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];
  for (const c of candidates) {
    if (require('fs').existsSync(c)) return c;
  }
  return 'yt-dlp'; // fallback — will fail with clear error
}
const YTDLP_BIN = process.env.YTDLP_BIN || findYtdlp();
const COOKIE_FILE = process.env.YOUTUBE_COOKIE_FILE || path.join(PROJECT_ROOT, 'cookies', 'youtube_cookies.txt');

module.exports = function youtubeDownload({ url, mode = 'video', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const cleanUrl = String(url || '').trim();
      const cleanMode = String(mode || 'video').toLowerCase();

      if (!cleanUrl) {
        return reject(new Error('No URL provided'));
      }

      if (path.isAbsolute(YTDLP_BIN) && !fs.existsSync(YTDLP_BIN)) {
        return reject(new Error(`yt-dlp binary not found: ${YTDLP_BIN}`));
      }

      if (!fs.existsSync(COOKIE_FILE)) {
        return reject(new Error(`Cookie file not found: ${COOKIE_FILE}`));
      }

      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

      const outputTemplate = path.join(DOWNLOAD_DIR, '%(title)s [%(id)s].%(ext)s');

      const args = [
        '--cookies', COOKIE_FILE,
        '--js-runtimes', 'node',
        '--newline',
        '--no-playlist',
        '-o', outputTemplate
      ];

      if (cleanMode === 'audio' || cleanMode === 'mp3') {
        args.push(
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0'
        );
      } else {
        args.push(
          '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
          '--merge-output-format', 'mp4'
        );
      }

      args.push(cleanUrl);

      let stdout = '';
      let stderr = '';

      const p = spawn(YTDLP_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      p.stdout.on('data', (data) => {
        const line = data.toString();
        stdout += line;

        if (typeof onProgress === 'function') {
          try {
            onProgress(line);
          } catch (_) {}
        }
      });

      p.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;

        if (typeof onProgress === 'function') {
          try {
            onProgress(line);
          } catch (_) {}
        }
      });

      p.on('error', (err) => {
        reject(new Error(err.message || String(err)));
      });

      p.on('close', (code) => {
        const combined = `${stdout}\n${stderr}`.trim();

        if (code === 0) {
          resolve({
            ok: true,
            message: `✅ YouTube download completed.\nSaved to ${DOWNLOAD_DIR}`,
            output: combined
          });
          return;
        }

        const usefulError =
          combined ||
          `yt-dlp exited ${code}`;

        reject(new Error(usefulError));
      });
    } catch (err) {
      reject(new Error(err.message || String(err)));
    }
  });
};