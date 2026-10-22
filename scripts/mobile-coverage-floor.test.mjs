import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FLOOR_FILE, MEASURES, measuredFrom, raiseFloors, raiseRoutes, root, routesMeasured, unmeasured } from "./mobile-coverage-floor.mjs";

const floor = JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8"));

const GLOBAL = { statements: 90, branches: 80, functions: 90, lines: 90 };

test("a recorded floor only rises, and a file no longer measured leaves", () => {
  const recorded = { "a.tsx": { statements: 90, branches: 80, functions: 90, lines: 90 }, "gone.tsx": { statements: 100, branches: 100, functions: 100, lines: 100 } };
  const measured = { "a.tsx": { statements: 70.5, branches: 85.9, functions: 90, lines: 99.99 }, "new.tsx": { statements: 95.3, branches: 80, functions: 100, lines: 90.9 } };
  assert.deepEqual(raiseFloors(recorded, measured, GLOBAL), {
    files: {
      "a.tsx": { statements: 90, branches: 85, functions: 90, lines: 99 },
      "new.tsx": { statements: 95, branches: 80, functions: 100, lines: 90 },
    },
    refused: [],
  });
});

// Recording a new file at whatever it has would take it out of the global group: an untested
// component written down at 0 never turns the run red. A file is admitted only at the global floor.
test("a new file below the global floor is refused, not recorded at what it has", () => {
  const measured = { "untested.tsx": { statements: 0, branches: 100, functions: 100, lines: 0 }, "thin.tsx": { statements: 95, branches: 79.9, functions: 95, lines: 95 } };
  assert.deepEqual(raiseFloors({}, measured, GLOBAL), { files: {}, refused: ["thin.tsx", "untested.tsx"] });
});

// A narrowed jest run (one file) would otherwise drop every other floor as "no longer measured".
test("a recorded file that still exists but was not measured stops --write", () => {
  const recorded = { "components/ui/button.tsx": GLOBAL, "components/gone.tsx": GLOBAL };
  assert.deepEqual(unmeasured(recorded, {}), ["components/ui/button.tsx"]);
  assert.deepEqual(unmeasured(recorded, { "components/ui/button.tsx": GLOBAL }), []);
});

// The files recorded below the global floor when the per-file floor was introduced (ca6900a11):
// debt written down, not a class a file can join. The list only shrinks — a file brought up to the
// global floor leaves it — and nothing outside it sits below the global floor.
const BELOW_GLOBAL = new Set([
  "components/brand/unichat-logo.tsx",
  "components/chat/album-grid.tsx",
  "components/chat/conversation.tsx",
  "components/chat/emoji-sheet.tsx",
  "components/chat/expression-sheet.tsx",
  "components/chat/forward-sheet.tsx",
  "components/chat/image-viewer.tsx",
  "components/chat/message-cards.tsx",
  "components/chat/pinned-bar.tsx",
  "components/chat/reminder-sheet.tsx",
  "components/chat/room-list-parts.tsx",
  "components/chat/room-preview.tsx",
  "components/chat/task-card.tsx",
  "components/ui/card.tsx",
  "components/ui/separator.tsx",
  "components/ui/text.tsx",
  "components/ui/use-color-scheme.ts",
  "components/workspace/workspace-avatar.tsx",
  "data/calls/call-store.ts",
  "data/realtime/use-ws-subscriptions.ts",
]);

test("only the recorded debt sits below the global floor, and it only shrinks", () => {
  const below = Object.entries(floor.files)
    .filter(([, pcts]) => MEASURES.some((m) => pcts[m] < floor.global[m]))
    .map(([file]) => file);
  for (const file of below) assert.ok(BELOW_GLOBAL.has(file), `${file} is recorded below the global floor: test it (a new file is admitted only at the global floor)`);
  for (const file of BELOW_GLOBAL) assert.ok(below.includes(file), `${file} now meets the global floor: remove it from BELOW_GLOBAL`);
});

test("every recorded file exists, with a floor for each measure, and new files meet the global floor", () => {
  for (const [file, pcts] of Object.entries(floor.files)) {
    assert.ok(fs.existsSync(path.join(root, "apps/chat-mobile", file)), `${file} is recorded but gone: rerun --write`);
    for (const m of MEASURES) assert.ok(Number.isInteger(pcts[m]) && pcts[m] >= 0 && pcts[m] <= 100, `${file} ${m}`);
  }
  for (const m of MEASURES) assert.ok(floor.global[m] >= 80, `the global floor for new files stays high (${m})`);
});

test("jest.config.js measures the whole component tree and the route files, and reads this floor", () => {
  const config = fs.readFileSync(path.join(root, "apps/chat-mobile/jest.config.js"), "utf8");
  assert.match(config, /"components\/\*\*\/\*\.\{ts,tsx\}"/);
  assert.match(config, /"app\/\*\*\/\*\.tsx"/, "the route files are measured (audit 'coverage-allowlist')");
  assert.match(config, /\[`\$\{path\.join\(__dirname, "app"\)\}\/`\]: floor\.routes/, "as one group, at the routes floor");
  assert.match(config, /"<rootDir>\/test\/routes\/\*\*\/\*\.test\.tsx"/, "the route tests run");
  assert.match(config, /coverage-floor\.json/);
});

// app/: composition rendered through the real router (test/routes/), held as one group whose floor only rises.
test("the route files are measured as one group, outside the per-file floors", () => {
  const APP = path.join(root, "apps/chat-mobile");
  const entry = (total, covered) => Object.fromEntries(MEASURES.map((m) => [m, { total, covered, pct: total ? (100 * covered) / total : 100 }]));
  const summary = {
    total: entry(30, 20),
    [path.join(APP, "app/index.tsx")]: entry(10, 9),
    [path.join(APP, "app/(auth)/login.tsx")]: entry(10, 1),
    [path.join(APP, "components/ui/button.tsx")]: entry(10, 10),
  };
  assert.deepEqual(Object.keys(measuredFrom(summary)), ["components/ui/button.tsx"], "no route file gets a floor of its own");
  assert.deepEqual(routesMeasured(summary), Object.fromEntries(MEASURES.map((m) => [m, 50])), "covered over total across the group");
  assert.equal(routesMeasured({ total: entry(1, 1), [path.join(APP, "components/a.tsx")]: entry(1, 1) }), null, "a run that measured no route");
  assert.deepEqual(raiseRoutes({ statements: 40, branches: 60, functions: 10, lines: 50 }, { statements: 50.9, branches: 55, functions: 23.4, lines: 50 }), { statements: 50, branches: 60, functions: 23, lines: 50 });
  assert.deepEqual(raiseRoutes(undefined, { statements: 1.5, branches: 0, functions: 0, lines: 0 }), { statements: 1, branches: 0, functions: 0, lines: 0 });
  for (const m of MEASURES) assert.ok(Number.isInteger(floor.routes?.[m]) && floor.routes[m] > 0, `coverage-floor.json › routes.${m} is recorded`);
  assert.ok(Object.keys(floor.files).every((file) => !file.startsWith("app/")), "route files are the group's, not per file");
});
