import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps", "web", "public", "landing");
const prompts = JSON.parse(fs.readFileSync(path.join(root, "scripts/landing/prompts.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "scripts/landing/artwork.lock.json"), "utf8"));
const resolver = fs.readFileSync(path.join(root, "apps/web/features/landing/artwork.ts"), "utf8");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const LOCALES = ["vi", "en"];

/** Every file the prompts imply: one per locale when localized, else one. */
const expected = Object.entries(prompts.images).flatMap(([name, spec]) =>
  spec.localized ? LOCALES.map((l) => `${name}.${l}`) : [name],
);

// Regenerating costs money and a render is never byte-identical, so nothing
// here re-derives an image. What it proves is that the committed bytes are the
// bytes the generator wrote: a file replaced by hand, truncated by a bad merge,
// or added without a lock entry.
test("every committed image matches the hash the generator recorded", () => {
  const wrong = [];
  for (const [stem, meta] of Object.entries(lock.images)) {
    const p = path.join(dir, `${stem}.webp`);
    if (!fs.existsSync(p)) {
      wrong.push(`${stem}.webp missing`);
      continue;
    }
    if (sha(fs.readFileSync(p)) !== meta.sha256) wrong.push(`${stem}.webp differs from the lock`);
  }
  assert.deepEqual(wrong, [], `run \`pnpm landing:gen\`;\n${wrong.join("\n")}`);
});

test("the prompts, the lock and the files on disk agree", () => {
  assert.deepEqual(Object.keys(lock.images).sort(), [...expected].sort(), "prompts.json and the lock disagree");

  const orphans = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".webp") && !expected.includes(f.replace(/\.webp$/, "")))
    .sort();
  assert.deepEqual(orphans, [], `unrecorded files in public/landing: ${orphans.join(", ")}`);
});

// The generator decides how many files exist; the resolver decides which one a
// component asks for. They read the same `localized` flag from two different
// files, and a page that asks for a locale variant nobody rendered is a 404 in
// production and nowhere else.
test("the component resolver and the prompts agree on what is localized", () => {
  const wrong = [];
  for (const [name, spec] of Object.entries(prompts.images)) {
    const declared = new RegExp(`["']?${name}["']?:\\s*(true|false)`).exec(resolver);
    if (!declared) {
      wrong.push(`${name} is missing from ARTWORK in artwork.ts`);
      continue;
    }
    if ((declared[1] === "true") !== Boolean(spec.localized)) {
      wrong.push(`${name}: prompts say localized=${Boolean(spec.localized)}, artwork.ts says ${declared[1]}`);
    }
  }
  assert.deepEqual(wrong, []);
});

// A landing page that ships megabytes of artwork is a landing page nobody
// waits for. Two locales double the set, so the ratchet matters more, not less.
test("the artwork stays inside its weight budget", () => {
  const mb = Object.values(lock.images).reduce((n, m) => n + m.bytes, 0) / 1024 / 1024;
  assert.ok(mb < 2, `landing artwork is ${mb.toFixed(2)} MB, budget is 2 MB`);
});
