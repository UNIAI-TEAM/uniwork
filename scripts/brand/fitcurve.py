"""Fit a sampled polyline with cubic Beziers.

Classic chord-length parameterisation + least squares for the two inner control
points, then adaptive subdivision at the worst point. The mark's ribbon edges
are normal offsets of a cosine, which have no closed form, so the SVG path data
is produced here rather than written by hand. Tolerance is in grid units on a
128-wide grid; 0.01 is a hundredth of a unit, far below what any renderer shows.
"""

import math


def _sub(a, b): return (a[0] - b[0], a[1] - b[1])
def _add(a, b): return (a[0] + b[0], a[1] + b[1])
def _mul(a, s): return (a[0] * s, a[1] * s)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1]


def _unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n else (0.0, 0.0)


def _bezier(c, t):
    mt = 1 - t
    return (mt ** 3 * c[0][0] + 3 * mt * mt * t * c[1][0] + 3 * mt * t * t * c[2][0] + t ** 3 * c[3][0],
            mt ** 3 * c[0][1] + 3 * mt * mt * t * c[1][1] + 3 * mt * t * t * c[2][1] + t ** 3 * c[3][1])


def _chord_params(pts):
    d = [0.0]
    for i in range(1, len(pts)):
        d.append(d[-1] + math.hypot(*_sub(pts[i], pts[i - 1])))
    total = d[-1] or 1.0
    return [v / total for v in d]


def _fit_one(pts, u, t0, t1):
    p0, p3 = pts[0], pts[-1]
    c11 = c12 = c22 = x1 = x2 = 0.0
    for p, t in zip(pts, u):
        mt = 1 - t
        b0, b1, b2, b3 = mt ** 3, 3 * mt * mt * t, 3 * mt * t * t, t ** 3
        a1, a2 = _mul(t0, b1), _mul(t1, b2)
        c11 += _dot(a1, a1); c12 += _dot(a1, a2); c22 += _dot(a2, a2)
        tmp = _sub(p, _add(_mul(p0, b0 + b1), _mul(p3, b2 + b3)))
        x1 += _dot(a1, tmp); x2 += _dot(a2, tmp)
    det = c11 * c22 - c12 * c12
    if abs(det) < 1e-12:
        seg = math.hypot(*_sub(p3, p0)) / 3
        alpha1 = alpha2 = seg
    else:
        alpha1 = (x1 * c22 - x2 * c12) / det
        alpha2 = (c11 * x2 - c12 * x1) / det
        seg = math.hypot(*_sub(p3, p0))
        if alpha1 < 1e-6 or alpha2 < 1e-6:
            alpha1 = alpha2 = seg / 3
    return [p0, _add(p0, _mul(t0, alpha1)), _add(p3, _mul(t1, alpha2)), p3]


def _deriv1(c, t):
    mt = 1 - t
    return (3 * mt * mt * (c[1][0] - c[0][0]) + 6 * mt * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]),
            3 * mt * mt * (c[1][1] - c[0][1]) + 6 * mt * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]))


def _deriv2(c, t):
    mt = 1 - t
    return (6 * mt * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]),
            6 * mt * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1]))


def _reparam(pts, u, c):
    """Newton-Raphson pull of each parameter onto its true foot point.

    Without this the error is measured at chord-length parameters, which are off
    by enough on a curved offset that the fitter subdivides four times more than
    the geometry needs (22 segments instead of 6 for the same tolerance)."""
    out = []
    for p, t in zip(pts, u):
        d = _sub(_bezier(c, t), p)
        d1 = _deriv1(c, t)
        d2 = _deriv2(c, t)
        den = _dot(d1, d1) + _dot(d, d2)
        nt = t if abs(den) < 1e-12 else t - _dot(d, d1) / den
        out.append(min(1.0, max(0.0, nt)))
    return out


def _max_error(pts, u, c):
    worst, at = 0.0, len(pts) // 2
    for i, (p, t) in enumerate(zip(pts, u)):
        e = math.hypot(*_sub(_bezier(c, t), p))
        if e > worst:
            worst, at = e, i
    return worst, at


def fit(pts, tol=0.01, t0=None, t1=None, depth=0):
    """Return a list of cubic segments [p0, c1, c2, p3]."""
    if len(pts) < 3:
        p0, p3 = pts[0], pts[-1]
        d = _mul(_sub(p3, p0), 1 / 3)
        return [[p0, _add(p0, d), _sub(p3, d), p3]]
    t0 = t0 or _unit(_sub(pts[1], pts[0]))
    t1 = t1 or _unit(_sub(pts[-2], pts[-1]))
    u = _chord_params(pts)
    c = _fit_one(pts, u, t0, t1)
    for _ in range(4):
        u = _reparam(pts, u, c)
        c = _fit_one(pts, u, t0, t1)
    err, at = _max_error(pts, u, c)
    if err <= tol or depth > 12:
        return [c]
    at = min(max(at, 1), len(pts) - 2)
    centre = _unit(_sub(pts[at + 1], pts[at - 1]))
    left = fit(pts[:at + 1], tol, t0, _mul(centre, -1), depth + 1)
    right = fit(pts[at:], tol, centre, t1, depth + 1)
    return left + right


def to_path(segments, *, close=False, start=True, prec=3):
    def n(v):
        s = f"{v:.{prec}f}".rstrip("0").rstrip(".")
        return "0" if s in ("-0", "") else s
    out = []
    if start:
        out.append(f"M{n(segments[0][0][0])} {n(segments[0][0][1])}")
    for _, c1, c2, p3 in segments:
        out.append(f"C{n(c1[0])} {n(c1[1])} {n(c2[0])} {n(c2[1])} {n(p3[0])} {n(p3[1])}")
    if close:
        out.append("Z")
    return "".join(out)
