"""Re-encode the generated rasters. Runs last in scripts/brand/build.sh.

Chromium writes PNGs at zlib's default level with no filter search, so every
file it hands back is roughly a third larger than it needs to be. This pass is
lossless for the icons and the favicon.

The link-preview cards take the same lossless pass. They were JPEG while the
card was a gradient behind a glyph; the current cards are flat fields and type,
where PNG is the smaller file as well as the exact one (measured 2026-09-30:
~80 KB PNG against ~120 KB for JPEG q95 4:4:4), and there is no ringing
around the headline for a thumbnail to magnify.
"""

import glob
import io
import os
import struct
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
APP = os.path.join(ROOT, "apps", "web", "app")
PUBLIC = os.path.join(ROOT, "apps", "web", "public")

PNGS = [
    os.path.join(PUBLIC, "brand", "email-lockup.png"),
    os.path.join(APP, "apple-icon.png"),
    os.path.join(PUBLIC, "icon-192.png"),
    os.path.join(PUBLIC, "icon-512.png"),
    os.path.join(PUBLIC, "icon-maskable-512.png"),
]
ICO = os.path.join(APP, "favicon.ico")


def squeeze_png(path):
    before = os.path.getsize(path)
    im = Image.open(path)
    im.load()
    im.save(path, "PNG", optimize=True, compress_level=9)
    return before, os.path.getsize(path)


def squeeze_card(path):
    """The cards are opaque, so the alpha channel Chromium writes is dead weight.
    Keep the re-encode only when it is smaller: on flat fields zlib's default
    already does well, and PIL's optimize can come out a few percent larger."""
    before = os.path.getsize(path)
    buf = io.BytesIO()
    Image.open(path).convert("RGB").save(buf, "PNG", optimize=True, compress_level=9)
    if buf.tell() < before:
        with open(path, "wb") as fh:
            fh.write(buf.getvalue())
    return before, os.path.getsize(path)


def squeeze_ico(path):
    """Re-encode each image inside the ICO and rebuild the directory."""
    before = os.path.getsize(path)
    data = open(path, "rb").read()
    count = struct.unpack("<H", data[4:6])[0]
    frames = []
    for i in range(count):
        off = 6 + i * 16
        size = struct.unpack("<I", data[off + 8:off + 12])[0]
        pos = struct.unpack("<I", data[off + 12:off + 16])[0]
        im = Image.open(io.BytesIO(data[pos:pos + size]))
        im.load()
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True, compress_level=9)
        frames.append((data[off] or 256, buf.getvalue()))

    head = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + len(frames) * 16
    entries, blobs = [], []
    for side, blob in frames:
        entries.append(struct.pack("<BBBBHHII", side % 256, side % 256, 0, 0, 1, 32,
                                   len(blob), offset))
        blobs.append(blob)
        offset += len(blob)
    with open(path, "wb") as fh:
        fh.write(head + b"".join(entries) + b"".join(blobs))
    return before, os.path.getsize(path)


def main():
    rows = []
    for p in PNGS:
        rows.append((os.path.relpath(p, ROOT),) + squeeze_png(p))
    rows.append((os.path.relpath(ICO, ROOT),) + squeeze_ico(ICO))

    # Every card build-assets.mjs just wrote: the root one Next serves by file
    # convention, and the per-route ones (invites, shared documents).
    cards = [os.path.join(APP, "opengraph-image.png")]
    cards += sorted(glob.glob(os.path.join(PUBLIC, "brand", "og", "*.png")))
    for og in cards:
        rows.append((os.path.relpath(og, ROOT),) + squeeze_card(og))

    total_before = sum(r[1] for r in rows)
    total_after = sum(r[2] for r in rows)
    for name, a, b in rows:
        print(f"{name:40s} {a:8d} -> {b:8d}  {b / a:5.0%}")
    print(f"{'total':40s} {total_before:8d} -> {total_after:8d}  {total_after / total_before:5.0%}")


if __name__ == "__main__":
    sys.exit(main())
