// The component layer's coverage floor (apps/chat-mobile/jest.config.js): every
// file under components/ and the data layer's React hooks is measured, each
// held at the coverage it had when it was last recorded, and a file not yet
// recorded (a new screen part) falls under a global floor high enough that an
// untested one turns the run red. The floors only rise: --write takes the
// last jest run's summary and keeps, per file and measure, the higher of the
// recorded floor and today's (rounded down); a file that is gone leaves.
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

/** Per file, the higher of the recorded floor and the measured coverage; files no longer measured leave. */
export function raiseFloors(recorded, measured) {
  const files = {};
  for (const [file, pcts] of Object.entries(measured).sort(([a], [b]) => a.localeCompare(b))) {
    const before = recorded[file] ?? {};
    files[file] = Object.fromEntries(MEASURES.map((m) => [m, Math.max(before[m] ?? 0, Math.floor(pcts[m]))]));
  }
  return files;
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
  const summary = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
  floor.files = raiseFloors(floor.files, measuredFrom(summary));
  fs.writeFileSync(FLOOR_FILE, `${JSON.stringify(floor, null, 2)}\n`);
  console.log(`recorded ${Object.keys(floor.files).length} files in ${path.relative(root, FLOOR_FILE)}`);
}
