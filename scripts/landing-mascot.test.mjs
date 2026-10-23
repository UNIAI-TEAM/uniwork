import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

for (const variant of ["v2", "v2-blink"]) test(`horse ${variant} preserves transparent, lightweight provenance`, () => {
  const asset = new URL(`../apps/web/public/landing/mascot/uni-horse-${variant}.webp`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(`${asset.href}.json`), "utf8"));
  const bytes = readFileSync(asset);
  assert.equal(bytes.length, manifest.bytes);
  assert.ok(bytes.length < 220 * 1024);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.equal(manifest.hasAlpha, true);
  assert.equal(manifest.width, 1200);
  assert.equal(manifest.height, 1200);
  assert.match(manifest.method, /Built-in image_gen/);
  assert.match(manifest.exactPrompt, /no text/i);
});

test("3D hero uses the shared mark without a hand-drawn brand substitute", () => {
  const component = readFileSync(new URL("../apps/web/features/landing/interactive-scene.tsx", import.meta.url), "utf8");
  const geometry = readFileSync(new URL("../apps/web/features/landing/animation/scene-models.ts", import.meta.url), "utf8");
  assert.match(component, /import \{ Logo \} from "@uniwork\/ui\/brand"/);
  assert.match(component, /<Logo variant="mark"/);
  assert.doesNotMatch(geometry, /uShape|emblem/);
});
