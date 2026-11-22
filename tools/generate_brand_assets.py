#!/usr/bin/env python3
"""
PKPilot0011 · CinePlate — HD2Lab brand asset generator (Soft Iris)
==============================================================
Produces the official HD2Lab asset set for CinePlate, out of the same
dual-skew mark the app header and the plate emblems use:

    favicon.svg, favicon.ico(16/32/48), favicon-32x32.png,
    apple-touch-icon.png(180), icon-192.png, icon-512.png,
    manifest.json,
    og-image.png / social-preview.png (1200×630)

The OG card inherits the Shutterplate (PKPilot0003) card layout — Soft Iris
grid backdrop, white container card, kicker + privacy mark, dual-skew lockup,
two-line headline, two lines of sub copy, three tiles and a footer rail —
and fills it with CinePlate content (Film Studio × Shutterplate).

    python3 tools/generate_brand_assets.py [--font PATH] [--out DIR]
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

try:
    import cairosvg
except ImportError:  # pragma: no cover
    cairosvg = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── brand tokens (HD2Lab Soft Iris) ─────────────────────────────────────────
BG = "#FAFAFD"
GRID = "#EFEDF7"
CARD = "#FFFFFF"
CARD_BORDER = "#E8E4F2"
TILE = "#FFFFFF"
TILE_BORDER = "#E7E2F5"
INK = "#1B1A24"
PURPLE = "#8B6CE8"
PURPLE_DEEP = "#6D4AE2"
TEXT = "#3A3749"
MUTED = "#6E6A80"
DIM = "#9B97AB"
LINE = "#E5E0F1"
MARK_BG = "#FAFAFD"
MARK_EDGE = "#E8E4F2"

MARK_PATH = "M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z"

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<rect width="64" height="64" rx="12" fill="{MARK_BG}" stroke="{MARK_EDGE}" stroke-width="2"/>'
    f'<path d="{MARK_PATH}" fill="none" stroke="{PURPLE}" stroke-width="4"/></svg>\n'
)

MARK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<path d="{MARK_PATH}" fill="none" stroke="{PURPLE}" stroke-width="4"/></svg>'
)

FONT_CANDIDATES = [
    os.environ.get("PICKLE_BRAND_FONT", ""),
    "/workspace/tmp-fonts/NotoSansKR-VF.ttf",
    os.path.join(ROOT, "..", "..", "tmp-fonts", "NotoSansKR-VF.ttf"),
    "/usr/share/fonts/truetype/noto/NotoSansKR-VF.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/pickle-hwp/NotoSansMonoCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]

_font_cache: dict = {}
FONT_PATH = next((p for p in FONT_CANDIDATES if p and os.path.exists(p)), None)
MONO_PATH = next((p for p in MONO_CANDIDATES if p and os.path.exists(p)), None)


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    key = ("sans", size, weight)
    if key in _font_cache:
        return _font_cache[key]
    if not FONT_PATH:
        raise SystemExit("한글 폰트를 찾지 못했습니다. --font 로 지정해 주세요.")
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    _font_cache[key] = f
    return f


def mono(size: int) -> ImageFont.FreeTypeFont:
    key = ("mono", size, "Regular")
    if key in _font_cache:
        return _font_cache[key]
    f = ImageFont.truetype(MONO_PATH or FONT_PATH, size)
    _font_cache[key] = f
    return f


def spaced(d, xy, text, f, fill, spacing=0.0, anchor="l"):
    total = sum(d.textlength(ch, font=f) for ch in text) + spacing * max(0, len(text) - 1)
    x = xy[0] - (total / 2 if anchor == "m" else total if anchor == "r" else 0)
    for ch in text:
        d.text((x, xy[1]), ch, font=f, fill=fill, anchor="ls")
        x += d.textlength(ch, font=f) + spacing
    return total


# ── vector rasterisation ────────────────────────────────────────────────────
def render_svg(svg: str, px: int) -> Image.Image:
    if cairosvg is None:
        raise SystemExit("cairosvg 가 필요합니다: pip install cairosvg")
    buf = io.BytesIO()
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=buf,
                     output_width=px, output_height=px)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def render_mark(px: int) -> Image.Image:
    return render_svg(MARK_SVG, px)


# ── icon set ────────────────────────────────────────────────────────────────
def build_icons(out_dir: str):
    with open(os.path.join(out_dir, "favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(FAVICON_SVG)

    master = render_svg(FAVICON_SVG, 1024)
    made = [("favicon.svg", (64, 64))]
    for name, size in [("favicon-32x32.png", 32), ("apple-touch-icon.png", 180),
                       ("icon-192.png", 192), ("icon-512.png", 512)]:
        master.resize((size, size), Image.LANCZOS).save(
            os.path.join(out_dir, name), "PNG", optimize=True)
        made.append((name, (size, size)))

    ico = master.resize((256, 256), Image.LANCZOS).convert("RGBA")
    ico.save(os.path.join(out_dir, "favicon.ico"), format="ICO",
             sizes=[(16, 16), (32, 32), (48, 48)])
    made.append(("favicon.ico", (48, 48)))
    return made


# ── manifest ────────────────────────────────────────────────────────────────
MANIFEST = {
    "name": "HD2Lab CinePlate",
    "short_name": "CinePlate",
    "description": "사진과 영상에 HD2Lab 필름 9종·RETRO 90·Margarine 58종을 입히고, "
                   "Shutterplate 13종 프레임과 합성해 원본 1:1 사진 또는 H.264 + 사운드 "
                   "영상으로 내보내는 브라우저 로컬 스튜디오.",
    "lang": "ko",
    "dir": "ltr",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#0B1020",
    "theme_color": "#0B1020",
    "categories": ["photo", "video", "productivity"],
    "icons": [
        {"src": "favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
        {"src": "favicon-32x32.png", "sizes": "32x32", "type": "image/png", "purpose": "any"},
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "apple-touch-icon.png", "sizes": "180x180", "type": "image/png", "purpose": "any"},
    ],
}


def build_manifest(out_dir: str) -> str:
    path = os.path.join(out_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(MANIFEST, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


# ── OG card ─────────────────────────────────────────────────────────────────
S = 2  # supersampling: draw at 2400×1260, ship 1200×630


def sc(*v):
    return tuple(int(round(x * S)) for x in v)


def rrect(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline,
                        width=max(1, int(round(width))))


def build_og(out_dir: str) -> str:
    W, H = 1200 * S, 630 * S
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 1) Soft Iris grid + white container card
    for x in range(0, W + 1, 40 * S):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H + 1, 40 * S):
        d.line([(0, y), (W, y)], fill=GRID)
    rrect(d, sc(56, 30, 1144, 600), 26 * S, fill=CARD, outline=CARD_BORDER, width=1.4 * S)

    # 2) kicker + privacy mark
    r = 5 * S
    d.ellipse((104 * S - r, 90 * S - r, 104 * S + r, 90 * S + r), fill=PURPLE)
    spaced(d, (124 * S, 96 * S), "04 / STUDIO · CINEPLATE",
           font(14 * S, "Medium"), MUTED, spacing=2.2 * S)
    d.text((1096 * S, 96 * S), "LOCAL ONLY · 0 B UPLOAD", font=mono(13 * S), fill=DIM, anchor="rs")

    # 3) dual-skew mark + HD2Lab | CinePlate
    mark = render_mark(100 * S)
    img.paste(mark, (84 * S, 120 * S), mark)

    base_y = 194
    f_title = font(62 * S, "SemiBold")
    d.text((224 * S, base_y * S), "HD2Lab", font=f_title, fill=INK, anchor="ls")
    pipe_x = 224 * S + d.textlength("HD2Lab", font=f_title) + 18 * S
    d.line([(pipe_x, (base_y - 40) * S), (pipe_x, (base_y + 2) * S)],
           fill="#D9D2EE", width=int(2.5 * S))
    d.text((pipe_x + 20 * S, base_y * S), "CinePlate", font=f_title, fill=PURPLE, anchor="ls")

    # 4) headline + sub copy
    f_head = font(48 * S, "Bold")
    d.text((104 * S, 262 * S), "한 장의 사진도,", font=f_head, fill=INK, anchor="ls")

    lead = "움직이는 클립도 "
    hl = "하나의 플레이트"
    tail = "로."
    x = 104 * S
    d.text((x, 320 * S), lead, font=f_head, fill=INK, anchor="ls")
    x += d.textlength(lead, font=f_head)
    d.text((x, 320 * S), hl, font=f_head, fill=PURPLE_DEEP, anchor="ls")
    x += d.textlength(hl, font=f_head)
    d.text((x, 320 * S), tail, font=f_head, fill=INK, anchor="ls")

    d.text((105 * S, 358 * S),
           "HD2Lab 필름 9종 · RETRO 90 · Margarine 58종과 13종 시그니처 프레임 ·",
           font=font(17.5 * S), fill=MUTED)
    d.text((105 * S, 386 * S),
           "원본 1:1 / H.264 + 사운드 · 100% 로컬 처리",
           font=font(17.5 * S), fill=MUTED)

    # 5) three tiles
    tiles = [
        ("01 / FILMS", "68 필름 룩", ["VAERN · SKELD · RETRO 90", "그리고 Margarine 58종."]),
        ("02 / FRAMES", "13 시그니처 프레임", ["보더 · 노출 스펙 · 엠블럼,", "4컷 멀티 플레이트까지."]),
        ("03 / VIDEO & AUDIO", "H.264 + 사운드", ["클립도 같은 룩으로,", "소리까지 담아 내보냅니다."]),
    ]
    tile_w, gap, th, top = 264, 16, 126, 414
    for i, (kicker, heading, desc) in enumerate(tiles):
        x0 = 96 + i * (tile_w + gap)
        rrect(d, sc(x0, top, x0 + tile_w, top + th), 10 * S,
              fill=TILE, outline=TILE_BORDER, width=1.2 * S)
        d.text(((x0 + 18) * S, (top + 26) * S), kicker,
               font=mono(8.5 * S), fill=PURPLE)
        d.text(((x0 + 18) * S, (top + 54) * S), heading,
               font=font(19 * S, "SemiBold"), fill=INK)
        d.text(((x0 + 18) * S, (top + 81) * S), desc[0], font=font(11.5 * S), fill=MUTED)
        d.text(((x0 + 18) * S, (top + 100) * S), desc[1], font=font(11.5 * S), fill=MUTED)

    # 6) footer rail
    d.line([(104 * S, 566 * S), (1096 * S, 566 * S)], fill=LINE, width=int(1 * S))
    spaced(d, (104 * S, 588 * S), "FILM STUDIO × SHUTTERPLATE · CINEPLATE",
           font(11.5 * S, "Medium"), MUTED, spacing=1.5 * S)
    d.text((1096 * S, 588 * S), "hyangdan2.github.io/PKPilot0011", font=mono(11.5 * S),
           fill=DIM, anchor="rs")

    out = img.resize((1200, 630), Image.LANCZOS)
    path = os.path.join(out_dir, "og-image.png")
    out.save(path, "PNG", optimize=True)
    out.save(os.path.join(out_dir, "social-preview.png"), "PNG", optimize=True)
    return path


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="PKPilot0011 (CinePlate) 브랜드 에셋 생성")
    ap.add_argument("--font")
    ap.add_argument("--out", default=os.path.join(ROOT, "public"))
    args = ap.parse_args()

    global FONT_PATH
    if args.font:
        FONT_PATH = args.font

    os.makedirs(args.out, exist_ok=True)
    icons = build_icons(args.out)
    build_manifest(args.out)
    og = build_og(args.out)

    # public/brand/ keeps the same set the app header already points at.
    brand_dir = os.path.join(args.out, "brand")
    os.makedirs(brand_dir, exist_ok=True)
    for name, _ in icons:
        shutil.copyfile(os.path.join(args.out, name), os.path.join(brand_dir, name))

    print("아이콘")
    for name, size in icons:
        p = os.path.join(args.out, name)
        print(f"  {name:22s} {size[0]}x{size[1]:<4d} {os.path.getsize(p):>8,d} B")
    print("  manifest.json")
    print(f"OG\n  {os.path.basename(og):22s} 1200x630 {os.path.getsize(og):>8,d} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
