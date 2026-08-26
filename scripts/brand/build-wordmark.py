"""Outline the UniWork wordmark and the lockups.

The wordmark is Inter SemiBold at -2% tracking, converted to paths so the SVG
does not depend on a font being available wherever it renders (favicons, OG
images, e-mail, print). Glyph positions come from measure-text.mjs, which lets
the browser do the OpenType shaping rather than reimplementing kerning here.

One glyph is not Inter's: the W's two V-bottoms are rounded, so the letter's
feet echo the valleys of the mark's wave. Everything else is the typeface as
drawn - a wordmark that quietly redraws a whole alphabet is a worse wordmark.

Usage:
  node scripts/brand/measure-text.mjs <Inter-SemiBold.ttf> UniWork -0.02 > /tmp/m.json
  python3 scripts/brand/build-wordmark.py <Inter-SemiBold.ttf> /tmp/m.json
"""

import json
import os
import subprocess
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geometry import Mark, W as MARK_W, H as MARK_H

TEXT = "UniWork"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "packages", "ui", "brand", "svg")

# Fraction of the apex tangent used as the fillet handle. 0.62 rounds the V
# bottoms enough to read at 24px without softening the letter into a different
# typeface.
FILLET = 0.62


def _n(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _s(v):
    """Scale factors, not coordinates. Two decimals would round 0.0619 to 0.06
    and shrink the wordmark by 3% inside every lockup."""
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def round_apexes(ops):
    """Replace the W's two flat V-bottoms with tangent-continuous fillets.

    Inter cuts a very acute apex with a short backwards flat (it travels right
    to left between the two strokes). That flat is the anchor: the incoming and
    outgoing stroke tangents either side of it define a cubic that bulges below
    the old baseline of the flat and lands smoothly on both strokes.
    """
    out = []
    for i, (op, args) in enumerate(ops):
        if (op == "lineTo" and i > 0 and i + 1 < len(ops)
                and ops[i - 1][0] == "qCurveTo" and ops[i + 1][0] == "qCurveTo"):
            p0 = ops[i - 1][1][-1]
            p3 = args[0]
            if abs(p0[1] - p3[1]) < 1 and p3[0] < p0[0] and p0[1] < 400:
                ctrl_in = ops[i - 1][1][-2]
                ctrl_out = ops[i + 1][1][0]
                t_in = (p0[0] - ctrl_in[0], p0[1] - ctrl_in[1])
                t_out = (ctrl_out[0] - p3[0], ctrl_out[1] - p3[1])
                c1 = (p0[0] + FILLET * t_in[0], p0[1] + FILLET * t_in[1])
                c2 = (p3[0] - FILLET * t_out[0], p3[1] - FILLET * t_out[1])
                out.append(("curveTo", [c1, c2, p3]))
                continue
        out.append((op, args))
    return out


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
            # TrueType: consecutive off-curve points imply an on-curve midpoint.
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


def bbox(ops_list):
    xs, ys = [], []
    for ops in ops_list:
        for op, args in ops:
            for p in args or []:
                xs.append(p[0]); ys.append(p[1])
    return min(xs), min(ys), max(xs), max(ys)


def build(font_path, measure):
    font = TTFont(font_path)
    upem = font["head"].unitsPerEm
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    size = measure["size"]
    scale = size / upem

    placed = []
    for ch, x in zip(TEXT, measure["x"]):
        # Decomposing: 'i' is a composite of dotlessi + dot, and a plain
        # recording pen would hand back component references, not outlines.
        pen = DecomposingRecordingPen(gs)
        gs[cmap[ord(ch)]].draw(pen)
        ops = round_apexes(pen.value) if ch == "W" else pen.value
        placed.append((ops, x))

    # Ink box in output units, so the file's viewBox is the wordmark itself.
    xs, ys = [], []
    for ops, x in placed:
        for op, args in ops:
            for p in args or []:
                xs.append(x + p[0] * scale)
                ys.append(p[1] * scale)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = x1 - x0, y1 - y0

    d = "".join(glyph_path(ops, scale, x - x0, y1) for ops, x in placed)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(w)} {_n(h)}" '
           f'fill="currentColor"><path d="{d}"/></svg>\n')
    return svg, w, h


