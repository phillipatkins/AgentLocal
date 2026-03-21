// whatsapp/config.defaults.js
const path = require('path');

module.exports = {
  DOWNLOAD_DIR: process.env.DOWNLOAD_DIR || path.join(require('os').homedir(), 'Downloads'),
  YTDLP_BIN: process.env.YTDLP_BIN || '/usr/bin/yt-dlp',
  ARIA2_BIN: process.env.ARIA2_BIN || '/usr/bin/aria2c',
  FFMPEG_BIN: process.env.FFMPEG_BIN || '/usr/bin/ffmpeg',
  SCROT_BIN: process.env.SCROT_BIN || 'scrot',
  ESPEAK_BIN: process.env.ESPEAK_BIN || 'espeak-ng',
  VENV_ROOT: process.env.VENV_ROOT || path.join(require('os').homedir(), 'venv'),
  USE_SAFE_MODE: !!process.env.SAFE_MODE,
  // ...add others as needed
};
