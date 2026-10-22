// scripts/mobile-perf.mjs reads what adb prints; these are the shapes it
// prints on API 35, kept as fixtures, and the budget the numbers meet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { METRICS, PROFILES, budgetOf, check, launchToMark, marksSince, median, parseAmStart, parseEpochLine, parseGfxinfo, parseMark, parseMeminfo, table, tighten } from "./mobile-perf.mjs";

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

test("a mark's line names it, with its own time when the build says it", () => {
  assert.deepEqual(parseMark("UniChatPerf mark=js-boot at=1729584000420"), { name: "js-boot", at: 1729584000420 });
  assert.deepEqual(parseMark("UniChatPerf mark=first-screen"), { name: "first-screen", at: null });
  assert.equal(parseMark("Running \"main\""), null);
});

test("a mark that carries its time is timed by it, not by when it was logged", () => {
  // js-boot is logged once boot turns the marks on, after the moment it names.
  const log = [
    "1729584000.000  500  520 I ActivityTaskManager: START u0 {cmp=com.uniworkos.chat/.MainActivity} from uid 2000",
    "1729584001.300 4321 4400 I ReactNativeJS: UniChatPerf mark=js-boot at=1729584000650",
    "1729584001.900 4321 4400 I ReactNativeJS: UniChatPerf mark=first-screen at=1729584001880",
  ].join("\n");
  assert.equal(launchToMark(log, "com.uniworkos.chat", "js-boot"), 650);
  assert.equal(launchToMark(log, "com.uniworkos.chat", "first-screen"), 1880);
});

test("reads the iOS marks file against the host's launch time, ignoring an earlier launch's marks", () => {
  const file = ["UniChatPerf mark=js-boot at=900", "UniChatPerf mark=js-boot at=1400", "UniChatPerf mark=first-screen at=2600", "noise"].join("\n");
  assert.deepEqual(marksSince(file, 1000), { "js-boot": 400, "first-screen": 1600 });
  assert.deepEqual(marksSince("", 1000), {});
});

test("tightens each ceiling to the worst of five runs + 15 %, never upward, and keeps one with too few runs", () => {
  const runs = [
    { coldStartTtidMs: 1000, coldStartFirstScreenMs: 2000, apkMB: 60.1 },
    { coldStartTtidMs: 1100, coldStartFirstScreenMs: 2100, apkMB: 60.1 },
    { coldStartTtidMs: 1200, coldStartFirstScreenMs: 2050, apkMB: 60.2 },
    { coldStartTtidMs: 1050, coldStartFirstScreenMs: 2200, apkMB: 60.2 },
    { coldStartTtidMs: 1150, coldStartFirstScreenMs: 2000 },
  ];
  const { rows, next, complete } = tighten(runs, { coldStartTtidMs: 3000, coldStartFirstScreenMs: 2400, apkMB: 90 });
  assert.equal(next.coldStartTtidMs, 1380, "1200 × 1.15");
  assert.equal(next.coldStartFirstScreenMs, 2400, "2200 × 1.15 = 2530 is above the ceiling: kept");
  assert.equal(next.apkMB, 90, "four runs measured the APK: kept");
  assert.equal(complete, false);
  assert.deepEqual(rows.find((r) => r.key === "apkMB"), { key: "apkMB", runs: 4, from: 90, to: 90, worst: null });
  // Tenths for MB and percent, rounded up.
  const mb = tighten(Array.from({ length: 5 }, () => ({ apkMB: 60.04, scrollJankyPercent: 4.01 })), { apkMB: 90, scrollJankyPercent: 30 });
  assert.deepEqual(mb.next, { apkMB: 69.1, scrollJankyPercent: 4.7 });
  assert.equal(mb.complete, true);
});

test("a profile the budget does not have is an error, not a run with no ceiling", () => {
  assert.throws(() => budgetOf({ android: {} }, "android-1gb"), /no profile "android-1gb"/);
  assert.throws(() => budgetOf({ android: {} }, "ios-simulator"), /no profile "ios-simulator"/);
  assert.deepEqual(budgetOf({ android: { apkMB: 1 } }, "android"), { apkMB: 1 });
});

test("perf-budget.json: android has a ceiling for every metric, the other profiles a subset, and nothing else", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/perf-budget.json"), "utf8"));
  const keys = METRICS.map(([key]) => key);
  assert.deepEqual(Object.keys(budget.android).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(budget).filter((k) => !["_", "provisional", "provisionalUntil"].includes(k)).sort(), [...PROFILES].sort());
  for (const profile of PROFILES) {
    for (const [key, value] of Object.entries(budget[profile])) {
      assert.ok(keys.includes(key), `${profile}.${key} is a metric`);
      assert.ok(typeof value === "number" && value > 0, `${profile}.${key} is a positive number`);
    }
  }
  for (const p of budget.provisional) assert.ok(PROFILES.includes(p), `provisional names a profile: ${p}`);
});

// Audit "perf-budgets-uncalibrated": the ceilings were set before any run measured the app. They are debt with a date:
// past it, a profile still provisional fails here until `tighten --write` sets it from five measured runs.
test("perf-budget.json: provisional ceilings have a deadline, and none outlives it", () => {
  const budget = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/perf-budget.json"), "utf8"));
  if ((budget.provisional ?? []).length === 0) return;
  assert.match(budget.provisionalUntil ?? "", /^\d{4}-\d{2}-\d{2}$/, "provisional profiles name the day they must be measured by");
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(today <= budget.provisionalUntil, `still provisional after ${budget.provisionalUntil}: ${budget.provisional.join(", ")} — run tighten (runbook › Đo hiệu năng trên thiết bị)`);
});
