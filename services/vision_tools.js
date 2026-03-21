/**
 * vision_tools.js — window screenshot + mouse/keyboard control
 *
 * Screenshot method: ImageMagick `import -window WINID`
 *   - Captures the window CLIENT AREA only (no title bar / decorations)
 *   - Coordinates in the resulting image match xdotool --window coords exactly
 *
 * HiDPI handling: detects scale factor from window logical size vs image pixel size.
 *   On a 2× display the screenshot is 2× larger than logical pixels, so we divide
 *   click coords by the scale factor before passing to xdotool.
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const VISION_DIR = path.join(process.cwd(), '.vision');

function ensureVisionDir() {
  if (!fs.existsSync(VISION_DIR)) fs.mkdirSync(VISION_DIR, { recursive: true });
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', timeout: 10000, ...opts });
}

function runSafe(cmd) {
  try { return run(cmd); } catch { return ''; }
}

// ─── Window ─────────────────────────────────────────────────────────────────

function findWindow(title) {
  const out = runSafe(`xdotool search --name "${title}" 2>/dev/null`).trim();
  const ids = out.split('\n').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  // Multiple windows — return the one with the largest area (skip tiny dummy windows)
  let best = ids[0], bestArea = 0;
  for (const id of ids) {
    const geo = getWindowGeometry(id);
    const area = geo.w * geo.h;
    if (area > bestArea) { bestArea = area; best = id; }
  }
  return best;
}

function getWindowGeometry(winId) {
  const geo = runSafe(`xdotool getwindowgeometry --shell ${winId} 2>/dev/null`);
  const x = parseInt(geo.match(/X=(\d+)/)?.[1]     || '0');
  const y = parseInt(geo.match(/Y=(\d+)/)?.[1]     || '0');
  const w = parseInt(geo.match(/WIDTH=(\d+)/)?.[1]  || '0');
  const h = parseInt(geo.match(/HEIGHT=(\d+)/)?.[1] || '0');
  return { x, y, w, h };
}

// ─── Screenshot ──────────────────────────────────────────────────────────────

/**
 * Capture the RuneLite (or any) window client area.
 * Returns { path, id, imgW, imgH, winW, winH, scaleX, scaleY }
 *
 * scaleX/Y: multiply image pixels by this to get logical pixels for xdotool.
 * On a 1× display these are 1.0; on 2× HiDPI they are 0.5.
 */
function screenshotWindow(title) {
  ensureVisionDir();

  const id = findWindow(title);
  if (!id) throw new Error(`Window "${title}" not found. Is RuneLite open?`);

  // Focus so the window is on top and not occluded
  runSafe(`xdotool windowfocus --sync ${id} 2>/dev/null`);
  // Brief settle time
  run('sleep 0.25');

  const shotPath = path.join(VISION_DIR, `${Date.now()}.png`);

  // Try ImageMagick `import` first (cleanest — client area only, no decorations)
  let captured = false;
  const importResult = spawnSync('import', ['-window', id, shotPath], { timeout: 8000 });
  if (importResult.status === 0 && fs.existsSync(shotPath)) {
    captured = true;
  }

  // Fallback: scrot (no decorations flag)
  if (!captured) {
    const scrotResult = spawnSync('scrot', ['-u', shotPath], { timeout: 8000 });
    if (scrotResult.status === 0 && fs.existsSync(shotPath)) captured = true;
  }

  // Last resort: gnome-screenshot (will include title bar — offset expected)
  if (!captured) {
    runSafe(`xdotool windowactivate --sync ${id} 2>/dev/null`);
    run('sleep 0.3');
    runSafe(`gnome-screenshot -w -f "${shotPath}" 2>/dev/null`);
  }

  if (!fs.existsSync(shotPath)) {
    throw new Error('Screenshot failed — no image file produced.');
  }

  // Get actual image dimensions
  const dimStr = runSafe(`identify -format "%wx%h" "${shotPath}" 2>/dev/null`).trim();
  const [imgW, imgH] = dimStr.includes('x')
    ? dimStr.split('x').map(Number)
    : [0, 0];

  // Get window logical size for HiDPI scale calculation
  const geo = getWindowGeometry(id);

  const scaleX = (geo.w > 0 && imgW > 0) ? imgW / geo.w : 1;
  const scaleY = (geo.h > 0 && imgH > 0) ? imgH / geo.h : 1;

  return { path: shotPath, id, imgW, imgH, winW: geo.w, winH: geo.h, scaleX, scaleY };
}

// ─── Mouse ───────────────────────────────────────────────────────────────────

/**
 * Click at image coordinates (x, y).
 * Applies HiDPI scale correction so clicks land in the right place.
 * button: 1=left, 3=right
 */
