const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');
const { convertTextToVoice } = require('../utils/voice');

const VOICES_DIR = path.join(process.cwd(), 'voices');
const DEFAULT_PIPER_MODEL = path.join(VOICES_DIR, 'en_GB-alan-medium.onnx');
const DEFAULT_PIPER_CONFIG = `${DEFAULT_PIPER_MODEL}.json`;

function tmp(name, ext) {
  return path.join(
    '/tmp',
    `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  );
}

function hasPiperVoice() {
  return fs.existsSync(DEFAULT_PIPER_MODEL) && fs.existsSync(DEFAULT_PIPER_CONFIG);
}

function speakWithPiper(text) {
  const wavPath = tmp('piper', 'wav');
  const oggPath = tmp('piper', 'ogg');

  const safeText = String(text || '').trim();
  if (!safeText) {
    throw new Error('No text provided for TTS');
  }

  logger.line('VOICE', 'Using Piper TTS', path.basename(DEFAULT_PIPER_MODEL));

  const escapedText = safeText
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');

  execSync(
    `printf "%s" "${escapedText}" | ./venv/bin/piper --model "${DEFAULT_PIPER_MODEL}" --output_file "${wavPath}"`,
    { stdio: 'pipe', shell: '/bin/bash' }
  );

  if (!fs.existsSync(wavPath)) {
    throw new Error('Piper did not create wav output');
  }

const SPEED = 1.15;

execSync(
  `ffmpeg -y -i "${wavPath}" -filter:a "atempo=${SPEED},volume=1.2" -c:a libopus -b:a 48k "${oggPath}"`,
  { stdio: 'ignore' }
);

  if (!fs.existsSync(oggPath)) {
    throw new Error('ffmpeg did not create ogg output');
  }

  try {
    fs.unlinkSync(wavPath);
  } catch {}

  return oggPath;
}

function speak(text) {
  if (hasPiperVoice()) {
    try {
      return speakWithPiper(text);
    } catch (error) {
      logger.line('ERR', 'Piper TTS failed, falling back to espeak', error.message || String(error));
    }
  } else {
    logger.line(
      'WARN',
      'Piper voice files not found, using espeak fallback',
      `${DEFAULT_PIPER_MODEL}`
    );
  }

  return convertTextToVoice(text);
}

module.exports = { speak };