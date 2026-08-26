/**
 * Render every raster brand asset from the committed SVGs.
 *
 * Chromium is the rasteriser on purpose: the PNG a browser shows for
 * `icon.svg` and the PNG shipped as `apple-icon.png` then come off the same
 * renderer, so they cannot disagree. It is already installed - Playwright is
 * the repo's e2e dependency.
 *
 * Nothing here is hand-editable. `assets.lock.json` records the hash of each
 * source SVG; scripts/brand-assets.test.mjs fails if an SVG moves without this
 * script being re-run.
 *
 * Run: pnpm brand:build
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SVG = path.join(ROOT, "packages", "ui", "brand", "svg");
const APP = path.join(ROOT, "apps", "web", "app");
const PUBLIC = path.join(ROOT, "apps", "web", "public");

const pwt = require.resolve("@playwright/test", { paths: [path.join(ROOT, "e2e")] });
const { chromium } = require(require.resolve("playwright-core", { paths: [path.dirname(pwt)] }));

const read = (name) => readFileSync(path.join(SVG, name), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** [file, [{ out, size, source, transparent }]] */
const PNGS = [
  { out: path.join(APP, "apple-icon.png"), source: "app-icon.svg", size: 180 },
  { out: path.join(PUBLIC, "icon-192.png"), source: "app-icon.svg", size: 192 },
  { out: path.join(PUBLIC, "icon-512.png"), source: "app-icon.svg", size: 512 },
  {
    out: path.join(PUBLIC, "icon-maskable-512.png"),
    source: "app-icon-maskable.svg",
    size: 512,
  },
];

const ICO_SIZES = [16, 32, 48];

async function shot(page, svg, width, height, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<style>html,body{margin:0;${transparent ? "" : "background:#fff;"}}
     svg{display:block;width:${width}px;height:${height}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: transparent });
}

/**
 * PNG-in-ICO. The directory is fixed-width, so the offsets are known only once
 * every image is rendered; hence the two passes.
 */
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const dir = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += data.length;
  }
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.data)]);
}

function ogPage(lockup) {
  // 1200x630 is the Open Graph card. White lockup on the brand gradient: the
  // one place the gradient may fill a surface, because the surface IS the
  // logo's own artwork rather than product chrome.
  //
  // The mono lockup, not the gradient one. Recolouring the gradient lockup to
  // white leaves its depth crescent behind, and #0A34C4 at 45% over white is
  // lavender.
  return `<style>
    html,body{margin:0}
    .card{width:1200px;height:630px;display:grid;place-items:center;
      background:linear-gradient(38deg,#0044E3 0%,#00B4FC 52%,#02DEF5 100%)}
    svg{width:600px;height:auto;color:#fff}
  </style><div class="card">${lockup}</div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const lock = { generatedBy: "scripts/brand/build-assets.mjs", sources: {}, assets: {} };
const written = [];

mkdirSync(PUBLIC, { recursive: true });

// icon.svg is served as-is; Next's file convention picks it up from app/.
const compact = read("mark-compact.svg");
writeFileSync(path.join(APP, "icon.svg"), compact);
written.push(["app/icon.svg", compact.length]);

for (const { out, source, size } of PNGS) {
  const data = await shot(page, read(source), size, size, false);
  writeFileSync(out, data);
  written.push([path.relative(ROOT, out), data.length]);
  lock.assets[path.relative(ROOT, out)] = { source, size, sha: sha(read(source)) };
}

const icoPngs = [];
for (const size of ICO_SIZES) {
  icoPngs.push({ size, data: await shot(page, compact, size, size, true) });
}
const icoBuf = ico(icoPngs);
writeFileSync(path.join(APP, "favicon.ico"), icoBuf);
written.push(["app/favicon.ico", icoBuf.length]);
lock.assets["apps/web/app/favicon.ico"] = {
  source: "mark-compact.svg",
  size: ICO_SIZES.join("/"),
  sha: sha(compact),
};

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogPage(read("lockup-horizontal-mono.svg")));
const og = await page.screenshot();
writeFileSync(path.join(APP, "opengraph-image.png"), og);
written.push(["app/opengraph-image.png", og.length]);
// squeeze.py re-encodes this one to JPEG and removes the PNG; the lock names
// the file that actually ships.
lock.assets["apps/web/app/opengraph-image.jpg"] = {
  source: "lockup-horizontal-mono.svg",
  size: "1200x630",
  sha: sha(read("lockup-horizontal-mono.svg")),
};

lock.assets["apps/web/app/icon.svg"] = {
  source: "mark-compact.svg",
  size: "vector",
  sha: sha(compact),
};

// Read the directory rather than list it: a hand-kept list silently omits any
// new SVG, and the omission surfaces as a failing contract test, not here.
for (const name of readdirSync(SVG).filter((f) => f.endsWith(".svg")).sort()) {
  lock.sources[name] = sha(read(name));
}

writeFileSync(
  path.join(ROOT, "packages", "ui", "brand", "assets.lock.json"),
  JSON.stringify(lock, null, 2) + "\n",
);

await browser.close();
for (const [name, bytes] of written) console.log(`${name.padEnd(34)} ${bytes} bytes`);
