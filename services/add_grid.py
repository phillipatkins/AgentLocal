#!/usr/bin/env python3
"""
add_grid.py — overlay a coordinate grid on a screenshot for GPT-4o.

Usage: python3 add_grid.py <input.png> <output.png> [grid_size]

Draws:
  - Semi-transparent white grid lines every grid_size pixels
  - Coordinate labels at every grid line so GPT can read exact pixel positions
    rather than estimating them visually
"""
import sys
from PIL import Image, ImageDraw, ImageFont

def add_grid(input_path, output_path, grid=100):
    img = Image.open(input_path).convert('RGBA')
    W, H = img.size

    # Separate overlay layer (semi-transparent)
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Grid lines — very thin, low opacity
    line_colour = (255, 255, 255, 55)   # white, ~22% opacity
    for x in range(0, W, grid):
        draw.line([(x, 0), (x, H)], fill=line_colour, width=1)
    for y in range(0, H, grid):
        draw.line([(0, y), (W, y)], fill=line_colour, width=1)

    # Merge grid over screenshot
    out = Image.alpha_composite(img, overlay).convert('RGB')
    draw2 = ImageDraw.Draw(out)

    # Labels — try to load a small monospace font, fall back to default
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/freefont/FreeMono.ttf', 11)
    except Exception:
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 11)
        except Exception:
            font = ImageFont.load_default()

    # X-axis labels along the top and bottom
    for x in range(0, W, grid):
        label = str(x)
        # top
        draw2.rectangle([x+1, 0, x+len(label)*7+2, 13], fill=(0, 0, 0, 180))
        draw2.text((x+2, 1), label, fill=(255, 255, 100), font=font)
        # bottom
        draw2.rectangle([x+1, H-14, x+len(label)*7+2, H-1], fill=(0, 0, 0, 180))
        draw2.text((x+2, H-13), label, fill=(255, 255, 100), font=font)

    # Y-axis labels along the left and right
    for y in range(0, H, grid):
        label = str(y)
        # left
        draw2.rectangle([0, y+1, len(label)*7+2, y+13], fill=(0, 0, 0, 180))
        draw2.text((2, y+1), label, fill=(100, 255, 255), font=font)
        # right
        draw2.rectangle([W-len(label)*7-3, y+1, W-1, y+13], fill=(0, 0, 0, 180))
        draw2.text((W-len(label)*7-2, y+1), label, fill=(100, 255, 255), font=font)

    out.save(output_path, 'PNG')
    print(f'Grid overlay done: {W}x{H} grid={grid}px → {output_path}')

if __name__ == '__main__':
    inp  = sys.argv[1]
    outp = sys.argv[2]
    gsz  = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    add_grid(inp, outp, gsz)
