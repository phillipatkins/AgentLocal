#!/usr/bin/env python3
"""
add_markers.py — overlay numbered dot markers on a screenshot.

Prints a JSON object mapping marker number -> [x, y] to stdout.
The caller uses this map to convert GPT's marker choice into exact pixel coords.

Usage: python3 add_markers.py <input.png> <output.png>
"""
import sys, json
from PIL import Image, ImageDraw, ImageFont

SPACING_X = 120   # px between marker columns
SPACING_Y = 100   # px between marker rows
OFFSET_X  = 60    # x of first column
OFFSET_Y  = 50    # y of first row
RADIUS    = 14    # circle radius in pixels

def add_markers(input_path, output_path, json_path):
    img = Image.open(input_path).convert('RGB')
    W, H = img.size
    draw = ImageDraw.Draw(img)

    font = None
    for fp in [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ]:
        try:
            font = ImageFont.truetype(fp, 11)
            break
        except Exception:
            pass
    if font is None:
        font = ImageFont.load_default()

    markers = {}
    n = 1
    y = OFFSET_Y
    while y <= H - OFFSET_Y // 2:
        x = OFFSET_X
        while x <= W - OFFSET_X // 2:
            # Yellow circle with black outline
            draw.ellipse(
                [x - RADIUS, y - RADIUS, x + RADIUS, y + RADIUS],
                fill=(255, 220, 0), outline=(0, 0, 0), width=2
            )
            # Black number centered inside circle
            label = str(n)
            try:
                bbox = draw.textbbox((0, 0), label, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
            except Exception:
                tw, th = 7 * len(label), 11
            draw.text((x - tw // 2, y - th // 2), label, fill=(0, 0, 0), font=font)
            markers[n] = [x, y]
            n += 1
            x += SPACING_X
        y += SPACING_Y

    img.save(output_path, 'PNG')
    # Write marker positions to a JSON file (more reliable than stdout capture)
    with open(json_path, 'w') as f:
        json.dump(markers, f)

if __name__ == '__main__':
    add_markers(sys.argv[1], sys.argv[2], sys.argv[3])
