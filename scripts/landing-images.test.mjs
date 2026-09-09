import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps", "web", "public", "landing");
const sources = JSON.parse(fs.readFileSync(path.join(root, "scripts/landing/sources.json"), "utf8"));

// The originals are 11.2 MB of PNG on a third-party CDN and are deliberately
// not in the repo, so nothing here can re-derive an output. What it CAN prove
// is that the committed bytes are the bytes the build wrote: a file replaced by
// hand, truncated by a bad merge, or added without a lock entry.
const lock = JSON.parse(fs.readFileSync(path.join(dir, "images.lock.json"), "utf8"));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

test("every committed WebP matches the hash the build recorded", () => {
  const wrong = [];
  for (const [name, meta] of Object.entries(lock.images)) {
    for (const [file, out] of Object.entries(meta.outputs)) {
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) {
        wrong.push(`${file} missing`);
        continue;
      }
      const bytes = fs.readFileSync(p);
      if (sha(bytes) !== out.sha256) wrong.push(`${file} (${name}) content differs from the lock`);
    }
  }
  assert.deepEqual(wrong, [], `run \`pnpm landing:images\`;\n${wrong.join("\n")}`);
});

test("the lock covers every source and every file on disk", () => {
  const locked = Object.keys(lock.images).sort();
  assert.deepEqual(locked, Object.keys(sources.images).sort(), "sources.json and images.lock.json disagree");

  const expected = new Set(Object.values(lock.images).flatMap((m) => Object.keys(m.outputs)));
  const orphans = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".webp") && !expected.has(f))
    .sort();
  assert.deepEqual(orphans, [], `unrecorded files in public/landing: ${orphans.join(", ")}`);
});

// A landing page that ships megabytes of imagery is a landing page nobody
// waits for. The whole set converted from 11.2 MB of PNG; this is the ratchet
// that keeps a future re-encode from quietly undoing that.
test("the image set stays inside its weight budget", () => {
  const total = Object.values(lock.images)
    .flatMap((m) => Object.values(m.outputs))
    .reduce((n, out) => n + out.bytes, 0);
  const mb = total / 1024 / 1024;
  assert.ok(mb < 2, `landing imagery is ${mb.toFixed(2)} MB, budget is 2 MB`);
});
