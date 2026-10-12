# usage: pixdiff.py a.pdf b.pdf workdir  -> JSON per-page % pixels differing (gray, |d|>32) at 96 dpi
import subprocess, sys, os, json, glob
a, b, wd = sys.argv[1:4]; os.makedirs(wd, exist_ok=True)
def rast(pdf, pre):
    subprocess.run(['pdftoppm', '-gray', '-r', '96', pdf, os.path.join(wd, pre)], check=True)
    return sorted(glob.glob(os.path.join(wd, pre + '*.pgm')))
def load(p):
    d = open(p, 'rb').read(); parts = d.split(b'\n', 3)
    w, h = map(int, parts[1].split()); return w, h, parts[3]
pa, pb = rast(a, 'a'), rast(b, 'b'); pages = []
for x, y in zip(pa, pb):
    wa, ha, da = load(x); wb, hb, db = load(y)
    if abs(wa - wb) > 2 or abs(ha - hb) > 2: pages.append({'size_mismatch': [wa, ha, wb, hb]}); continue
    w, h = min(wa, wb), min(ha, hb)
    if (wa, ha) != (wb, hb):
        da = b''.join(da[r*wa:r*wa+w] for r in range(h)); db = b''.join(db[r*wb:r*wb+w] for r in range(h))
    diff = sum(1 for i in range(0, len(da)) if abs(da[i] - db[i]) > 32)
    ink = sum(1 for v in da if v < 200)
    pages.append({'diff_pct': round(100 * diff / len(da), 3), 'diff_px': diff, 'ink_px': ink})
print(json.dumps({'pages_a': len(pa), 'pages_b': len(pb), 'max_diff_pct': max((p.get('diff_pct', 100) for p in pages), default=0), 'mean_diff_pct': round(sum(p.get('diff_pct', 100) for p in pages) / max(1, len(pages)), 3), 'identical_pages': sum(1 for p in pages if p.get('diff_px') == 0), 'pages': pages if len(pages) <= 3 else None}))
