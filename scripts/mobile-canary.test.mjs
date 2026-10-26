import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANARIES, staleness } from "./mobile-canary.mjs";

// The canaries (scripts/mobile-canary.mjs) must keep applying to the tree as it changes, or the
// proof that each gate can go red quietly stops being runnable.
const root = path.resolve(import.meta.dirname, "..");

test("every canary still applies to the tree", () => {
  for (const name of Object.keys(CANARIES)) assert.equal(staleness(name), null, name);
});

test("every canary names the jobs it must turn red, and those are jobs of mobile-verify", () => {
  const wf = fs.readFileSync(path.join(root, ".github/workflows/mobile-verify.yml"), "utf8");
  const names = new Set([...wf.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim()));
  for (const [name, canary] of Object.entries(CANARIES)) {
    assert.ok(canary.red.length > 0, name);
    for (const job of canary.red) {
      const display = job.replace(/ \(.*\)$/, "");
      assert.ok(names.has(display), `${name}: "${display}" is not a job name in mobile-verify.yml`);
    }
  }
});

test("staleness says why a canary no longer applies", () => {
  const files = { "a.txt": "one anchor\n", "b.txt": "twice twice\n" };
  const read = (file) => files[file];
  const exists = (file) => file in files;
  const saved = { ...CANARIES };
  try {
    Object.assign(CANARIES, {
      ok: { file: "a.txt", find: "anchor" },
      gone: { file: "c.txt", find: "x" },
      twice: { file: "b.txt", find: "twice" },
      created: { file: "a.txt", create: "" },
    });
    assert.equal(staleness("ok", read, exists), null);
    assert.equal(staleness("gone", read, exists), "c.txt is gone");
    assert.equal(staleness("twice", read, exists), "b.txt holds its anchor 2 times, not once");
    assert.equal(staleness("created", read, exists), "a.txt already exists");
  } finally {
    for (const key of ["ok", "gone", "twice", "created"]) delete CANARIES[key];
    assert.deepEqual(Object.keys(CANARIES), Object.keys(saved));
  }
});
