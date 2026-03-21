/**
 * mouse_vision_agent.js — Autonomous OSRS agent powered by GPT-4o vision
 *
 * Usage (from commands.js):
 *   runOsrsAgent({ goal: 'train woodcutting', onProgress: async (msg) => ... })
 *   stopOsrsAgent()
 *   getOsrsAgentStatus()
 *
 * Loop:
 *   1. Screenshot RuneLite window
 *   2. Send screenshot + goal + history to GPT-4o via browser relay (relayVisionAction)
 *   3. GPT returns { state, action, x, y, key, target, reasoning, done, wait_ms }
 *   4. Execute action (click / right_click / key / wait)
 *   5. Wait wait_ms, then go back to 1
 *   6. Stop on: done=true | max steps | stop flag | RuneLite closed
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const {
  screenshotWindow,
  clickWindow,
  rightClickWindow,
  pressKey,
  cleanOldScreenshots,
  findWindow,
  detectMinimap,
  clampToMinimap,
} = require('./vision_tools');

const { relayVisionAction } = require('./ai_relays');

const MAX_STEPS          = 200;
const UPDATE_EVERY_N_STEPS = 3;


// ─── Agent state ─────────────────────────────────────────────────────────────

let agentRunning  = false;
let agentStopFlag = false;
let agentGoal     = '';
let agentStep     = 0;
let agentLastMsg  = '';

function getOsrsAgentStatus() {
  if (!agentRunning) return { running: false };
  return { running: true, goal: agentGoal, step: agentStep, lastMsg: agentLastMsg };
}

function stopOsrsAgent() {
  if (!agentRunning) return false;
  agentStopFlag = true;
  return true;
}

// ─── GPT-4o vision call ───────────────────────────────────────────────────────

function buildPrompt(goal, history, vpImgW, vpImgH, mm, fullW, fullH, markerMap) {
  const histText = history.length
    ? '\n\nRecent actions:\n' + history.slice(-6).map(h => {
        const pos = (h.x != null && h.y != null) ? ` at (${h.x},${h.y})` : '';
        return `  step ${h.step} [${h.state}]: ${h.action}${pos} → ${h.target} (${h.result})`;
      }).join('\n')
    : '';

  const totalMarkers = Object.keys(markerMap).length;

  return `You are controlling Old School RuneScape (OSRS) via mouse/keyboard on Linux.

IMAGE: Shows ONLY the game viewport (3D world) — ${vpImgW}×${vpImgH}px. Right-side panels (minimap, inventory) and bottom chat box are NOT shown.

NUMBERED YELLOW DOTS: The image has ${totalMarkers} numbered yellow circles overlaid on it. Each dot marks an exact click position. To click somewhere, simply tell me which dot number is closest to your target. That's it — do not estimate pixel coordinates.

MINIMAP NAVIGATION: The minimap is NOT in this image. To navigate, specify a direction:
  N, NE, E, SE, S, SW, W, NW, or CENTER
  (These map to exact pre-computed minimap coordinates.)

GAME STATES:
- idle: player standing still — you MUST act
- animating: actively doing skill (mining/chopping/fishing/fighting) — WAIT, do not interrupt
- moving: player walking (yellow ground marker visible) — WAIT to arrive
- dialogue: NPC chat box open — press Space or click continue
- level_up: fireworks popup — press Space
- banking: bank grid open
- dead: "Oh dear, you are dead!"
- inventory_full: all 28 slots occupied

DECISION RULES (strict priority):
1. CONTEXT MENU visible (white pop-up list of options) → click the correct option text — HIGHEST PRIORITY
2. dialogue or level_up → dismiss (Space key)
3. animating AND correct skill active → wait
4. idle → interact with target object
5. inventory_full while gathering → drop cheap items or walk to bank

INTERACTION RULES:
- Mining/Woodcutting/Fishing/Cooking: RIGHT-CLICK the rock/tree/spot/fire first
  → context menu appears → NEXT STEP click the correct option (e.g. "Mine Tin rock")
- NPC: right_click NPC → click "Talk-to [name]"
- Walking in game world: left_click a walkable ground tile (pick the dot on the path/ground)
- Minimap travel: use action "minimap" with minimap_dir

GOAL: ${goal}${histText}

Respond with ONLY this JSON (no markdown, no explanation):
{
  "state": "idle|animating|moving|dialogue|level_up|banking|dead|inventory_full|other",
  "action": "click|right_click|key|wait|minimap",
  "marker": <dot number 1-${totalMarkers} if clicking in game world, else null>,
  "minimap_dir": "<N|NE|E|SE|S|SW|W|NW|CENTER if action=minimap, else null>",
  "key": "<key name if action=key, e.g. space, Escape, else null>",
  "target": "<what you are targeting in 5 words>",
  "reasoning": "<one sentence why this action>",
  "done": <true only when overall goal is fully complete>,
  "wait_ms": <350=UI/menu click, 700=game world click, 1500=start activity, 2500=minimap travel, 500=dialogue>
}`;
}

function extractJson(text) {
  // Strip markdown fences if present
  const stripped = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch (_) {}

  // Find first {...} block
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

// Crop to just the game viewport before sending to GPT.
// Viewport = left 68% × top 87% of window (excludes right UI panels and bottom chat box).
const VP_W_FRAC    = 0.68;
const VP_H_FRAC    = 0.87;
const GPT_TARGET_W = 1080;

async function askGPT(shot, goal, history) {
  // Crop region in original image pixels
  const vpW = Math.round(shot.imgW * VP_W_FRAC);
  const vpH = Math.round(shot.imgH * VP_H_FRAC);

  // Scale factor to resize cropped viewport to GPT_TARGET_W
  const scaleToGpt = GPT_TARGET_W / vpW;
  const gptW = GPT_TARGET_W;
  const gptH = Math.round(vpH * scaleToGpt);

  // 1. Crop viewport, resize
  const resizedPath = shot.path.replace('.png', '_gpt.png');
  execSync(
    `convert "${shot.path}" -crop ${vpW}x${vpH}+0+0 +repage -resize ${gptW}x${gptH}! "${resizedPath}"`,
    { timeout: 8000 }
  );

  // 2. Overlay numbered dot markers — GPT picks a number, we map it to exact coords
  const markedPath  = shot.path.replace('.png', '_marked.png');
  const markerJson  = shot.path.replace('.png', '_markers.json');
  const addMarkersScript = path.join(__dirname, 'add_markers.py');
  execSync(
    `python3 "${addMarkersScript}" "${resizedPath}" "${markedPath}" "${markerJson}"`,
    { timeout: 10000 }
  );
  try { fs.unlinkSync(resizedPath); } catch { /* ignore */ }

  if (!fs.existsSync(markedPath)) throw new Error('add_markers.py failed to create marked image');
  if (!fs.existsSync(markerJson)) throw new Error('add_markers.py failed to create marker JSON');

  // markerMap: { "1": [x,y], "2": [x,y], ... } in GPT-image (viewport) pixel space
  const markerMap = JSON.parse(fs.readFileSync(markerJson, 'utf8'));
  try { fs.unlinkSync(markerJson); } catch { /* ignore */ }

  // 3. Compute minimap coords in full-image space (given to GPT as text, not on image)
  const mmFull = detectMinimap(shot.path, shot.imgW, shot.imgH);

  const prompt = buildPrompt(goal, history, gptW, gptH, mmFull, shot.imgW, shot.imgH, markerMap);
  const raw    = await relayVisionAction('gpt', prompt, markedPath);
  try { fs.unlinkSync(markedPath); } catch { /* ignore */ }

  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`GPT returned unparseable response: ${String(raw).slice(0, 200)}`);

  // 4. Convert marker number → viewport pixel coords → full-image coords
  const markerNum = parsed.marker != null ? String(parsed.marker) : null;
  if (markerNum && markerMap[markerNum]) {
    const [vpX, vpY] = markerMap[markerNum];
    parsed.x = Math.round(vpX / scaleToGpt);
    parsed.y = Math.round(vpY / scaleToGpt);
  } else if (parsed.minimap_dir) {
    // Minimap direction → pre-computed full-image coords
    const dir = String(parsed.minimap_dir).toUpperCase();
    const r   = mmFull.r;
    const mmCoords = {
      N:      [mmFull.cx,                       mmFull.cy - Math.round(r * 0.82)],
      NE:     [mmFull.cx + Math.round(r * 0.58), mmFull.cy - Math.round(r * 0.58)],
      E:      [mmFull.cx + Math.round(r * 0.82), mmFull.cy],
      SE:     [mmFull.cx + Math.round(r * 0.58), mmFull.cy + Math.round(r * 0.58)],
      S:      [mmFull.cx,                       mmFull.cy + Math.round(r * 0.82)],
      SW:     [mmFull.cx - Math.round(r * 0.58), mmFull.cy + Math.round(r * 0.58)],
      W:      [mmFull.cx - Math.round(r * 0.82), mmFull.cy],
      NW:     [mmFull.cx - Math.round(r * 0.58), mmFull.cy - Math.round(r * 0.58)],
      CENTER: [mmFull.cx,                       mmFull.cy],
    };
    const coords = mmCoords[dir] || mmCoords.CENTER;
    parsed.x = coords[0];
    parsed.y = coords[1];
  }
  // If neither marker nor minimap_dir, x/y stay null (key/wait actions)

  parsed._mm = mmFull;
  return parsed;
}

