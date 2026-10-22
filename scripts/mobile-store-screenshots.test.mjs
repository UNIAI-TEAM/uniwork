// Audit "store-assets-missing": UniChat had no store screenshots and no 512 px Play icon. The capture tool and the
// check live in apps/chat-mobile/scripts/store-screenshots.mjs; this holds the check's rules, the committed icon, and
// the promote workflow running the check before a release reaches production.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCALES,
  MIN_SHOTS,
  appleShotsDir,
  appleSizeProblem,
  playIcon,
  playShotsDir,
  playSizeProblem,
  pngInfo,
  storeAssetProblems,
} from "../apps/chat-mobile/scripts/store-screenshots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The first 26 bytes of a PNG: signature, IHDR length and type, width, height, bit depth, colour type. */
function png(width, height, colorType = 6) {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt8(8, 24);
  b.writeUInt8(colorType, 25);
  return b;
}

test("reads a PNG's size and colour type, and nothing else", () => {
  assert.deepEqual(pngInfo(png(1080, 1920, 2)), { width: 1080, height: 1920, colorType: 2 });
  assert.equal(pngInfo(Buffer.from("not a png at all, really not")), null);
  assert.equal(pngInfo(Buffer.alloc(4)), null);
});

test("holds Play's and the App Store's size rules", () => {
  assert.equal(playSizeProblem({ width: 1080, height: 1920 }), null);
  assert.match(playSizeProblem({ width: 1080, height: 2400 }), /more than twice/);
  assert.match(playSizeProblem({ width: 200, height: 300 }), /outside/);
  assert.match(playSizeProblem({ width: 1080, height: 4000 }), /outside/);
  assert.equal(appleSizeProblem({ width: 1320, height: 2868 }), null);
  assert.equal(appleSizeProblem({ width: 1242, height: 2688 }), null);
  assert.match(appleSizeProblem({ width: 2868, height: 1320 }), /portrait/);
});

test("names every gap, and none once each language has its shots and Play its icon", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-"));
  const missing = storeAssetProblems(store);
  assert.ok(missing.some((p) => p.includes("icon-512.png is missing")));
  for (const locale of Object.keys(LOCALES)) {
    assert.ok(missing.some((p) => p.startsWith(`Play ${LOCALES[locale].play}: 0 screenshots`)));
    assert.ok(missing.some((p) => p.startsWith(`App Store ${LOCALES[locale].apple}: 0 screenshots`)));
  }
  fs.mkdirSync(path.dirname(playIcon(store)), { recursive: true });
  fs.writeFileSync(playIcon(store), png(512, 512, 2));
  assert.ok(storeAssetProblems(store, ["android"]).includes("Play: icon-512.png must be a 512 x 512 32-bit PNG"));
  fs.writeFileSync(playIcon(store), png(512, 512, 6));
  for (const locale of Object.keys(LOCALES)) {
    for (const [dir, size] of [[playShotsDir(store, locale), [1080, 1920]], [appleShotsDir(store, locale), [1320, 2868]]]) {
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 1; i <= MIN_SHOTS; i += 1) fs.writeFileSync(path.join(dir, `${i}.png`), png(...size));
    }
  }
  assert.deepEqual(storeAssetProblems(store), []);
  fs.writeFileSync(path.join(playShotsDir(store, "vi"), "4.png"), png(1080, 2400));
  fs.writeFileSync(path.join(appleShotsDir(store, "en"), "4.png"), Buffer.from("broken"));
  assert.deepEqual(storeAssetProblems(store), [
    "Play vi-VN: 4.png: 1080x2400: the longer side is more than twice the shorter",
    "App Store en-US: 4.png: not a PNG",
  ]);
  assert.deepEqual(storeAssetProblems(store, ["ios"]), ["App Store en-US: 4.png: not a PNG"]);
});

test("the committed Play icon is what Play takes", () => {
  const problems = storeAssetProblems(path.join(root, "apps/chat-mobile/store"), ["android"]);
  assert.ok(!problems.some((p) => p.includes("icon-512")), problems.join("\n"));
});

test("a release reaches production only with the store's pictures in place", () => {
  const wf = fs.readFileSync(path.join(root, ".github/workflows/chat-mobile-promote.yml"), "utf8");
  assert.match(wf, /node apps\/chat-mobile\/scripts\/store-screenshots\.mjs check --platform "\$PLATFORM"/);
  assert.match(wf, /if: \$\{\{ inputs\.action == 'promote' && \(inputs\.to_track == 'production' \|\| inputs\.platform == 'ios'\) \}\}/);
});
