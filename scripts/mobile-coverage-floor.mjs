// The component layer's coverage floor (apps/chat-mobile/jest.config.js): every
// file under components/ and the data layer's React hooks is measured, each
// held at the coverage it had when it was last recorded, and a file not yet
// recorded (a new screen part) falls under a global floor high enough that an
// untested one turns the run red. The floors only rise: --write takes the
// last jest run's summary and keeps, per file and measure, the higher of the
// recorded floor and today's (rounded down); a file that is gone leaves. A new
// file is recorded only once it meets the global floor — written down at what
// it has, an untested one would leave the global group for good — so --write
// fails and names it until it is tested. It also fails when a recorded file
// that still exists was not measured (a narrowed jest run), instead of
// dropping that file's floor.
//
//   pnpm --filter @uniwork/chat-mobile run test:components   (writes coverage/components/coverage-summary.json)
//   node scripts/mobile-coverage-floor.mjs --write
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
const APP = path.join(root, "apps/chat-mobile");
export const FLOOR_FILE = path.join(APP, "coverage-floor.json");
const SUMMARY = path.join(APP, "coverage/components/coverage-summary.json");
export const MEASURES = ["statements", "branches", "functions", "lines"];

/**
 * Per file, the higher of the recorded floor and the measured coverage; files no
 * longer measured leave. A file with no floor yet is recorded only when every
 * measure meets `global`; otherwise it is refused (sorted), and left out.
 */
export function raiseFloors(recorded, measured, global) {
  const files = {};
  const refused = [];
  for (const [file, pcts] of Object.entries(measured).sort(([a], [b]) => a.localeCompare(b))) {
    const before = recorded[file];
    if (!before && MEASURES.some((m) => pcts[m] < global[m])) {
      refused.push(file);
      continue;
    }
    files[file] = Object.fromEntries(MEASURES.map((m) => [m, Math.max(before?.[m] ?? 0, Math.floor(pcts[m]))]));
  }
  return { files, refused };
}

/** Recorded files that still exist in the app but are missing from `measured`: a partial run. */
export function unmeasured(recorded, measured, exists = (file) => fs.existsSync(path.join(APP, file))) {
  return Object.keys(recorded).filter((file) => !(file in measured) && exists(file));
}

/** jest's json-summary, keyed by the app-relative path, as pct per measure. */
export function measuredFrom(summary) {
  const out = {};
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    out[path.relative(APP, file).split(path.sep).join("/")] = Object.fromEntries(MEASURES.map((m) => [m, data[m].pct]));
  }
  return out;
}

if (process.argv.includes("--write")) {
  const floor = JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8"));
  const measured = measuredFrom(JSON.parse(fs.readFileSync(SUMMARY, "utf8")));
  const missing = unmeasured(floor.files, measured);
  if (missing.length > 0) {
    console.error(`not measured by the last run (run the whole test:components suite, not a part):\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  const { files, refused } = raiseFloors(floor.files, measured, floor.global);
  if (refused.length > 0) {
    console.error(`below the global floor ${JSON.stringify(floor.global)}, not recorded — test them first:\n  ${refused.join("\n  ")}`);
    process.exit(1);
  }
  floor.files = files;
  fs.writeFileSync(FLOOR_FILE, `${JSON.stringify(floor, null, 2)}\n`);
  console.log(`recorded ${Object.keys(floor.files).length} files in ${path.relative(root, FLOOR_FILE)}`);
}