// ─── Action execution ────────────────────────────────────────────────────────

function executeAction(action, shot) {
  const { action: type, x, y, key } = action;

  if (type === 'click' && x != null && y != null) {
    clickWindow(shot.id, x, y, shot.scaleX, shot.scaleY);
    return `clicked (${x},${y})`;
  }

  if (type === 'right_click' && x != null && y != null) {
    rightClickWindow(shot.id, x, y, shot.scaleX, shot.scaleY);
    return `right-clicked (${x},${y})`;
  }

  if (type === 'key' && key) {
    pressKey(key);
    return `pressed ${key}`;
  }

  if (type === 'wait') {
    return 'waited';
  }

  return 'no-op';
}

// ─── Stuck detection ─────────────────────────────────────────────────────────

function buildStuckJitter(x, y, stuckCount) {
  const radius = Math.min(stuckCount * 5, 25);
  const angle  = Math.random() * 2 * Math.PI;
  return {
    x: Math.round(x + Math.cos(angle) * radius),
    y: Math.round(y + Math.sin(angle) * radius)
  };
}

// ─── Main agent loop ─────────────────────────────────────────────────────────

async function runOsrsAgent({ goal, onProgress }) {
  if (agentRunning) {
    await onProgress?.('⚠️ Agent is already running. Send "stop osrs" first.');
    return { success: false, reason: 'already_running' };
  }

  agentRunning  = true;
  agentStopFlag = false;
  agentGoal     = goal;
  agentStep     = 0;
  agentLastMsg  = '';

  const send = async (msg) => {
    agentLastMsg = msg;
    try { await onProgress?.(msg); } catch { /* ignore */ }
  };

  const history  = [];
  let lastCoords = null;
  let stuckCount = 0;

  // Pre-flight: RuneLite open?
  if (!findWindow('RuneLite')) {
    agentRunning = false;
    await send('❌ RuneLite window not found. Open the game first.');
    return { success: false, reason: 'no_window' };
  }

  await send(
    `🎮 OSRS Agent started\n📋 Goal: ${goal}\n\n` +
    `🤖 Using GPT-4o vision — make sure "use gpt" is active (browser must be logged in).\n` +
    `I'll update you every ${UPDATE_EVERY_N_STEPS} steps. Send "stop osrs" to stop.`
  );

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      agentStep = step;

      if (agentStopFlag) {
        await send(`🛑 Stopped at step ${step}.`);
        return { success: false, reason: 'stopped', steps: step };
      }

      if (!findWindow('RuneLite')) {
        await send('⚠️ RuneLite window not found. Is the game open?');
        await sleep(3000);
        continue;
      }

      // 1. Screenshot
      let shot;
      try {
        shot = screenshotWindow('RuneLite');
      } catch (err) {
        await send(`⚠️ Screenshot failed: ${err.message}`);
        await sleep(2000);
        continue;
      }

      // 2. Ask GPT-4o
      let action;
      try {
        action = await askGPT(shot, goal, history);
      } catch (err) {
        await send(`⚠️ GPT error at step ${step}: ${err.message}`);
        await sleep(3000);
        continue;
      }

      const { state, action: actionType, target, reasoning, done, wait_ms } = action;
      let { x, y } = action;

      // 3a. For minimap actions, clamp coords to stay inside the circle, execute as click
      if (actionType === 'minimap' && action._mm && x != null && y != null) {
        const clamped = clampToMinimap(x, y, action._mm);
        x = clamped.x;
        y = clamped.y;
        action.action = 'click'; // executeAction reads action.action
      }

      // 3b. Stuck detection
      if (actionType === 'click' || actionType === 'right_click') {
        if (lastCoords && lastCoords.x === x && lastCoords.y === y) {
          stuckCount++;
          if (stuckCount >= 3) {
            const jitter = buildStuckJitter(x, y, stuckCount);
            x = jitter.x;
            y = jitter.y;
          }
        } else {
          stuckCount = 0;
          lastCoords = { x, y };
        }
      }

      // 4. Execute (use corrected x/y)
      action.x = x;
      action.y = y;
      let result = 'ok';
      try {
        result = executeAction(action, shot);
      } catch (err) {
        result = `error: ${err.message}`;
      }

      // 5. Record history
      history.push({ step, state, action: actionType, x, y, target, result });
      if (history.length > 25) history.shift();

      // 6. Progress update
      const isImportant = done || state === 'level_up' || state === 'dialogue' || state === 'dead';
      if (step % UPDATE_EVERY_N_STEPS === 0 || isImportant) {
        const icon   = stateIcon(state);
        const actStr = actionType === 'wait' ? '⏳ waiting' : `${actionType} → ${target}`;
        await send(`${icon} Step ${step} | ${state}\n${actStr}\n${reasoning}`);
      }

      // 7. Done?
      if (done) {
        await send(`✅ Goal complete!\n"${goal}"`);
        try {
          const finalShot = screenshotWindow('RuneLite');
          return { success: true, steps: step, screenshotPath: finalShot.path };
        } catch {
          return { success: true, steps: step };
        }
      }

      // 8. Wait — right_click in game world needs a bit extra for context menu to appear
      const isGameWorldRightClick = actionType === 'right_click' && x != null &&
        x < shot.imgW * 0.68; // left 68% = game viewport
      const baseWait = typeof wait_ms === 'number' ? wait_ms : 700;
      const waitTime = Math.min(isGameWorldRightClick ? Math.max(baseWait, 600) : baseWait, 5000);
      await sleep(waitTime);

      if (step % 20 === 0) cleanOldScreenshots();
    }

    await send(`⏱️ Reached ${MAX_STEPS} steps — stopping.`);
    return { success: false, reason: 'max_steps', steps: MAX_STEPS };

  } finally {
    agentRunning  = false;
    agentStopFlag = false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stateIcon(state) {
  return {
    idle:           '🧍',
    animating:      '⚒️',
    moving:         '🚶',
    dialogue:       '💬',
    level_up:       '🎉',
    banking:        '🏦',
    dead:           '💀',
    inventory_full: '🎒',
    other:          '🔍'
  }[state] || '🔍';
}

// Legacy compatibility
async function runMouseVisionTask(opts) {
  if (typeof opts === 'function') {
    await opts('⚠️ Please use the new command: "osrs: [your goal]"');
    return;
  }
  const { goal, onProgress } = opts || {};
  return runOsrsAgent({ goal: goal || 'play the game', onProgress });
}

module.exports = {
  runOsrsAgent,
  runMouseVisionTask,
  stopOsrsAgent,
  getOsrsAgentStatus
};
