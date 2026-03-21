const { screenOCR } = require('../tools/screen_ocr');
const { analyzeScreenshot } = require('../tools/vision_analyzer');

const PLANNER_MODEL = 'qwen2.5:7b-instruct';
const VISION_TIMEOUT = 6000;

function plog(message) {
  const ts = new Date().toISOString();
  console.log(`[planner ${ts}] ${message}`);
}

async function callOllama(prompt, model = PLANNER_MODEL) {
  plog(`Calling planner model: ${model}`);

  const started = Date.now();

  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1
      }
    })
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  plog(`Planner HTTP request finished in ${elapsed}s`);

  if (!res.ok) {
    const text = await res.text();
    plog(`Planner HTTP error ${res.status}: ${text}`);
    throw new Error(`Ollama HTTP error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const raw = data.response || '';

  plog(`Planner raw response:\n${raw}`);

  return raw;
}

function sanitizeScreenText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120)
    .join('\n');
}

function hasAny(text, needles) {
  const hay = String(text || '').toLowerCase();
  return needles.some((needle) => hay.includes(String(needle).toLowerCase()));
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
    throw new Error(`Planner did not return JSON. Raw response: ${raw}`);
  }

  return JSON.parse(match[0]);
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') {
    throw new Error('Planner returned an invalid action object.');
  }

  const normalized = {
    type: String(action.type || '').trim()
  };

  if (!normalized.type) {
    throw new Error('Planner action is missing "type".');
  }

  if (action.url != null) normalized.url = String(action.url).trim();
  if (action.text != null) normalized.text = String(action.text).trim();
  if (action.key != null) normalized.key = String(action.key).trim();
  if (action.reason != null) normalized.reason = String(action.reason).trim();

  return normalized;
}

function shouldUseVision(ocrText, history) {
  if (!ocrText || ocrText.length < 20) return true;

  const historyText = JSON.stringify(history.slice(-8)).toLowerCase();

  if (historyText.includes('verification failed')) return true;
  if (historyText.includes('could not find')) return true;
  if (historyText.includes('search results')) return true;
  if (historyText.includes('did not visibly change')) return true;

  return false;
}

async function runVisionWithTimeout(path, goal) {
  return Promise.race([
    analyzeScreenshot(path, goal),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Vision timeout')), VISION_TIMEOUT)
    )
  ]);
}

function inferScreenState(ocrText, visionSummary) {
  const text = String(ocrText || '').toLowerCase();
  const visionPage = String(visionSummary.page_or_app || '').toLowerCase();

  if (
    hasAny(text, ['these are results for', 'search instead for', 'google']) ||
    hasAny(visionPage, ['search', 'google'])
  ) {
    return 'search_results';
  }

  if (
    hasAny(text, ['old school runescape', 'play old school rs', 'oldschool.runescape.com']) ||
    hasAny(visionPage, ['old school runescape', 'runescape'])
  ) {
    return 'osrs_site';
  }

  if (hasAny(text, ['jagex launcher', 'windows', 'mac', 'linux', 'download for'])) {
    return 'download_page';
  }

  if (hasAny(text, ['firefox', 'new tab', 'search with google or enter address'])) {
    return 'browser';
  }

  return 'unknown';
}

async function planner(goal, history = []) {
  plog(`Starting planner for goal: ${goal}`);
  plog('Capturing screenshot + OCR');

  const screen = await screenOCR();
  const visibleText = sanitizeScreenText(screen.text);

  plog(`Screenshot path: ${screen.screenshot}`);
  plog(`OCR visible text:\n${visibleText || '[no readable text detected]'}`);

  let visionSummary = {
    summary: '',
    page_or_app: '',
    visible_targets: [],
    recommended_next_target: '',
    goal_progress: 'not_started'
  };

  if (shouldUseVision(visibleText, history)) {
    try {
      plog(`Running vision fallback on: ${screen.screenshot}`);
      const vision = await runVisionWithTimeout(screen.screenshot, goal);
      visionSummary = vision.analysis || visionSummary;
      plog(`Vision summary:\n${JSON.stringify(visionSummary, null, 2)}`);
    } catch (err) {
      plog(`Vision skipped: ${err.message}`);
    }
  } else {
    plog('Skipping vision on this step; using OCR-only planning');
  }

  const screenState = inferScreenState(visibleText, visionSummary);
  plog(`Inferred screen state: ${screenState}`);

  const recentHistory = Array.isArray(history)
    ? history.slice(-12).map((item, i) => `${i + 1}. ${JSON.stringify(item)}`).join('\n')
    : '';

  const prompt = `
You control a Linux desktop and must choose the NEXT single action only.

Goal:
${goal}

Current inferred screen state:
${screenState}

OCR visible text:
${visibleText || '[no readable text detected]'}

Vision summary:
${JSON.stringify(visionSummary, null, 2)}

Recent action history:
${recentHistory || '[none]'}

Return EXACTLY ONE JSON object and nothing else.

Allowed actions:
{"type":"open_firefox"}
{"type":"open_url","url":"https://oldschool.runescape.com"}
{"type":"click_text","text":"Old School RuneScape - Play Old School RS"}
{"type":"click_text","text":"Download"}
{"type":"click_text","text":"Jagex Launcher"}
{"type":"click_text","text":"Windows"}
{"type":"click_text","text":"Linux"}
{"type":"click_text","text":"Mac"}
{"type":"press_key","key":"Return"}
{"type":"done","reason":"goal completed"}

Important rules:
- Output JSON only.
- Verify context mentally before choosing an action.
- Never click a generic "Download" unless the current screen clearly looks like the OSRS site or a Jagex/launcher download page.
- If the screen is search results, click the official OSRS result first, not Download.
- If the target site is not clearly visible yet, prefer open_url.
- If the previous action failed verification, choose a recovery action instead of repeating the same bad click.
- Do not click text from random apps or background windows.
- Prefer actions whose target text is visible in OCR text or listed in vision visible_targets.
- If already on the OSRS site but no Download is visible, choose the next best visible site-specific label such as Jagex Launcher, Play Old School RS, Windows, Linux, or Mac.
- If the goal appears completed, return {"type":"done","reason":"..."}.
`;

  const raw = await callOllama(prompt, PLANNER_MODEL);
  const parsed = extractJson(raw);
  const action = normalizeAction(parsed);

  plog(`Normalized planner action: ${JSON.stringify(action)}`);

  return action;
}

module.exports = {
  planner,
  callOllama
};
