"""Mark geometry for the UniWork logo.

The mark is rebuilt parametrically rather than traced, so every proportion is a
named number that can be re-derived. Measurements of the original raster live in
docs/superpowers/specs/2026-08-26-brand-identity-design.md; the constants below
are those measurements scaled to a 128x92 grid, plus the craft corrections the
spec lists.

The ribbon is a constant-PERPENDICULAR-thickness band around a raised-cosine
centreline. The original measures that way: its vertical span grows on the
slopes by exactly 1/cos of the slope angle (154px at the crest, 224px where the
slope hits 46 degrees). A perpendicular offset of a cosine is not itself a
cosine, so the two edges are sampled numerically and fitted with cubic Beziers.
"""

import math

W, H = 128.0, 92.0
AXIS = W / 2


class Mark:
    """One parameterisation of the mark. `compact` trades detail for legibility."""

    def __init__(self, *, body_w=30.0, head_r=14.0, head_gap=3.5, body_bottom=79.0,
                 ribbon_t=22.0, valley_x=24.0, amp=10.6):
        self.body_w = body_w
        self.head_r = head_r
        self.head_gap = head_gap
        self.body_top = 2 * head_r + head_gap
        self.body_bottom = body_bottom
        self.body_r = body_w / 2
        self.left_cx = body_w / 2
        self.right_cx = W - body_w / 2

        self.ribbon_t = ribbon_t
        self.valley_x = valley_x
        self.half_period = AXIS - valley_x
        self.amp = amp
        # The valley's lower edge lands exactly on the grid floor.
        self.valley_y = H - ribbon_t / 2
        self.mid_y = self.valley_y - amp

    def cusp_margin(self):
        """Clearance between the inner offset and the cusp. Must stay positive;
        below ~3 the extrema read as points rather than curves."""
        radius = self.half_period ** 2 / (math.pi ** 2 * self.amp)
        return radius - self.ribbon_t / 2

    def centre(self, x):
        return self.mid_y + self.amp * math.cos(math.pi * (x - self.valley_x) / self.half_period)

    def slope(self, x):
        return (-self.amp * math.sin(math.pi * (x - self.valley_x) / self.half_period)
                * math.pi / self.half_period)

    def edge_point(self, x, side):
        """side = -1 upper edge, +1 lower edge. Offset along the true normal."""
        m = self.slope(x)
        n = math.hypot(1.0, m)
        return (x - side * m / n * self.ribbon_t / 2,
                self.centre(x) + side * (1.0 / n) * self.ribbon_t / 2)

    def edge(self, side, n=1200):
        """Sampled edge, trimmed to the [0, W] grid so the ribbon ends flush with
        the outer silhouette of the two figures."""
        pts = [self.edge_point(-20 + (W + 40) * i / n, side) for i in range(n + 1)]
        return _trim_x(pts, 0.0, W)


def _trim_x(pts, lo, hi):
    out = []
    for i, p in enumerate(pts):
        if lo <= p[0] <= hi:
            if not out and i > 0:
                out.append(_interp_x(pts[i - 1], p, lo))
            out.append(p)
        elif out:
            out.append(_interp_x(pts[i - 1], p, hi))
            break
    return out


def _interp_x(a, b, x):
    t = (x - a[0]) / (b[0] - a[0])
    return (x, a[1] + (b[1] - a[1]) * t)
