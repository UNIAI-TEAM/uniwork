import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "apps/web/public/landing/motion");
const manifest = JSON.parse(readFileSync(path.join(directory, "workflow-film.json"), "utf8"));

test("original motion assets match provenance and stay within the mobile budget", () => {
  assert.equal(manifest.audio, false);
  assert.equal(manifest.durationSeconds, 7);
  assert.equal(manifest.frames, manifest.fps * manifest.durationSeconds);
  assert.match(manifest.method, /Code-authored 3D/);
  for (const asset of [manifest.video, manifest.poster]) {
    const bytes = readFileSync(path.join(root, "apps/web/public", asset.path));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  }
  assert.ok(manifest.video.bytes + manifest.poster.bytes < 512 * 1024);
});
