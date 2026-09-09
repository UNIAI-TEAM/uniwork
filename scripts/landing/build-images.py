"""Fetch the landing photography and re-encode it as WebP into apps/web/public.

The sources are 11.2 MB of PNG on a third-party CDN and never enter the repo:
`sources.json` records each one's URL and the sha256 of the bytes we converted,
so a rebuild is reproducible without carrying the originals forever. Only the
WebP outputs are committed.

Pillow does the encoding — already a dependency of scripts/brand/squeeze.py, so
this adds nothing to the toolchain. One width per image: `next/image` derives
every narrower variant itself, so a second source file here would be dead
weight. 1600 is the ceiling worth keeping — the page's largest slot is a
half-width figure on a 1440 viewport.

Run: pnpm landing:images
"""

import hashlib
import io
import json
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "apps", "web", "public", "landing")
SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources.json")

WIDTH = 1600
QUALITY = 82


def encode(img: Image.Image, width: int) -> bytes:
    if img.width > width:
        height = round(img.height * width / img.width)
        img = img.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    # method=6 is the slowest and smallest setting; this runs by hand, not in CI.
    img.convert("RGB").save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue()


def main() -> int:
    spec = json.load(open(SOURCES, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    lock = {"_": spec["_"], "quality": QUALITY, "width": WIDTH, "images": {}}

    for name, url in sorted(spec["images"].items()):
        print(f"==> {name}")
        # The CDN answers 403 to urllib's default agent string.
        request = urllib.request.Request(url, headers={"User-Agent": "uniwork-landing-images/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
        img = Image.open(io.BytesIO(raw))
        entry = {
            "url": url,
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "source_bytes": len(raw),
            "source_size": [img.width, img.height],
            "outputs": {},
        }
        data = encode(img, WIDTH)
        filename = f"{name}.webp"
        with open(os.path.join(OUT, filename), "wb") as handle:
            handle.write(data)
        entry["outputs"][filename] = {
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        print(f"    {filename}  {len(data) / 1024:.0f} KB")
        lock["images"][name] = entry

    with open(os.path.join(OUT, "images.lock.json"), "w", encoding="utf-8") as handle:
        json.dump(lock, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
