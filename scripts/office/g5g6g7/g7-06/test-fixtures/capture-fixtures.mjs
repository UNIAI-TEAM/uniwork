// Capture-side fixture builders for the G7-06 job tests (golden, brand). Each
// takes a directory the test already owns (made with tmpDir):
//   mkCaptures      a mutable copy of the checked-in fake capture dir
//   writeGoldens    the goldens dir of the same captures, manifest included
//   recolorBlock    one rectangle of a PNG, the pixel mutation every golden
//                   case plants
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { loadPngjs } from "../job-lib.mjs";
import { fakePngBuffer } from "./fake-capture.mjs";

/** A mutable copy of the checked-in fake capture dir; returns the copy's root. */
export function mkCaptures(dir) {
  const target = join(dir, "captures");
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), "captures"), target, { recursive: true });
  return target;
}

/** Goldens built from the captures; `transform` may replace one pair's bytes. */
export function writeGoldens(dir, { capturesDir, fixtures, hosts, masks = {}, tolerance = null, maskLimits = null, viewport = { desktop: { w: 64, h: 48 }, web: { w: 64, h: 48 } }, transform = (_key, bytes) => bytes } = {}) {
  const entries = {};
  for (const host of hosts) {
    for (const fixture of fixtures) {
      const key = `${host}/${fixture}`;
      const target = join(dir, host, `${fixture}.png`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, transform(key, readFileSync(join(capturesDir, host, `${fixture}.png`))));
      entries[key] = { sha256: sha256Hex(readFileSync(target)), masks: masks[key] ?? [] };
    }
  }
  const manifest = {
    schema: 1,
    pinVersion: "0.1.0-fake",
    forkSha: "f".repeat(7),
    capturedOn: "2026-10-12T00:00:00.000Z",
    viewport,
    deviceScaleFactor: 1,
    ...(tolerance ? { tolerance } : {}),
    ...(maskLimits ? { maskLimits } : {}),
    entries,
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** Paint a rectangle of a PNG file, the pixel mutation every golden case uses. */
export function recolorBlock(file, { x, y, w, h }, color = [255, 0, 255, 255]) {
  const { PNG } = loadPngjs();
  const png = PNG.sync.read(readFileSync(file));
  for (let row = y; row < Math.min(y + h, png.height); row += 1) {
    for (let column = x; column < Math.min(x + w, png.width); column += 1) {
      png.data.set(color, (row * png.width + column) * 4);
    }
  }
  writeFileSync(file, PNG.sync.write(png));
}

/** A PNG of another size, for the size_mismatch case. */
export function otherSizePng() {
  return fakePngBuffer({ width: 32, height: 24 });
}
