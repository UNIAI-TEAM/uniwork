"""Generate every UniWork logo SVG from the parametric mark.

Run: python3 scripts/brand/build-svg.py
Writes packages/ui/brand/svg/*.svg. Nothing in that directory is hand-edited;
change a constant in geometry.py and re-run.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fitcurve as fc
from geometry import Mark, W, H

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "packages", "ui", "brand", "svg")

# The three brand colours, sampled from the original artwork. The bright end is
# capped at Flow Aqua: the original blows out to #7FFFFF, and that highlight is
# what makes the right-hand figure read as larger than the left one at a glance.
BLUE, AZURE, AQUA = "#0044E3", "#00B4FC", "#02DEF5"
# On dark surfaces the light ramp's deep end collapses: #0044E3 measures 2.19:1
# on the dark sidebar, so half the mark disappears and the logo reads lopsided.
# This ramp starts at exactly --brand's dark value, which ties the mark to the
# product colour in the theme where it matters, and clears 4.87:1 on the worst
# dark surface the mark sits on.
BLUE_DARK, AZURE_DARK, AQUA_DARK = "#4D8DFF", "#35CBFF", "#5AF0FF"
# Where the ribbon crosses a figure. Measured flat in the original (#0045E1 on
# the left, #004BDD on the right - the same colour at both ends of the gradient,
# so it is a deliberate shade rather than the gradient showing through).
SHADE = "#0A34C4"
# The same crescent on the dark ramp; the light shade would read as a hole.
SHADE_DARK = "#1B4AD8"


def split_curve(pts):
    """Break a sampled edge at its turning points and inflections, so each piece
    is a simple arc that one or two cubics fit tightly."""
    marks = {0, len(pts) - 1}
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1][1], pts[i][1], pts[i + 1][1]
        if (b - a) * (c - b) <= 0 and b != a:
            marks.add(i)
    turns = sorted(marks)
    for a, b in zip(turns, turns[1:]):
        if b - a > 8:
            marks.add((a + b) // 2)
    idx = sorted(marks)
    return [pts[a:b + 1] for a, b in zip(idx, idx[1:])]


def fit_edge(pts, tol=0.04):
    pieces = split_curve(pts)
    segs = []
    for k, piece in enumerate(pieces):
        horiz_start = k > 0 and abs(piece[0][1] - piece[1][1]) < 1e-4
        horiz_end = k < len(pieces) - 1 and abs(piece[-1][1] - piece[-2][1]) < 1e-4
        segs += fc.fit(piece, tol=tol,
                       t0=(1.0, 0.0) if horiz_start else None,
                       t1=(-1.0, 0.0) if horiz_end else None)
    return segs


def ribbon_path(m: Mark) -> str:
    upper = fit_edge(m.edge(-1))
    lower = fit_edge(m.edge(1))
    lower_rev = [[s[3], s[2], s[1], s[0]] for s in reversed(lower)]
    d = fc.to_path(upper)
    d += f"L{fc.to_path(lower_rev, start=True)[1:].split('C', 1)[0]}"
    d = fc.to_path(upper) + "L" + _n(lower_rev[0][0][0]) + " " + _n(lower_rev[0][0][1])
    d += fc.to_path(lower_rev, start=False) + "Z"
    return d


def _n(v):
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def figures(m: Mark) -> str:
    """Heads and bodies. Plain circles and capsules keep the file editable."""
    bh = m.body_bottom - m.body_top
    return (
        f'<circle cx="{_n(m.left_cx)}" cy="{_n(m.head_r)}" r="{_n(m.head_r)}"/>'
        f'<circle cx="{_n(m.right_cx)}" cy="{_n(m.head_r)}" r="{_n(m.head_r)}"/>'
        f'<rect x="0" y="{_n(m.body_top)}" width="{_n(m.body_w)}" height="{_n(bh)}" rx="{_n(m.body_r)}"/>'
        f'<rect x="{_n(W - m.body_w)}" y="{_n(m.body_top)}" width="{_n(m.body_w)}" height="{_n(bh)}" rx="{_n(m.body_r)}"/>'
    )


def gradient(gid: str, x1=0.0, y1=0.0, x2=W, y2=0.0, *, dark=False) -> str:
    # Horizontal by default: a brightness plane fitted over the original artwork
    # comes out 2 degrees off horizontal, so a diagonal axis would be an
    # invention rather than the logo. The app icon overrides it - a flat tile
    # needs the diagonal to have any depth at all.
    return (f'<linearGradient id="{gid}" x1="{_n(x1)}" y1="{_n(y1)}" x2="{_n(x2)}" y2="{_n(y2)}" '
            f'gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{BLUE_DARK if dark else BLUE}"/>'
            f'<stop offset=".52" stop-color="{AZURE_DARK if dark else AZURE}"/>'
            f'<stop offset="1" stop-color="{AQUA_DARK if dark else AQUA}"/>'
            f'</linearGradient>')


def svg(body: str, *, w=W, h=H, extra="") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_n(w)} {_n(h)}" '
            f'fill="none"{extra}>{body}</svg>\n')


def mark_svg(m: Mark, *, uid: str, shaded: bool, dark: bool = False) -> str:
    rib = ribbon_path(m)
    figs = figures(m)
    defs = gradient(f"{uid}g", dark=dark)
    if shaded:
        defs += f'<clipPath id="{uid}c">{figs}</clipPath>'
    body = f'<defs>{defs}</defs>'
    body += f'<g fill="url(#{uid}g)">{figs}<path d="{rib}"/></g>'
    if shaded:
        # The ribbon crosses in front of both figures; the overlap is the one
        # place the mark shows depth.
        body += (f'<g clip-path="url(#{uid}c)"><path d="{rib}" '
                 f'fill="{SHADE_DARK if dark else SHADE}" opacity=".45"/></g>')
    return svg(body)


def flat_svg(m: Mark, colour: str) -> str:
    return svg(f'<g fill="{colour}">{figures(m)}<path d="{ribbon_path(m)}"/></g>')


def app_icon(m: Mark, uid="a", *, size=1024, glyph=0.66) -> str:
    """Square tile, FULL BLEED: white mark on the brand gradient.

    No corner radius and no transparency, ever. Every platform masks this file
    itself - iOS with its superellipse, Android launchers with whatever shape
    the theme uses - and the App Store rejects an icon with an alpha channel. A
    pre-rounded tile shows the mask's own corners as wedges of whatever sits
    outside the radius; rendered on white, that is four white notches on the
    home screen.

    No depth shading either. The overlap crescent is a mid-size detail; on a
    home screen the tile is ~40pt and a two-tone white mark just muddies.

    `glyph` is the fraction of the tile's width the mark spans. The maskable
    variant shrinks it so the whole mark clears Android's 80% safe circle.
    """
    s = float(size)
    k = s * glyph / W
    tx, ty = (s - W * k) / 2, (s - H * k) / 2
    body = (f'<defs>{gradient(uid + "g", 0, s, s, 0)}</defs>'
            f'<rect width="{_n(s)}" height="{_n(s)}" fill="url(#{uid}g)"/>'
            f'<g transform="translate({_n(tx)} {_n(ty)}) scale({_n(k)})" fill="#fff">'
            f'{figures(m)}<path d="{ribbon_path(m)}"/></g>')
    return svg(body, w=s, h=s)


def art_ts(full: Mark, compact: Mark) -> str:
    """Emit the mark's geometry as typed data.

    logo.tsx builds the SVG in JSX rather than inlining a string: the gradient
    needs a per-instance id (two logos on one page would otherwise share one
    <defs> id) and the mono tone needs to inherit currentColor. Both are
    impossible through dangerouslySetInnerHTML.
    """
    def art(m: Mark, depth: bool) -> str:
        bh = m.body_bottom - m.body_top
        return (
            "{\n"
            f'    viewBox: "0 0 {_n(W)} {_n(H)}",\n'
            f"    width: {_n(W)},\n    height: {_n(H)},\n"
            f"    heads: [\n"
            f"      {{ cx: {_n(m.left_cx)}, cy: {_n(m.head_r)}, r: {_n(m.head_r)} }},\n"
            f"      {{ cx: {_n(m.right_cx)}, cy: {_n(m.head_r)}, r: {_n(m.head_r)} }},\n"
            f"    ],\n"
            f"    bodies: [\n"
            f"      {{ x: 0, y: {_n(m.body_top)}, width: {_n(m.body_w)}, "
            f"height: {_n(bh)}, rx: {_n(m.body_r)} }},\n"
            f"      {{ x: {_n(W - m.body_w)}, y: {_n(m.body_top)}, width: {_n(m.body_w)}, "
            f"height: {_n(bh)}, rx: {_n(m.body_r)} }},\n"
            f"    ],\n"
            f'    ribbon:\n      "{ribbon_path(m)}",\n'
            f"    depth: {'true' if depth else 'false'},\n"
            "  }"
        )

    return (
        "// Generated by scripts/brand/build-svg.py. Do not edit.\n"
        "// Run `pnpm brand:build` after changing scripts/brand/geometry.py.\n\n"
        "export type MarkArt = {\n"
        "  readonly viewBox: string;\n"
        "  readonly width: number;\n"
        "  readonly height: number;\n"
        "  readonly heads: readonly { readonly cx: number; readonly cy: number; readonly r: number }[];\n"
        "  readonly bodies: readonly {\n"
        "    readonly x: number;\n    readonly y: number;\n    readonly width: number;\n"
        "    readonly height: number;\n    readonly rx: number;\n  }[];\n"
        "  readonly ribbon: string;\n"
        "  /** Whether the ribbon-over-figure crescent is drawn. Off below 24px:\n"
        "   *  at that size it is one dark pixel row, not depth. */\n"
        "  readonly depth: boolean;\n};\n\n"
        "/** Deep blue, signal azure, flow aqua: the gradient the mark is drawn in,\n"
        " *  paired with its on-dark ramp. Deliberately NOT a CSS token - the mark is\n"
        " *  the only place a gradient is allowed, and a token would invite it onto\n"
        " *  card backgrounds. The dark ramp exists because the light one's deep end\n"
        " *  measures 2.19:1 on the dark sidebar, which erases the left-hand figure.\n"
        " *\n"
        " *  Each `className` is spelled out rather than composed: Tailwind extracts\n"
        " *  class candidates by scanning source text, so a template literal built\n"
        " *  from these hexes would generate no CSS at all. */\n"
        "export const BRAND_GRADIENT = [\n"
        f'  {{ offset: "0", className: "[stop-color:{BLUE}] dark:[stop-color:{BLUE_DARK}]" }},\n'
        f'  {{ offset: ".52", className: "[stop-color:{AZURE}] dark:[stop-color:{AZURE_DARK}]" }},\n'
        f'  {{ offset: "1", className: "[stop-color:{AQUA}] dark:[stop-color:{AQUA_DARK}]" }},\n'
        "] as const;\n\n"
        f'/** Where the ribbon crosses a figure. */\n'
        f'export const MARK_SHADE_CLASS = "[fill:{SHADE}] dark:[fill:{SHADE_DARK}]";\n\n'
        f"export const MARK: MarkArt = {art(full, True)};\n\n"
        "/** 16-24px: wider head gap, thicker band, shallower wave, no depth shade. */\n"
        f"export const MARK_COMPACT: MarkArt = {art(compact, False)};\n\n"
        "/** Below this the full mark loses its head gap; Logo swaps in MARK_COMPACT. */\n"
        "export const COMPACT_MAX_SIZE = 24;\n"
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    full = Mark()
    # Compact: wider head gap, thicker band, shallower wave, no depth shading -
    # everything that turns to mush below 24px is removed rather than shrunk.
    compact = Mark(head_gap=4.6, ribbon_t=24.0, amp=9.4, body_bottom=78.0)

    files = {
        "mark.svg": mark_svg(full, uid="m", shaded=True),
        # For decks, slides and print laid out on a dark ground. In the product
        # <Logo> swaps ramps by itself; this file exists for everything outside it.
        "mark-dark.svg": mark_svg(full, uid="d", shaded=True, dark=True),
        "mark-compact.svg": mark_svg(compact, uid="k", shaded=False),
        "mark-flat.svg": flat_svg(full, "currentColor").replace(
            "currentColor", "var(--brand, #0B5BF5)"),
        "mark-mono.svg": flat_svg(full, "currentColor"),
        "app-icon.svg": app_icon(full),
        # Maskable: glyph pulled well inside Android's 80% safe circle. Half the
        # mark's diagonal at this scale is 0.32 of the tile against a 0.40 radius.
        "app-icon-maskable.svg": app_icon(full, uid="b", glyph=0.52),
    }
    for m, label in ((full, "mark"), (compact, "compact")):
        margin = m.cusp_margin()
        if margin < 3.0:
            raise SystemExit(f"{label}: cusp margin {margin:.2f} is too tight - "
                             "the wave extrema will read as points")
        print(f"{label:22s} cusp margin {margin:.2f}")

    for name, content in files.items():
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(content)
        print(f"{name:22s} {len(content):6d} bytes")

    ts = os.path.join(OUT, "..", "mark.generated.ts")
    with open(ts, "w") as fh:
        fh.write(art_ts(full, compact))
    print(f"{'mark.generated.ts':22s} {os.path.getsize(ts):6d} bytes")


if __name__ == "__main__":
    main()