def lockups(word_svg, word_w, word_h):
    """Mark + wordmark. The wordmark is set to the cap height of the mark's
    body, and the gap is one head radius - both derived from the mark rather
    than eyeballed, so the lockup rebuilds correctly if the mark changes."""
    m = Mark()
    inner = word_svg.split("><path", 1)[1]
    word_d = inner.split('d="', 1)[1].split('"', 1)[0]

    # Horizontal: the wordmark's ink height is 52% of the mark's, and the gap is
    # the head diameter. Both are read off the mark, so the lockup re-derives
    # itself if the mark's proportions ever change.
    wh = MARK_H * 0.52
    k = wh / word_h
    gap = m.head_r * 1.5
    total_w = MARK_W + gap + word_w * k
    ty = (MARK_H - wh) / 2
    horiz = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(total_w)} {_n(MARK_H)}" '
             f'fill="none"><g>__MARK__</g>'
             f'<g transform="translate({_n(MARK_W + gap)} {_n(ty)}) scale({_s(k)})" '
             f'fill="currentColor"><path d="{word_d}"/></g></svg>\n')

    # Stacked: size by WIDTH, not height - the wordmark is 5.4x as wide as it is
    # tall, so matching heights would make it overhang the mark by 60%.
    ww2 = MARK_W
    k2 = ww2 / word_w
    wh2 = word_h * k2
    gap2 = m.head_r * 0.75
    total_w2 = max(MARK_W, ww2)
    total_h2 = MARK_H + gap2 + wh2
    stacked = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(total_w2)} {_n(total_h2)}" '
               f'fill="none"><g transform="translate({_n((total_w2 - MARK_W) / 2)} 0)">__MARK__</g>'
               f'<g transform="translate({_n((total_w2 - ww2) / 2)} {_n(MARK_H + gap2)}) scale({_s(k2)})" '
               f'fill="currentColor"><path d="{word_d}"/></g></svg>\n')
    return horiz, stacked


def art_ts(word_d, word_w, word_h):
    """Emit the wordmark outline and both lockup layouts as typed data.

    The layout numbers live here rather than in logo.tsx so the SVG files and
    the React component cannot drift: one generator, two outputs.
    """
    m = Mark()
    wh = MARK_H * 0.52
    k = wh / word_h
    gap = m.head_r * 1.5
    h_total = MARK_W + gap + word_w * k

    ww2 = MARK_W
    k2 = ww2 / word_w
    wh2 = word_h * k2
    gap2 = m.head_r * 0.75

    return (
        "// Generated by scripts/brand/build-wordmark.py. Do not edit.\n"
        "// Run `pnpm brand:build` (needs Inter SemiBold; see brand/README.md).\n\n"
        "export type Lockup = {\n"
        "  readonly width: number;\n  readonly height: number;\n"
        "  readonly markX: number;\n  readonly wordX: number;\n"
        "  readonly wordY: number;\n  readonly wordScale: number;\n};\n\n"
        "/** Inter SemiBold, -2% tracking, outlined. The W's two V-bottoms are\n"
        " *  filleted so the letter's feet echo the valleys of the mark's wave. */\n"
        "export const WORDMARK = {\n"
        f'  viewBox: "0 0 {_n(word_w)} {_n(word_h)}",\n'
        f"  width: {_n(word_w)},\n  height: {_n(word_h)},\n"
        f'  path:\n    "{word_d}",\n'
        "} as const;\n\n"
        "export const LOCKUP_HORIZONTAL: Lockup = {\n"
        f"  width: {_n(h_total)},\n  height: {_n(MARK_H)},\n"
        f"  markX: 0,\n  wordX: {_n(MARK_W + gap)},\n"
        f"  wordY: {_n((MARK_H - wh) / 2)},\n  wordScale: {_s(k)},\n"
        "};\n\n"
        "export const LOCKUP_STACKED: Lockup = {\n"
        f"  width: {_n(ww2)},\n  height: {_n(MARK_H + gap2 + wh2)},\n"
        f"  markX: 0,\n  wordX: 0,\n"
        f"  wordY: {_n(MARK_H + gap2)},\n  wordScale: {_s(k2)},\n"
        "};\n"
    )


def main():
    font_path, measure_path = sys.argv[1], sys.argv[2]
    measure = json.load(open(measure_path))
    word_svg, w, h = build(font_path, measure)
    horiz, stacked = lockups(word_svg, w, h)

    mark_inner = open(os.path.join(OUT, "mark.svg")).read()
    mark_inner = mark_inner.split(">", 1)[1].rsplit("</svg>", 1)[0]
    mono_inner = open(os.path.join(OUT, "mark-mono.svg")).read()
    mono_inner = mono_inner.split(">", 1)[1].rsplit("</svg>", 1)[0]

    files = {
        "wordmark.svg": word_svg,
        "lockup-horizontal.svg": horiz.replace("__MARK__", mark_inner),
        "lockup-stacked.svg": stacked.replace("__MARK__", mark_inner),
        "lockup-horizontal-mono.svg": horiz.replace("__MARK__", mono_inner),
    }
    for name, content in files.items():
        open(os.path.join(OUT, name), "w").write(content)
        print(f"{name:28s} {len(content):6d} bytes")

    word_d = word_svg.split('d="', 1)[1].split('"', 1)[0]
    ts = os.path.join(OUT, "..", "wordmark.generated.ts")
    open(ts, "w").write(art_ts(word_d, w, h))
    print(f"{'wordmark.generated.ts':28s} {os.path.getsize(ts):6d} bytes")


if __name__ == "__main__":
    main()
