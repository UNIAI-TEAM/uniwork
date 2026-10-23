"""Outline the UniWork wordmark and the lockups.

The wordmark is "uni", the mark, "ork": the mark stands in for the w. The
letters are Plus Jakarta Sans ExtraBold (the product's display face), lower
case, converted to paths so the SVG does not depend on a font being available
wherever it renders (favicons, OG images, e-mail, print). Glyph positions come
from measure-text.mjs, which lets the browser do the OpenType shaping rather
than reimplementing kerning here.

The mark is sized off the letters, not eyeballed: its top sits on the
ascender of the k, its bottom on the baseline less the round letters'
overshoot, so it stands exactly as tall as the tallest letter beside it. The
space either side of it is the letters' own sidebearings plus one fixed gap,
so it reads as a letter of the word rather than an icon placed next to one.

Usage:
  node scripts/brand/measure-text.mjs <PlusJakartaSans.ttf> uni 0 > /tmp/uni.json
  node scripts/brand/measure-text.mjs <PlusJakartaSans.ttf> ork 0 > /tmp/ork.json
  python3 scripts/brand/build-wordmark.py <PlusJakartaSans.ttf> /tmp/uni.json /tmp/ork.json

A variable font is accepted: it is instanced at WEIGHT first.
"""

import json
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geometry import Mark, W as MARK_W, H as MARK_H

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "packages", "ui", "brand", "svg")

WEIGHT = 800
# Extra space either side of the mark, in font units, on top of the letters'
# own sidebearings. Measured against the reference artwork at 40px and 120px.
MARK_GAP = 24
# Stacked lockup: the word runs 1.5 marks wide under the mark.
STACK_WORD_W = MARK_W * 1.5


def _n(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _s(v):
    """Scale factors, not coordinates: two decimals would visibly resize."""
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def load_font(path):
    font = TTFont(path)
    if "fvar" in font:
        from fontTools.varLib import instancer
        font = instancer.instantiateVariableFont(font, {"wght": WEIGHT})
    return font


def glyph_path(ops, scale, dx, dy):
    """Font units (y up) to SVG user units (y down)."""
    def pt(p):
        return f"{_n(dx + p[0] * scale)} {_n(dy - p[1] * scale)}"

    d = []
    for op, args in ops:
        if op == "moveTo":
            d.append("M" + pt(args[0]))
        elif op == "lineTo":
            d.append("L" + pt(args[0]))
        elif op == "curveTo":
            d.append("C" + " ".join(pt(p) for p in args))
        elif op == "qCurveTo":
            pts = list(args)
            last_on = pts[-1]
            offs = pts[:-1]
            for j, c in enumerate(offs):
                if j + 1 < len(offs):
                    mid = ((c[0] + offs[j + 1][0]) / 2, (c[1] + offs[j + 1][1]) / 2)
                else:
                    mid = last_on
                d.append("Q" + pt(c) + " " + pt(mid))
        elif op == "closePath":
            d.append("Z")
    return "".join(d)


def build(font, uni, ork):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    def glyph(ch):
        return gs[cmap[ord(ch)]]

    def bounds(ch):
        pen = BoundsPen(gs)
        glyph(ch).draw(pen)
        return pen.bounds

    def outline(ch):
        # Decomposing: 'i' is a composite of dotlessi + dot.
        pen = DecomposingRecordingPen(gs)
        glyph(ch).draw(pen)
        return pen.value

    top = bounds("k")[3]
    bottom = min(bounds("o")[1], bounds("u")[1])  # overshoot of the rounds
    em_h = top - bottom
    # Output space: the mark at its native 92 units tall, so the lockup needs
    # no scale on the mark and the letters take one factor.
    k = MARK_H / em_h
    mark_w_em = MARK_W / k

    uni_x = [x - uni["left"] for x in uni["x"]]
    i_rsb = hmtx[cmap[ord("i")]][0] - bounds("i")[2]
    uni_end = uni_x[-1] + hmtx[cmap[ord("i")]][0]
    mark_x_em = uni_end - i_rsb + MARK_GAP
    ork_start = mark_x_em + mark_w_em + MARK_GAP - bounds("o")[0]
    ork_x = [ork_start + x - ork["left"] for x in ork["x"]]

    left = bounds("u")[0]
    placed = list(zip("uni", uni_x)) + list(zip("ork", ork_x))
    right = ork_x[-1] + bounds("k")[2]

    d = "".join(glyph_path(outline(ch), k, (x - left) * k, top * k) for ch, x in placed)
    width = (right - left) * k
    return {
        "path": d,
        "width": width,
        "height": MARK_H,
        "markX": (mark_x_em - left) * k,
    }


def inline_svg(word, mark_inner, letters_fill="currentColor"):
    return (f'<g transform="translate({_n(word["markX"])} 0)">{mark_inner}</g>'
            f'<path d="{word["path"]}" fill="{letters_fill}"/>')


def stacked_layout(word):
    ws = STACK_WORD_W / word["width"]
    gap = Mark().head_r * 0.75
    return {
        "width": STACK_WORD_W,
        "height": MARK_H + gap + word["height"] * ws,
        "markX": (STACK_WORD_W - MARK_W) / 2,
        "wordX": 0,
        "wordY": MARK_H + gap,
        "wordScale": ws,
    }


def svgs(word, mark_inner, mono_inner):
    vb = f'0 0 {_n(word["width"])} {_n(word["height"])}'
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" fill="none">'
    lockup = head + inline_svg(word, mark_inner) + "</svg>\n"
    mono = head + inline_svg(word, mono_inner) + "</svg>\n"

    st = stacked_layout(word)
    stacked = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(st["width"])} {_n(st["height"])}" '
               f'fill="none"><g transform="translate({_n(st["markX"])} 0)">{mark_inner}</g>'
               f'<g transform="translate({_n(st["wordX"])} {_n(st["wordY"])}) scale({_s(st["wordScale"])})">'
               + inline_svg(word, mark_inner) + "</g></svg>\n")
    return {
        # The standalone wordmark is single-ink: letters and mark both take
        # the text colour.
        "wordmark.svg": mono,
        "lockup-horizontal.svg": lockup,
        "lockup-horizontal-mono.svg": mono,
        "lockup-stacked.svg": stacked,
    }


