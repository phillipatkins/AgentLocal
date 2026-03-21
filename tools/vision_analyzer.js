const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const VISION_MODEL = 'qwen2.5vl:3b';
const VISION_TIMEOUT_MS = 45000;

function vlog(message) {
  const ts = new Date().toISOString();
  console.log(`[vision ${ts}] ${message}`);
}

function imageToBase64(filePath) {
  const abs = path.resolve(filePath);
  const data = fs.readFileSync(abs);
  vlog(`Loaded screenshot: ${abs} (${Math.round(data.length / 1024)} KB)`);
  return data.toString('base64');
}

async function resizeImageForVision(inputPath) {
  const outputPath = inputPath.replace(/\.png$/i, '_vision.png');

  await execFileAsync('convert', [
    inputPath,
    '-resize', '1024x1024>',
    outputPath
  ]);

  vlog(`Resized image for vision: ${outputPath}`);
  return outputPath;
}

async function cropImage(inputPath, x, y, w, h) {
  const outputPath = inputPath.replace(/\.png$/i, `_crop_${x}_${y}.png`);

  await execFileAsync('convert', [
    inputPath,
    '-crop', `${w}x${h}+${x}+${y}`,
    outputPath
  ]);

  vlog(`Cropped image: ${outputPath} (${w}x${h} at ${x},${y})`);
  return outputPath;
}

async function callVisionModel(imagePath, prompt, model = VISION_MODEL) {
  vlog(`Preparing vision request with model: ${model}`);
  vlog(`Vision prompt:\n${prompt}`);

  const resizedPath = await resizeImageForVision(imagePath);
  const imageBase64 = imageToBase64(resizedPath);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  const started = Date.now();
  let res;

  try {
    res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1
        }
      })
    });
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    if (err.name === 'AbortError') {
      vlog(`Vision HTTP request timed out after ${elapsed}s`);
      throw new Error(`Vision analysis timed out after ${elapsed}s`);
    }

    vlog(`Vision HTTP request failed after ${elapsed}s: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  vlog(`Vision HTTP request finished in ${elapsed}s`);

  if (!res) {
    throw new Error('Vision request failed before receiving a response');
  }

  if (!res.ok) {
    const text = await res.text();
    vlog(`Vision HTTP error ${res.status}: ${text}`);
    throw new Error(`Vision model HTTP error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const raw = data.response || '';

  vlog(`Vision raw response:\n${raw}`);

  return raw;
}

function extractJson(text) {
  const raw = String(text || '').trim();

  try {
    return JSON.parse(raw);
  } catch (_) {
    // continue
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Vision model did not return JSON. Raw response: ${raw}`);
  }

  return JSON.parse(match[0]);
}

async function analyzeScreenshot(imagePath, goal = '') {
  const prompt = `
You are analyzing a Linux desktop screenshot for a computer-control agent.

Goal:
${goal || '[not provided]'}

Return ONLY JSON with this shape:
{
  "summary": "short summary",
  "page_or_app": "what app or page is visible",
  "visible_targets": [
    {
      "label": "Download",
      "kind": "button"
    }
  ],
  "recommended_next_target": "best label to click next or empty string",
  "goal_progress": "not_started | in_progress | almost_done | done"
}

Rules:
- Prefer exact visible labels from the screenshot.
- Do not invent labels that are not visible.
- If a likely button or link exists, include it in visible_targets.
- Output JSON only.
`;

  vlog(`Starting screenshot analysis for goal: ${goal}`);
  vlog(`Image path: ${imagePath}`);

  const raw = await callVisionModel(imagePath, prompt, VISION_MODEL);
  const parsed = extractJson(raw);

  vlog(`Parsed vision JSON:\n${JSON.stringify(parsed, null, 2)}`);

  return {
    model: VISION_MODEL,
    raw,
    analysis: parsed
  };
}

module.exports = {
  analyzeScreenshot,
  callVisionModel,
  extractJson,
  resizeImageForVision,
  cropImage
};