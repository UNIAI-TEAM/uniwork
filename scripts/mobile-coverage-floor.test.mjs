import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FLOOR_FILE, MEASURES, raiseFloors, root, unmeasured } from "./mobile-coverage-floor.mjs";

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
  "components/calls/call-room.tsx",
  "components/chat/album-grid.tsx",
  "components/chat/chat-header.tsx",
  "components/chat/conversation.tsx",
  "components/chat/emoji-sheet.tsx",
  "components/chat/expression-sheet.tsx",
  "components/chat/forward-sheet.tsx",
  "components/chat/image-viewer.tsx",
  "components/chat/message-actions.tsx",
  "components/chat/message-cards.tsx",
  "components/chat/pinned-bar.tsx",
  "components/chat/reminder-sheet.tsx",
  "components/chat/room-avatar.tsx",
  "components/chat/room-list-parts.tsx",
  "components/chat/room-preview.tsx",
  "components/chat/swipe-to-reply.tsx",
  "components/chat/task-card.tsx",
  "components/chat/use-arrival-announcements.ts",
  "components/chat/use-read-marking.ts",
  "components/chat/use-voice-recorder.ts",
  "components/chat/voice-wave.tsx",
  "components/settings/devices-section.tsx",
  "components/settings/push-section.tsx",
  "components/ui/button.tsx",
  "components/ui/card.tsx",
  "components/ui/permission-gate.ts",
  "components/ui/separator.tsx",
  "components/ui/text.tsx",
  "components/ui/use-color-scheme.ts",
  "components/workspace/workspace-avatar.tsx",
  "components/workspace/workspace-switch-sheet.tsx",
  "data/calls/call-store.ts",
  "data/query-client.ts",
  "data/realtime/realtime-provider.tsx",
  "data/realtime/use-chat-realtime.ts",
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

test("jest.config.js measures the whole component tree and reads this floor", () => {
  const config = fs.readFileSync(path.join(root, "apps/chat-mobile/jest.config.js"), "utf8");
  assert.match(config, /"components\/\*\*\/\*\.\{ts,tsx\}"/);
  assert.match(config, /coverage-floor\.json/);
});
