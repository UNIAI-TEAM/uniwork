import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps/web/public/landing/studio");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

test("studio assets preserve their exact prompts and optimized WebP byte counts", () => {
  assert.deepEqual(manifest.assets.map((asset) => asset.name).sort(), ["connected-work", "team-session"]);
  let shippedBytes = 0;
  for (const asset of manifest.assets) {
    const webp = asset.files.find((file) => file.path.endsWith(".webp"));
    assert.ok(webp, `${asset.name} needs a WebP`);
    const data = fs.readFileSync(path.join(dir, webp.path));
    assert.equal(data.subarray(8, 12).toString(), "WEBP");
    assert.equal(data.byteLength, webp.bytes);
    assert.equal(asset.preferredSrc, `/landing/studio/${webp.path}`);
    const sidecar = JSON.parse(fs.readFileSync(path.join(dir, asset.promptSidecar), "utf8"));
    const prompt = fs.readFileSync(path.join(dir, asset.promptFile), "utf8").trim();
    assert.equal(sidecar.prompt.trim(), prompt);
    assert.equal(asset.exactPrompt.trim(), prompt);
    shippedBytes += data.byteLength;
  }
  assert.ok(shippedBytes < 256 * 1024, `studio artwork is ${shippedBytes} bytes; budget is 256 KiB`);
});
