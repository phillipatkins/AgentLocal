const { planner } = require('./agent_planner');
const { desktopAgent } = require('./desktop_agent');
const { findText } = require('../tools/find_text_on_screen');
const { screenOCR } = require('../tools/screen_ocr');
const {
  moveMouse,
  clickMouse,
  pressKey,
  typeText,
  focusWindow
} = require('../tools/desktop_control');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alog(message) {
  const ts = new Date().toISOString();
  console.log(`[agent ${ts}] ${message}`);
}

function normalizeWord(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
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

function scoreMatch(target, match, screenText = '') {
  const wanted = normalizeWord(target);
  const actual = normalizeWord(match && match.text);

  if (!actual) return -1000;

  let score = 0;

  if (actual === wanted) score += 1000;
  else if (actual.startsWith(wanted)) score += 700;
  else if (wanted.startsWith(actual)) score += 500;
  else if (actual.includes(wanted)) score += 300;
  else if (wanted.includes(actual)) score += 200;

  // Prefer top-most matches a bit less aggressively than before.
  score -= Math.round((match.y || 0) / 25);

  const hay = String(screenText || '').toLowerCase();

  if (wanted === 'download') {
    if (hasAny(hay, ['old school rune', 'oldschool.runescape.com', 'jagex', 'runescape'])) {
      score += 250;
    } else {
      score -= 600;
    }
  }

  return score;
}

function chooseBestTextMatch(target, matches, screenText = '') {
  if (!Array.isArray(matches) || !matches.length) return null;

  const ranked = matches
    .map((match) => ({
      ...match,
      _score: scoreMatch(target, match, screenText)
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a.y - b.y;
    });

  return ranked[0];
}

async function observeScreen() {
  const screen = await screenOCR();
  return {
    screenshot: screen.screenshot,
    text: sanitizeScreenText(screen.text)
  };
}

function verifyActionEffect(action, beforeText, afterText) {
  const before = String(beforeText || '').toLowerCase();
  const after = String(afterText || '').toLowerCase();

  const changed = before !== after;
  const onOsrsSite = hasAny(after, [
    'old school runescape',
    'play old school rs',
    'oldschool.runescape.com',
    'jagex launcher',
    'runescape'
  ]);
  const onSearchResults = hasAny(after, [
    'these are results for',
    'search instead for',
    'google',
    'all videos forums images shopping news'
  ]);

  if (action.type === 'open_url') {
    if (onOsrsSite) {
      return { ok: true, reason: 'Target site content is visible after navigation.' };
    }

    if (onSearchResults) {
      return { ok: false, reason: 'Navigation landed on search results instead of the target page.' };
    }

    if (!changed) {
      return { ok: false, reason: 'Screen did not visibly change after open_url.' };
    }

    return { ok: true, reason: 'Screen changed after open_url; planner should inspect the new page.' };
  }

  if (action.type === 'click_text') {
    if (!changed) {
      return { ok: false, reason: `Screen did not visibly change after clicking "${action.text}".` };
    }

    if (normalizeWord(action.text) === 'download' && !onOsrsSite && !hasAny(after, ['launcher', 'windows', 'linux', 'mac'])) {
      return { ok: false, reason: 'Clicked a Download target but the page context does not look like OSRS or a client download page.' };
    }

    return { ok: true, reason: `Screen changed after clicking "${action.text}".` };
  }

  if (action.type === 'open_firefox') {
    if (!changed) {
      return { ok: false, reason: 'Firefox open action did not visibly change the screen.' };
    }

    return { ok: true, reason: 'Screen changed after opening Firefox.' };
  }

  return {
    ok: changed,
    reason: changed ? 'Screen changed after action.' : 'Screen did not visibly change after action.'
  };
}

async function clickText(target) {
  alog(`Finding text target on screen: "${target}"`);
  const currentScreen = await observeScreen();
  const matches = await findText(target);

  alog(`findText returned ${matches.length} match(es): ${JSON.stringify(matches)}`);

  if (!matches.length) {
    throw new Error(`Could not find "${target}" on screen`);
  }

  const chosen = chooseBestTextMatch(target, matches, currentScreen.text);

  if (!chosen) {
    throw new Error(`No suitable match found for "${target}"`);
  }

  if (chosen._score < 0) {
    throw new Error(`Best match for "${target}" looks unsafe or out of context: ${chosen.text}`);
  }

  alog(
    `Chosen match for "${target}": ${JSON.stringify({
      text: chosen.text,
      x: Math.round(chosen.x),
      y: Math.round(chosen.y),
      score: chosen._score
    })}`
  );

  await moveMouse(chosen.x, chosen.y);
  await sleep(250);

  alog(`Clicking mouse on target "${chosen.text}"`);
  await clickMouse(1);

  return `Clicked "${chosen.text}"`;
}

async function openUrlInFirefox(url) {
  const safeUrl = String(url || '').trim();

  if (!safeUrl) {
    throw new Error('Missing URL for open_url action.');
  }

  alog(`Opening Firefox before navigating to: ${safeUrl}`);
  await desktopAgent('open firefox');
  await sleep(1200);

  alog('Focusing Firefox window');
  await focusWindow('Firefox');
  await sleep(500);

  alog('Selecting Firefox address bar');
  await pressKey('ctrl+l');
  await sleep(250);

  alog(`Typing URL directly: ${safeUrl}`);
  await typeText(safeUrl);
  await sleep(250);

  alog('Pressing Enter to navigate');
  await pressKey('Return');

  return `Opened URL: ${safeUrl}`;
}

async function runAction(action) {
  alog(`Executing action: ${JSON.stringify(action)}`);

  switch (action.type) {
    case 'open_firefox':
      return desktopAgent('open firefox');

    case 'open_url':
      return openUrlInFirefox(action.url);

    case 'click_text':
      return clickText(action.text);

    case 'press_key':
      alog(`Pressing key: ${action.key}`);
      await pressKey(action.key);
      return `Pressed key: ${action.key}`;

    case 'type_text':
      alog(`Typing text: ${action.text}`);
      await typeText(action.text);
      return `Typed text: ${action.text}`;

    case 'done':
      return action.reason || 'Task completed';

    default:
      throw new Error(`Unknown planner action type: ${action.type}`);
  }
}

async function autonomousAgent(goal, onProgress) {
  const history = [];

  alog(`Starting autonomous agent with goal: ${goal}`);

  if (onProgress) {
    await onProgress(`🤖 Starting goal: ${goal}`);
  }

  for (let i = 0; i < 16; i++) {
    const stepNumber = i + 1;

    alog(`----- STEP ${stepNumber} -----`);
    alog('Observing screen before planning');

    const before = await observeScreen();
    history.push({ observation_before: before.text });

    if (onProgress) {
      await onProgress(`🧠 Step ${stepNumber}: planning...`);
    }

    let action;
    try {
      action = await planner(goal, history);
    } catch (err) {
      alog(`Planner failed at step ${stepNumber}: ${err.stack || err.message}`);
      throw err;
    }

    history.push({ action });
    alog(`Planner chose action: ${JSON.stringify(action)}`);

    if (action.type === 'done') {
      alog(`Goal completed: ${action.reason || 'done'}`);

      if (onProgress) {
        await onProgress(`✅ Step ${stepNumber}: task complete.`);
      }

      return `Task completed: ${action.reason || 'done'}`;
    }

    if (onProgress) {
      if (action.type === 'open_firefox') {
        await onProgress(`🦊 Step ${stepNumber}: opening Firefox...`);
      } else if (action.type === 'open_url') {
        await onProgress(`🌐 Step ${stepNumber}: opening ${action.url}...`);
      } else if (action.type === 'click_text') {
        await onProgress(`🖱️ Step ${stepNumber}: clicking "${action.text}"...`);
      } else if (action.type === 'press_key') {
        await onProgress(`⌨️ Step ${stepNumber}: pressing ${action.key}...`);
      } else if (action.type === 'type_text') {
        await onProgress('⌨️ Step ${stepNumber}: typing text...');
      }
    }

    let result;
    try {
      result = await runAction(action);
      history.push({ result });
      alog(`Action result: ${result}`);
    } catch (err) {
      const errorMessage = err.stack || err.message;
      history.push({ error: errorMessage, failed_action: action });
      alog(`Action failed at step ${stepNumber}: ${errorMessage}`);

      if (onProgress) {
        await onProgress(`⚠️ Step ${stepNumber} failed: ${err.message}`);
      }

      await sleep(700);
      continue;
    }

    await sleep(900);

    const after = await observeScreen();
    history.push({ observation_after: after.text });

    const verification = verifyActionEffect(action, before.text, after.text);
    history.push({ verification });

    alog(`Verification: ${JSON.stringify(verification)}`);

    if (onProgress) {
      await onProgress(`✅ Step ${stepNumber} result: ${verification.reason}`);
    }

    if (!verification.ok) {
      alog('Action did not verify cleanly; continuing with new observation and failure context.');
      history.push({ error: `Verification failed: ${verification.reason}`, failed_action: action });
      await sleep(500);
      continue;
    }
  }

  const finalMessage = `Agent stopped after step limit. Last history: ${JSON.stringify(history.slice(-10))}`;
  alog(finalMessage);

  return finalMessage;
}

module.exports = { autonomousAgent };