def art_ts(word):
    st = stacked_layout(word)
    return (
        "// Generated by scripts/brand/build-wordmark.py. Do not edit.\n"
        "// Run `pnpm brand:build` (needs Plus Jakarta Sans; see brand/README.md).\n\n"
        "export type Lockup = {\n"
        "  readonly width: number;\n  readonly height: number;\n"
        "  readonly markX: number;\n  readonly wordX: number;\n"
        "  readonly wordY: number;\n  readonly wordScale: number;\n};\n\n"
        "/** \"uni\" + the mark + \"ork\": Plus Jakarta Sans ExtraBold, lower case,\n"
        " *  outlined. `path` is the six letters; the mark stands in for the w at\n"
        " *  `markX`, at its native 128x92, top on the k's ascender and bottom on\n"
        " *  the baseline. */\n"
        "export const WORDMARK = {\n"
        f'  viewBox: "0 0 {_n(word["width"])} {_n(word["height"])}",\n'
        f'  width: {_n(word["width"])},\n  height: {_n(word["height"])},\n'
        f'  markX: {_n(word["markX"])},\n'
        f'  path:\n    "{word["path"]}",\n'
        "} as const;\n\n"
        "/** The mark centred above the wordmark, the word 1.5 marks wide. */\n"
        "export const LOCKUP_STACKED: Lockup = {\n"
        f'  width: {_n(st["width"])},\n  height: {_n(st["height"])},\n'
        f'  markX: {_n(st["markX"])},\n  wordX: {_n(st["wordX"])},\n'
        f'  wordY: {_n(st["wordY"])},\n  wordScale: {_s(st["wordScale"])},\n'
        "};\n"
    )


def main():
    font_path, uni_path, ork_path = sys.argv[1], sys.argv[2], sys.argv[3]
    font = load_font(font_path)
    word = build(font, json.load(open(uni_path)), json.load(open(ork_path)))

    def inner(name):
        s = open(os.path.join(OUT, name)).read()
        return s.split(">", 1)[1].rsplit("</svg>", 1)[0]

    for name, content in svgs(word, inner("mark.svg"), inner("mark-mono.svg")).items():
        open(os.path.join(OUT, name), "w").write(content)
        print(f"{name:28s} {len(content):6d} bytes")

    ts = os.path.join(OUT, "..", "wordmark.generated.ts")
    open(ts, "w").write(art_ts(word))
    print(f"{'wordmark.generated.ts':28s} {os.path.getsize(ts):6d} bytes")


if __name__ == "__main__":
    main()