function clickAt(winId, imgX, imgY, scaleX, scaleY, button = 1) {
  const winX = Math.round(imgX / (scaleX || 1));
  const winY = Math.round(imgY / (scaleY || 1));

  // Move and click within the window's coordinate space
  run(`xdotool mousemove --window ${winId} --clearmodifiers ${winX} ${winY}`);
  run('sleep 0.04');
  run(`xdotool click --clearmodifiers ${button}`);
}

function clickWindow(winId, imgX, imgY, scaleX = 1, scaleY = 1) {
  clickAt(winId, imgX, imgY, scaleX, scaleY, 1);
}

function rightClickWindow(winId, imgX, imgY, scaleX = 1, scaleY = 1) {
  clickAt(winId, imgX, imgY, scaleX, scaleY, 3);
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

function typeText(text) {
  const safe = String(text || '').replace(/"/g, '\\"');
  run(`xdotool type --clearmodifiers "${safe}"`);
}

function pressKey(key) {
  run(`xdotool key --clearmodifiers "${String(key || '').trim()}"`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Delete screenshots older than maxAgeMs from the .vision dir.
 */
function cleanOldScreenshots(maxAgeMs = 5 * 60 * 1000) {
  try {
    const now = Date.now();
    const files = fs.readdirSync(VISION_DIR);
    for (const f of files) {
      if (!f.endsWith('.png')) continue;
      const fp = path.join(VISION_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fp);
      }
    }
  } catch { /* ignore */ }
}

// ─── Minimap detection ────────────────────────────────────────────────────────

/**
 * Detect the OSRS minimap circle center and radius from a screenshot.
 * Scans horizontal/vertical lines through the expected minimap region,
 * finds edges where MAP pixels (varied colors, brightness 50-230) transition
 * to PANEL pixels (near-black < 50 brightness).
 *
 * Returns { cx, cy, r } in image pixel coordinates.
 */
function detectMinimap(shotPath, imgW, imgH) {
  // Use Python + PIL to find the minimap by scanning for colorful terrain pixels
  // in the right 45% of the screen, top 55% vertically.
  // Minimap terrain has moderate brightness (50-220) AND some color saturation (max-min > 15).
  // The surrounding panel is near-black (brightness < 40).
  try {
    const script = `
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
W, H = img.size

# Scan right 40% x top 35% — minimap is in the top-right corner only.
# Stopping at 35% height prevents inventory items from skewing the bounding box.
x0 = int(W * 0.60)
y0 = 5
y1 = int(H * 0.35)
step = 4

xs, ys = [], []
for y in range(y0, y1, step):
    for x in range(x0, W - 2, step):
        r, g, b = img.getpixel((x, y))
        brightness = (r + g + b) / 3
        sat = max(r, g, b) - min(r, g, b)
        # Minimap terrain: moderate brightness, some saturation, not grey-panel dark
        if 45 < brightness < 215 and sat > 12:
            xs.append(x)
            ys.append(y)

if len(xs) < 20:
    # fallback: use proportional estimate
    print(f"{int(W*0.82)},{int(H*0.21)},{int(min(W,H)*0.17)}")
else:
    # Compute bounding box and use it to estimate circle
    lx, rx = min(xs), max(xs)
    ty, by = min(ys), max(ys)
    cx = (lx + rx) // 2
    cy = (ty + by) // 2
    # Radius = half the smaller span, but cap at half the larger (it's roughly circular)
    r = (min(rx - lx, by - ty)) // 2
    print(f"{cx},{cy},{r}")
`;
    const tmpScript = require('os').tmpdir() + '/detect_mm.py';
    require('fs').writeFileSync(tmpScript, script);
    const out = runSafe(`python3 "${tmpScript}" "${shotPath}" 2>/dev/null`).trim();
    require('fs').unlinkSync(tmpScript);
    const [cx, cy, r] = out.split(',').map(Number);
    if (cx > 0 && cy > 0 && r > 10) return { cx, cy, r };
  } catch { /* fall through to estimate */ }

  // Fallback: proportional estimate
  return {
    cx: Math.round(imgW * 0.82),
    cy: Math.round(imgH * 0.21),
    r:  Math.round(Math.min(imgW, imgH) * 0.17),
  };
}

/**
 * Given a target (x, y) and the minimap circle, clamp the point to be
 * safely inside the circle (at most 88% of radius from center).
 */
function clampToMinimap(x, y, mm) {
  const dx = x - mm.cx;
  const dy = y - mm.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = mm.r * 0.88;
  if (dist <= maxDist) return { x, y };
  const scale = maxDist / dist;
  return {
    x: Math.round(mm.cx + dx * scale),
    y: Math.round(mm.cy + dy * scale)
  };
}

module.exports = {
  screenshotWindow,
  clickWindow,
  rightClickWindow,
  typeText,
  pressKey,
  findWindow,
  cleanOldScreenshots,
  detectMinimap,
  clampToMinimap,
  VISION_DIR
};
