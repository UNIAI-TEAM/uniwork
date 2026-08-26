import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.join(root, "packages", "ui", "brand");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const lock = JSON.parse(read("packages/ui/brand/assets.lock.json"));

// Rendering the assets needs Chromium; hashing the sources does not. The lock
// file is what makes an un-run `pnpm brand:build` visible: edit an SVG, and the
// hash recorded beside every asset derived from it stops matching.
test("every raster asset was built from the SVG currently committed", () => {
  const stale = Object.entries(lock.assets)
    .filter(([, meta]) => sha(read(path.join("packages/ui/brand/svg", meta.source))) !== meta.sha)
    .map(([asset, meta]) => `${asset} <- ${meta.source}`);
  assert.deepEqual(stale, [], `run \`pnpm brand:build\`; stale:\n${stale.join("\n")}`);
});

test("every SVG source is recorded, and every recorded source exists", () => {
  const onDisk = fs
    .readdirSync(path.join(brand, "svg"))
    .filter((f) => f.endsWith(".svg"))
    .sort();
  assert.deepEqual(Object.keys(lock.sources).sort(), onDisk);
  for (const [name, hash] of Object.entries(lock.sources)) {
    assert.equal(sha(read(path.join("packages/ui/brand/svg", name))), hash, `${name} changed`);
  }
});

test("every asset the lock names is on disk", () => {
  for (const asset of Object.keys(lock.assets)) {
    assert.ok(fs.existsSync(path.join(root, asset)), `${asset} is missing`);
  }
});

/**
 * Read the top-left pixel of a PNG without a decoder.
 *
 * Row 0 is the first scanline in the inflated IDAT stream, preceded by its
 * filter byte. For the very first pixel, filters None(0), Sub(1), Up(2) and
 * Paeth(4) all reduce to the raw bytes, because every neighbour they reference
 * is off-canvas and therefore zero; Average(3) halves the left neighbour, which
 * is also zero. So byte 1 onward IS the first pixel in every filter mode.
 */
function firstPixel(file) {
  const buf = fs.readFileSync(path.join(root, file));
  let pos = 8;
  let width = 0;
  let colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      colourType = data[9];
      assert.equal(data[8], 8, `${file}: expected 8-bit channels`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  assert.ok(channels && width, `${file}: unsupported PNG colour type ${colourType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { alpha: channels === 4 ? raw[4] : 255, rgb: [raw[1], raw[2], raw[3]], width };
}

// Every platform masks these files itself - iOS with its superellipse, Android
// launchers with the theme's shape - and the App Store rejects an alpha channel
// outright. A corner radius or transparency baked into the file shows up as
// notches of whatever sits outside the radius. Full bleed is the contract, and
// the shipped bytes are the only place to check it.
test("every platform icon is opaque to its corners", () => {
  for (const t of ["apps/web/app/apple-icon.png", "apps/web/public/icon-192.png",
                   "apps/web/public/icon-512.png", "apps/web/public/icon-maskable-512.png"]) {
    const { alpha, rgb } = firstPixel(t);
    assert.equal(alpha, 255, `${t}: top-left pixel is transparent (alpha ${alpha})`);
    assert.notDeepEqual(rgb, [255, 255, 255], `${t}: top-left pixel is white, not the brand tile`);
  }
});

// Next wires these up by file convention. A rename is silent: no build error,
// just a site that has no icon.
test("the Next.js metadata files exist under app/", () => {
  for (const f of ["icon.svg", "favicon.ico", "apple-icon.png", "opengraph-image.jpg",
                   "opengraph-image.alt.txt", "manifest.ts"]) {
    assert.ok(fs.existsSync(path.join(root, "apps/web/app", f)), `apps/web/app/${f} is missing`);
  }
});

// The manifest lists icons by public path; a typo there shows up only as a
// broken install prompt on a phone.
test("every icon the manifest lists exists in public/", () => {
  const manifest = read("apps/web/app/manifest.ts");
  const srcs = [...manifest.matchAll(/src:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0, "manifest lists no icons");
  for (const src of srcs) {
    assert.ok(
      fs.existsSync(path.join(root, "apps/web/public", src.replace(/^\//, ""))),
      `manifest references ${src}, which is not in apps/web/public`,
    );
  }
});

// The gradient is deliberately not a CSS token: a token would put it one
// utility class away from becoming a card background, which PRODUCT.md forbids.
test("the logo gradient never leaks into the token layer", () => {
  const tokens = read("packages/ui/styles/tokens.css");
  for (const hex of ["#0044E3", "#00B4FC", "#02DEF5", "#0A34C4"]) {
    assert.ok(
      !tokens.toLowerCase().includes(hex.toLowerCase()),
      `${hex} is a logo-only colour and must not appear in tokens.css`,
    );
  }
});

// theme_color paints the Android status bar - product chrome, so it has to be
// the flat brand token rather than a colour picked out of the logo.
test("the manifest theme colour is the brand token's value", () => {
  // Match the :root block, not everything before the first ".dark" — the file's
  // header comment mentions `.dark` and would cut the block off at line 2.
  const tokens = read("packages/ui/styles/tokens.css");
  const rootBlock = /^:root\s*\{([\s\S]*?)^\}/m.exec(tokens)[1];
  const brandHex = /--brand:\s*(#[0-9a-fA-F]{6})/.exec(rootBlock)[1];
  assert.match(read("apps/web/app/manifest.ts"), new RegExp(`theme_color:\\s*"${brandHex}"`, "i"));
});
