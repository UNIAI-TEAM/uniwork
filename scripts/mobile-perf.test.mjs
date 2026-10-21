// scripts/mobile-perf.mjs reads what adb prints; these are the shapes it
// prints on API 35, kept as fixtures, and the budget the numbers meet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { METRICS, check, launchToMark, median, parseAmStart, parseEpochLine, parseGfxinfo, parseMeminfo, table } from "./mobile-perf.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("reads Android's own time to the first frame from am start -W", () => {
  const out = "Starting: Intent { cmp=com.uniworkos.chat/.MainActivity }\nStatus: ok\nLaunchState: COLD\nActivity: com.uniworkos.chat/.MainActivity\nTotalTime: 1234\nWaitTime: 1240\nComplete\n";
  assert.equal(parseAmStart(out), 1234);
  assert.equal(parseAmStart("Error: Activity not started"), null);
});

test("reads a logcat -v epoch line, and nothing else", () => {
  assert.deepEqual(parseEpochLine("1729584000.123  1234  1250 I ActivityTaskManager: START u0 {cmp=a/.B} from uid 2000"), {
    ms: 1729584000123,
    tag: "ActivityTaskManager",
    message: "START u0 {cmp=a/.B} from uid 2000",
  });
  assert.equal(parseEpochLine("--------- beginning of main"), null);
});

test("times a launch to the app's mark, from the system's start of the activity or the process", () => {
  const log = [
    "--------- beginning of system",
    "1729584000.000  500  520 I ActivityTaskManager: START u0 {flg=0x10000000 cmp=com.uniworkos.chat/.MainActivity} from uid 2000",
    "1729584000.050  500  530 I ActivityManager: Start proc 4321:com.uniworkos.chat/u0a190 for next-top-activity {com.uniworkos.chat/.MainActivity}",
    "1729584001.900 4321 4400 I ReactNativeJS: UniChatPerf mark=first-screen",
    "1729584003.100 4321 4400 I ReactNativeJS: UniChatPerf mark=inbox",
  ].join("\n");
  assert.equal(launchToMark(log, "com.uniworkos.chat", "first-screen"), 1900);
  assert.equal(launchToMark(log, "com.uniworkos.chat", "inbox"), 3100);
  // Another app's launch is not this one's; a mark not logged yet is no time.
  assert.equal(launchToMark(log, "com.other.app", "inbox"), null);
  assert.equal(launchToMark(log, "com.uniworkos.chat", "settings"), null);
  // A process start alone (no START line kept) still times it.
  assert.equal(launchToMark(log.split("\n").slice(2).join("\n"), "com.uniworkos.chat", "first-screen"), 1850);
  // A mark before the launch (a previous run's) is not this launch's.
  assert.equal(launchToMark("1729584005.000 1 2 I ReactNativeJS: UniChatPerf mark=inbox\n1729584006.000 1 2 I ActivityTaskManager: START u0 {cmp=com.uniworkos.chat/.MainActivity}", "com.uniworkos.chat", "inbox"), null);
});

test("reads janky frames and the 90th percentile from gfxinfo, and the PSS from meminfo", () => {
  const gfx = [
    "Applications Graphics Acceleration Info:",
    "** Graphics info for pid 4321 [com.uniworkos.chat] **",
    "Stats since: 123456789ns",
    "Total frames rendered: 812",
    "Janky frames: 41 (5.05%)",
    "Janky frames (legacy): 60 (7.39%)",
    "50th percentile: 7ms",
    "90th percentile: 13ms",
    "95th percentile: 19ms",
    "99th percentile: 42ms",
  ].join("\n");
  assert.deepEqual(parseGfxinfo(gfx), { frames: 812, scrollJankyPercent: 5.05, scrollP90FrameMs: 13 });
  assert.deepEqual(parseGfxinfo("No process found for: com.uniworkos.chat"), { frames: 0, scrollJankyPercent: null, scrollP90FrameMs: null });
  assert.equal(parseMeminfo("App Summary\n...\n           TOTAL PSS:   215040            TOTAL RSS:   300000      TOTAL SWAP PSS:     0"), 210);
  assert.equal(parseMeminfo(" Native Heap    10000\n        TOTAL   102400   90000"), 100);
  assert.equal(parseMeminfo("No process found"), null);
});

test("takes the median of the runs, ignoring a run that measured nothing", () => {
  assert.equal(median([900, 1200, 1000, null, 1100]), 1050);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

test("holds only what was measured against its ceiling", () => {
  const { rows, over } = check({ coldStartTtidMs: 1500, coldStartFirstScreenMs: 7000, apkMB: 60.5 }, { coldStartTtidMs: 3000, coldStartFirstScreenMs: 6000 });
  assert.deepEqual(
    rows.map((r) => r.key),
    ["apkMB", "coldStartTtidMs", "coldStartFirstScreenMs"],
  );
  assert.deepEqual(
    over.map((r) => r.key),
    ["coldStartFirstScreenMs"],
  );
  const md = table(rows);
  assert.match(md, /\| cold start to the first screen \(ms\) \| 7000 \| 6000 \| \*\*over\*\* \|/);
  assert.match(md, /\| release APK, x86_64 \(MB\) \| 60\.5 \| – \| no ceiling \|/);
  assert.match(md, /\| cold start to first frame, Android's TotalTime \(ms\) \| 1500 \| 3000 \| 50% left \|/);
});

test("perf-budget.json has a ceiling for every metric, and nothing else", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/perf-budget.json"), "utf8"));
  assert.deepEqual(Object.keys(budget.android).sort(), METRICS.map(([key]) => key).sort());
  for (const [key, value] of Object.entries(budget.android)) assert.ok(typeof value === "number" && value > 0, `${key} is a positive number`);
});
