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
// Lock keys are POSIX paths whatever host runs the build, so the lock stays
// byte-stable between a Windows and a Linux rebuild.
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
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

// UniWork Office desktop icons (apps/office-desktop/build, read by
// electron-builder and copied into dist/ for the window icon). A desktop shell
// does not mask an icon the way iOS and Android launchers do, so the
// full-bleed tile gets its corner here: a rounded square edge to edge for
// Windows and Linux, and Apple's icon grid (an 824 body on the 1024 canvas,
// 185.4 corner) for the macOS png electron-builder turns into the .icns.
const DESKTOP = path.join(ROOT, "apps", "office-desktop", "build");
const DESKTOP_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const DESKTOP_LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
const DESKTOP_CORNER = 0.1875;
const MAC_GRID = { body: 824 / 1024, corner: 185.4 / 824 };

async function shot(page, svg, width, height, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<style>html,body{margin:0;${transparent ? "" : "background:#fff;"}}
     svg{display:block;width:${width}px;height:${height}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: transparent });
}

/** The tile clipped to a rounded square of `body` (a fraction of the canvas),
 * centred, transparent outside the corner. */
async function desktopTile(page, svg, size, body, corner) {
  const side = Math.round(size * body);
  const inset = (size - side) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0}div{position:absolute;left:${inset}px;top:${inset}px;width:${side}px;height:${side}px;border-radius:${side * corner}px;overflow:hidden}
     svg{display:block;width:100%;height:100%}</style><div>${svg}</div>`,
  );
  return page.screenshot({ omitBackground: true });
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
  lock.assets[rel(out)] = {
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

const appIcon = read("app-icon.svg");
const desktopAsset = (file, size, data) => {
  const out = path.join(DESKTOP, file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, data);
  written.push([path.relative(ROOT, out), data.length]);
  lock.assets[rel(out)] = { source: "app-icon.svg", size, sha: sha(appIcon) };
};
const desktopIco = [];
for (const size of DESKTOP_ICO_SIZES) {
  desktopIco.push({ size, data: await desktopTile(page, appIcon, size, 1, DESKTOP_CORNER) });
}
desktopAsset("icon.ico", DESKTOP_ICO_SIZES.join("/"), ico(desktopIco));
for (const size of DESKTOP_LINUX_SIZES) {
  desktopAsset(`icons/${size}x${size}.png`, size, await desktopTile(page, appIcon, size, 1, DESKTOP_CORNER));
}
desktopAsset("icon.png", 1024, await desktopTile(page, appIcon, 1024, MAC_GRID.body, MAC_GRID.corner));

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
    lock.assets[rel(`${base}.png`)] = {
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
