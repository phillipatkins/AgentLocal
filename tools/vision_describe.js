const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const OLLAMA_API_URL =
  process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434/api/generate';

const OLLAMA_VISION_MODEL =
  process.env.OLLAMA_VISION_MODEL || 'moondream';

const SCREEN_DISPLAY =
  process.env.SCREEN_DISPLAY || ':0';

async function tryScrot(imagePath) {
  await execFileAsync('scrot', [imagePath], {
    env: { ...process.env, DISPLAY: SCREEN_DISPLAY }
  });
}

async function tryImport(imagePath) {
  await execFileAsync('import', ['-window', 'root', imagePath], {
    env: { ...process.env, DISPLAY: SCREEN_DISPLAY }
  });
}

async function takeScreenshot() {
  const imagePath = path.join('/tmp', `vision-shot-${Date.now()}.png`);
  let lastError = null;

  try {
    await tryScrot(imagePath);
  } catch (err) {
    lastError = err;
  }

  if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
    try {
      await tryImport(imagePath);
    } catch (err) {
      lastError = err;
    }
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Screenshot was not created. DISPLAY=${SCREEN_DISPLAY}`);
  }

  const stats = fs.statSync(imagePath);
  if (!stats.size) {
    throw new Error(
      `Screenshot file is empty. DISPLAY=${SCREEN_DISPLAY}${lastError ? ` | ${lastError.message}` : ''}`
    );
  }

  return imagePath;
}

function cleanText(text) {
  return String(text || '')
    .replace(/<unk>/gi, '')
    .replace(/<s>/gi, '')
    .replace(/<\/s>/gi, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function askVisionModel(imagePath, prompt) {
  const imageBuffer = fs.readFileSync(imagePath);

  if (!imageBuffer.length) {
    throw new Error('Image buffer is empty.');
  }

  const imageBase64 = imageBuffer.toString('base64');

  const res = await fetch(OLLAMA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      prompt,
      images: [imageBase64],
      stream: false
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const output = cleanText(data?.response || '');

  if (!output) {
    throw new Error(`${OLLAMA_VISION_MODEL} returned no text response.`);
  }

  return output;
}

module.exports = async function visionDescribe(args = {}) {
  let imagePath = null;

  try {
    const action = String(args.action || '').trim().toLowerCase();

    if (action !== 'describe-screen') {
      return {
        ok: false,
        error: 'Unsupported action.'
      };
    }

    imagePath = await takeScreenshot();

    const prompt = [
      'Describe this computer screen in detail.',
      'Be concrete and visual, not generic.',
      'List the main visible regions or windows from left to right and top to bottom.',
      'Mention approximate position and what each section contains.',
      'Mention app types when obvious, such as browser, chat app, code editor, terminal, or file manager.',
      'Mention desktop icons, dock, taskbar, or wallpaper if visible.',
      'If text is too small to read, say it is too small or unreadable instead of inventing it.',
      'Do not make up filenames, chat messages, or exact text unless it is clearly legible.',
      'Return 5 to 10 short bullet points.'
    ].join(' ');

    const description = await askVisionModel(imagePath, prompt);

    return {
      ok: true,
      message: `🖥️ ${description}`,
      imagePath
    };
  } catch (error) {
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (_) {}
    }

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};