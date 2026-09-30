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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ogCards } from "./og-cards.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SVG = path.join(ROOT, "packages", "ui", "brand", "svg");
const APP = path.join(ROOT, "apps", "web", "app");
const PUBLIC = path.join(ROOT, "apps", "web", "public");

const pwt = require.resolve("@playwright/test", { paths: [path.join(ROOT, "e2e")] });
const { chromium } = require(require.resolve("playwright-core", { paths: [path.dirname(pwt)] }));

const read = (name) => readFileSync(path.join(SVG, name), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const LOCK = path.join(ROOT, "packages", "ui", "brand", "assets.lock.json");
const OG_TEMPLATE = "scripts/brand/og-cards.mjs";

/** [file, [{ out, size | width+height, source, transparent }]] */
const PNGS = [
  // Transactional mail header. Mail clients drop inline SVG, so the lockup
  // ships as a hosted PNG at 2x of its 169x32 display size; transparent so it
  // sits on the mail's own ground.
  {
    out: path.join(PUBLIC, "brand", "email-lockup.png"),
    source: "lockup-horizontal.svg",
    width: 338,
    height: 64,
    transparent: true,
  },
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

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const lock = { generatedBy: "scripts/brand/build-assets.mjs", sources: {}, assets: {} };
const written = [];

mkdirSync(PUBLIC, { recursive: true });

// icon.svg is served as-is; Next's file convention picks it up from app/.
const compact = read("mark-compact.svg");
writeFileSync(path.join(APP, "icon.svg"), compact);
written.push(["app/icon.svg", compact.length]);

for (const { out, source, size, width = size, height = size, transparent = false } of PNGS) {
  const data = await shot(page, read(source), width, height, transparent);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, data);
  written.push([path.relative(ROOT, out), data.length]);
  lock.assets[path.relative(ROOT, out)] = {
    source,
    size: size ?? `${width}x${height}`,
    sha: sha(read(source)),
  };
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

// Link-preview cards. They set type, so they need the brand face; without it
// (BRAND_FONT_TTF unset) the committed cards and their lock entries stand, and
// the lock test flags them if the lockup or the template has moved since.
const fontDir = process.env.BRAND_OG_FONT_DIR;
if (fontDir) {
  const fonts = Object.fromEntries(
    [500, 600, 700, 800].map((w) => [w, readFileSync(path.join(fontDir, `${w}.ttf`))]),
  );
  const lockup = read("lockup-horizontal.svg");
  await page.setViewportSize({ width: 1200, height: 630 });
  const cards = ogCards({ root: ROOT, fonts, lockup });
  const images = {};
  for (const card of cards) {
    const base = path.join(ROOT, ...card.out);
    await page.setContent(card.html);
    await page.evaluate(() => document.fonts.ready);
    // A missing face falls back silently and ships a card in Times.
    if (!(await page.evaluate(() => document.fonts.check("800 72px Brand")))) {
      throw new Error(`${card.key}: brand font did not load`);
    }
    const png = await page.screenshot();
    mkdirSync(path.dirname(base), { recursive: true });
    writeFileSync(`${base}.png`, png);
    written.push([path.relative(ROOT, `${base}.png`), png.length]);
    // Two inputs: the lockup SVG (checked like every other raster) and the
    // card's own HTML from the template, recorded per card.
    lock.assets[path.relative(ROOT, `${base}.png`)] = {
      source: "lockup-horizontal.svg",
      size: "1200x630",
      sha: sha(lockup),
      template: OG_TEMPLATE,
      card: card.key,
      html: sha(card.html),
    };
    // Unfurlers cache an image by URL for weeks, so a changed card has to be a
    // changed URL: the version is the card's own HTML.
    const publicPath = card.key === "root"
      ? "/opengraph-image.png"
      : `/${path.relative(PUBLIC, `${base}.png`).split(path.sep).join("/")}`;
    images[card.key] = { url: `${publicPath}?v=${sha(card.html).slice(0, 10)}`, alt: card.alt };
  }
  // The root card is also served by file convention, which reads its alt here.
  writeFileSync(path.join(APP, "opengraph-image.alt.txt"), cards[0].alt);
  lock.templates = { [OG_TEMPLATE]: sha(readFileSync(path.join(ROOT, OG_TEMPLATE), "utf8")) };

  // A segment that sets its own `openGraph` loses the card Next wires by file
  // convention (and explicit images beat a segment's own file), so every page
  // with its own preview copy names its card from here.
  const entries = Object.entries(images)
    .map(([key, { url, alt }]) =>
      `  ${key}: { url: ${JSON.stringify(url)}, width: 1200, height: 630, alt: ${JSON.stringify(alt)} },`)
    .join("\n");
  writeFileSync(
    path.join(ROOT, "apps", "web", "platform", "og-image.generated.ts"),
    `// Generated by scripts/brand/build-assets.mjs. Do not edit.\nexport const OG_IMAGES = {\n${entries}\n} as const;\n`,
  );
} else if (existsSync(LOCK)) {
  const previous = JSON.parse(readFileSync(LOCK, "utf8"));
  for (const [asset, meta] of Object.entries(previous.assets)) {
    if (meta.size === "1200x630") lock.assets[asset] = meta;
  }
  if (previous.templates) lock.templates = previous.templates;
  console.log("link-preview cards: skipped (set BRAND_FONT_TTF)");
}

// Read the directory rather than list it: a hand-kept list silently omits any
// new SVG, and the omission surfaces as a failing contract test, not here.
for (const name of readdirSync(SVG).filter((f) => f.endsWith(".svg")).sort()) {
  lock.sources[name] = sha(read(name));
}

writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");

await browser.close();
for (const [name, bytes] of written) console.log(`${name.padEnd(34)} ${bytes} bytes`);
