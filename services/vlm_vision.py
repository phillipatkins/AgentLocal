#!/usr/bin/env python3
"""
VLM-based OSRS vision agent — two-model pipeline.

Step 1: moondream (1.7GB, GPU) — fast visual description of game state
Step 2: qwen2.5:7b-instruct (text, GPU) — decision + pixel coordinates from description

Uses only Python stdlib — no external packages required.
"""

import sys
import json
import base64
import re
import subprocess
import urllib.request
import urllib.error

OLLAMA_URL    = 'http://localhost:11434/api/chat'
DESCRIBE_MODEL = 'moondream:latest'
DECIDE_MODEL   = 'qwen2.5:7b-instruct'


def encode_image(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


def get_image_dims(path):
    try:
        r = subprocess.run(
            ['identify', '-format', '%wx%h', path],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0 and 'x' in r.stdout:
            w, h = r.stdout.strip().split('x')
            return int(w), int(h)
    except Exception:
        pass
    return 0, 0


def call_ollama(model, messages, num_predict=300, temperature=0.05):
    payload = {
        'model': model,
        'messages': messages,
        'stream': False,
        'options': {
            'temperature': temperature,
            'num_predict': num_predict,
            'top_p': 0.9
        }
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        OLLAMA_URL, data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        return result['message']['content'].strip()


def describe_screen(image_b64, goal, history_text):
    """
    Step 1: use moondream to describe what's on screen.
    Returns a text description of the game state + object positions.
    """
    prompt = (
        f"This is an Old School RuneScape (OSRS) game screenshot.\n"
        f"Current goal: {goal}\n"
        f"{history_text}\n\n"
        "Please describe exactly what you see:\n"
        "1. Player state: is the character idle, animating (chopping/fishing/mining/fighting), "
        "walking/moving, in dialogue (chat box open), level-up popup, at a bank, or dead?\n"
        "2. What objects, NPCs, trees, fishing spots, rocks, or items are visible in the "
        "GAME WORLD (large left portion of screen)? For each, say where it is: "
        "upper-left / upper-center / upper-right / center-left / center / center-right / "
        "lower-left / lower-center / lower-right of the game world.\n"
        "3. Any visible text, dialogue boxes, or popups?\n"
        "4. Inventory status (right panel): roughly how full? Any notable items?\n"
        "Be brief and specific. Focus on what matters for the goal."
    )
    messages = [
        {'role': 'user', 'content': prompt, 'images': [image_b64]}
    ]
    return call_ollama(DESCRIBE_MODEL, messages, num_predict=250, temperature=0)


def decide_action(description, goal, history, width, height):
    """
    Step 2: use qwen2.5:7b-instruct to decide the action from the description.
    Returns parsed JSON action dict.
    """
    # Compute OSRS layout pixel ranges from screen size
    vp_right  = int(width  * 0.62)   # game viewport right edge
    vp_bottom = int(height * 0.87)   # game viewport bottom edge
    inv_left  = int(width  * 0.72)   # inventory panel left edge
    mm_left   = int(width  * 0.75)   # minimap left edge

    # Reference coordinate table for common viewport positions
    coord_hints = (
        f"  upper-left of game world  → roughly ({int(width*0.12)}, {int(height*0.12)})\n"
        f"  upper-center of game world → roughly ({int(width*0.31)}, {int(height*0.12)})\n"
        f"  upper-right of game world  → roughly ({int(width*0.55)}, {int(height*0.12)})\n"
        f"  center-left of game world  → roughly ({int(width*0.12)}, {int(height*0.43)})\n"
        f"  center of game world       → roughly ({int(width*0.31)}, {int(height*0.43)})\n"
        f"  center-right of game world → roughly ({int(width*0.55)}, {int(height*0.43)})\n"
        f"  lower-left of game world   → roughly ({int(width*0.12)}, {int(height*0.72)})\n"
        f"  lower-center of game world → roughly ({int(width*0.31)}, {int(height*0.72)})\n"
        f"  lower-right of game world  → roughly ({int(width*0.55)}, {int(height*0.72)})\n"
    )

    system = f"""You are an autonomous Old School RuneScape (OSRS) player AI.
You receive a text description of the game screen and must decide the best next action.

SCREEN: {width}x{height} pixels. Coordinates: (0,0) = top-left, x right, y down.
LAYOUT:
  Game viewport (3D world): x=0..{vp_right}, y=0..{vp_bottom}
  Minimap (circular radar):  top-right corner, x={mm_left}..{width}, y=0..{int(height*0.22)}
  Inventory panel:           x={inv_left}..{width}, y={int(height*0.35)}..{vp_bottom}
  Chat box:                  y={vp_bottom}..{height}

POSITION → PIXEL COORDINATE LOOKUP:
{coord_hints}

DECISION RULES:
1. dialogue or level_up popup visible → close it: click the text or press Space
2. character animating and goal action in progress → wait (don't interrupt)
3. character idle and goal needs action → click the target in the GAME WORLD
4. inventory full and gathering goal → drop cheap items or walk to bank
5. Use right_click for specific context menu options (Chop down / Lure / Fish / Talk-to / Drop)
6. Use left_click for most interactions (walk, basic interact, close popups)
7. Click inside the game world, NOT the UI panels, unless managing inventory/bank

OUTPUT: respond with ONLY this JSON — no markdown, no explanation:
{{
  "state": "idle|animating|moving|dialogue|level_up|banking|dead|inventory_full|other",
  "action": "click|right_click|key|wait",
  "x": <integer pixel x, or null if action is wait/key>,
  "y": <integer pixel y, or null if action is wait/key>,
  "key": "<key name if action=key, e.g. space, Escape>",
  "target": "<what you are clicking in 5 words>",
  "reasoning": "<one sentence why this progresses the goal>",
  "done": <true only if overall goal is complete>,
  "wait_ms": <ms to wait: 350=UI click, 700=game click, 1500=starting activity, 2500=walking far, 500=dialogue>
}}"""

    history_text = build_history_text(history)
    user_msg = (
        f"GOAL: {goal}\n"
        f"{history_text}\n\n"
        f"SCREEN DESCRIPTION:\n{description}\n\n"
        "Decide the single best next action."
    )

    messages = [
        {'role': 'system', 'content': system},
        {'role': 'user',   'content': user_msg}
    ]
    return call_ollama(DECIDE_MODEL, messages, num_predict=400, temperature=0.05)


def extract_json(text):
    try:
        return json.loads(text.strip())
    except Exception:
        pass
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    return None


def build_history_text(history):
    if not history:
        return ''
    recent = history[-6:]
    lines = []
    for h in recent:
        step = h.get('step', '?')
        act  = h.get('action', '?')
        x, y = h.get('x'), h.get('y')
        pos  = f' at ({x},{y})' if x is not None and y is not None else ''
        tgt  = h.get('target', '')
        res  = h.get('result', '')
        st   = h.get('state', '')
        line = f"  step {step} [{st}]: {act}{pos} -> {tgt}"
        if res:
            line += f" ({res})"
        lines.append(line)
    return '\nRecent actions:\n' + '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: vlm_vision.py <input_json_file>'}))
        sys.exit(1)

    input_file = sys.argv[1]
    with open(input_file, 'r') as f:
        inp = json.load(f)

    image_path = inp['imagePath']
    goal       = inp['goal']
    history    = inp.get('history', [])
    width      = inp.get('width', 0)
    height     = inp.get('height', 0)

    if not width or not height:
        width, height = get_image_dims(image_path)

    history_text = build_history_text(history)
    image_b64    = encode_image(image_path)

    # Step 1: moondream — describe the screen
    try:
        description = describe_screen(image_b64, goal, history_text)
    except urllib.error.URLError as e:
        print(json.dumps({'error': f'Ollama connection failed: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'Screen description failed: {e}'}))
        sys.exit(1)

    # Step 2: qwen2.5:7b-instruct — decide action from description
    try:
        raw    = decide_action(description, goal, history, width, height)
        result = extract_json(raw)
        if result:
            # Attach description for debugging (stripped in production)
            result['_description'] = description[:200]
            print(json.dumps(result))
            sys.exit(0)
        else:
            print(json.dumps({'error': f'Could not parse JSON from: {raw[:300]}'}))
            sys.exit(1)
    except urllib.error.URLError as e:
        print(json.dumps({'error': f'Ollama connection failed: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'Action decision failed: {e}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
