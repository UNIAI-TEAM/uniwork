import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FLOOR_FILE, MEASURES, raiseFloors, root } from "./mobile-coverage-floor.mjs";

const floor = JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8"));

test("a recorded floor only rises, and a file no longer measured leaves", () => {
  const recorded = { "a.tsx": { statements: 90, branches: 80, functions: 90, lines: 90 }, "gone.tsx": { statements: 100, branches: 100, functions: 100, lines: 100 } };
  const measured = { "a.tsx": { statements: 70.5, branches: 85.9, functions: 90, lines: 99.99 }, "new.tsx": { statements: 12.3, branches: 0, functions: 0, lines: 12.9 } };
  assert.deepEqual(raiseFloors(recorded, measured), {
    "a.tsx": { statements: 90, branches: 85, functions: 90, lines: 99 },
    "new.tsx": { statements: 12, branches: 0, functions: 0, lines: 12 },
  });
});

test("every recorded file exists, with a floor for each measure, and new files meet the global floor", () => {
  for (const [file, pcts] of Object.entries(floor.files)) {
    assert.ok(fs.existsSync(path.join(root, "apps/chat-mobile", file)), `${file} is recorded but gone: rerun --write`);
    for (const m of MEASURES) assert.ok(Number.isInteger(pcts[m]) && pcts[m] >= 0 && pcts[m] <= 100, `${file} ${m}`);
  }
  for (const m of MEASURES) assert.ok(floor.global[m] >= 80, `the global floor for new files stays high (${m})`);
});

test("jest.config.js measures the whole component tree and reads this floor", () => {
  const config = fs.readFileSync(path.join(root, "apps/chat-mobile/jest.config.js"), "utf8");
  assert.match(config, /"components\/\*\*\/\*\.\{ts,tsx\}"/);
  assert.match(config, /coverage-floor\.json/);
});
