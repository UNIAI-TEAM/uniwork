// scripts/mobile-perf.mjs reads what adb prints; these are the shapes it
// prints on API 35, kept as fixtures, and the budget the numbers meet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  METRICS,
  PROFILES,
  CONTROL_ACTIVITY,
  QUIET_BUSY_PERCENT,
  QUIET_WAIT_MS,
  budgetOf,
  busyPercent,
  check,
  iosStartupRun,
  launchMarks,
  launchToMark,
  logLineAt,
  logStartArg,
  measureStartup,
  median,
  parseAmStart,
  parseEpochLine,
  parseGfxinfo,
  parseLaunchPid,
  parseLoadavg,
  parseMark,
  parseMeminfo,
  parseProcStat,
  spread,
  summarize,
  table,
  tighten,
} from "./mobile-perf.mjs";

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
  // TotalTime is not the splash: expo-splash-screen holds the activity's first frame until the splash lifts.
  assert.match(md, /\| cold start to Android's first frame, held until the splash lifts: TotalTime \(ms\) \| 1500 \| 3000 \| 50% left \|/);
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

test("reads the iOS marks file at the marks' own times, only once this launch has rewritten it", () => {
  // Each process rewrites the file whole, js-boot first: React Native's own marks may name moments before it.
  const file = ["UniChatPerf mark=js-boot at=1400", "UniChatPerf mark=rn-bundle-entry at=1050", "UniChatPerf mark=first-screen at=2600", "UniChatPerf mark=first-screen at=2700", "noise"].join("\n");
  assert.deepEqual(launchMarks(file, 1000), { "js-boot": 1400, "rn-bundle-entry": 1050, "first-screen": 2600 });
  // The previous launch's file, before this one's js-boot replaced it, is not this launch's.
  assert.deepEqual(launchMarks(file, 1500), {});
  assert.deepEqual(launchMarks("UniChatPerf mark=first-screen at=2600", 1000), {});
  assert.deepEqual(launchMarks("", 1000), {});
});

test("reads the pid simctl launch prints for the app, and nothing else", () => {
  assert.equal(parseLaunchPid("com.uniworkos.chat: 48213\n", "com.uniworkos.chat"), 48213);
  assert.equal(parseLaunchPid("An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=4)", "com.uniworkos.chat"), null);
  // The bundle id's dots are literal: another app's line is not this one's.
  assert.equal(parseLaunchPid("comXuniworkosXchat: 12\n", "com.uniworkos.chat"), null);
});

test("times an iOS launch from the process's start, and simctl's own part apart", () => {
  const marks = { "js-boot": 9000, "first-screen": 9600, "rn-bundle-entry": 8800.4 };
  assert.deepEqual(iosStartupRun({ mark: "first-screen", marks, launchedAt: 1000, processStart: 3200.25, reactFactoryAt: 3400 }), {
    launchOverheadMs: 2200,
    coldStartJsBootMs: 5800,
    coldStartFirstScreenMs: 6400,
    reactFactoryMs: 200,
    rnBundleEntryMs: 5600,
  });
  // A build without React Native's timing, a log without the factory's line: null, not a failed run.
  const bare = iosStartupRun({ mark: "inbox", marks: { "js-boot": 4000, inbox: 7000 }, launchedAt: 1000, processStart: 1500, reactFactoryAt: null });
  assert.deepEqual(bare, { launchOverheadMs: 500, coldStartJsBootMs: 2500, coldStartInboxMs: 5500, reactFactoryMs: null, rnBundleEntryMs: null });
  // React Native's mark is converted from another clock: one before the process or after js-boot is not this launch's.
  for (const at of [3000, 9000.5]) {
    const run = iosStartupRun({ mark: "first-screen", marks: { ...marks, "rn-bundle-entry": at }, launchedAt: 1000, processStart: 3200.25, reactFactoryAt: null });
    assert.equal(run.rnBundleEntryMs, null);
  }
  assert.equal(iosStartupRun({ mark: "first-screen", marks: { ...marks, "rn-bundle-entry": 9000 }, launchedAt: 1000, processStart: 3200.25, reactFactoryAt: null }).rnBundleEntryMs, 5800);
});

test("a result file keeps every run's value next to the medians, and check and tighten read it as before", () => {
  const result = summarize([
    { coldStartJsBootMs: 900, coldStartFirstScreenMs: 2000, reactFactoryMs: null },
    { coldStartJsBootMs: 1100, coldStartFirstScreenMs: 2400, reactFactoryMs: 300 },
    { coldStartJsBootMs: 1000, coldStartFirstScreenMs: 2200 },
  ]);
  assert.deepEqual(result, {
    coldStartJsBootMs: 1000,
    coldStartFirstScreenMs: 2200,
    reactFactoryMs: 300,
    runs: 3,
    samples: { coldStartJsBootMs: [900, 1100, 1000], coldStartFirstScreenMs: [2000, 2400, 2200], reactFactoryMs: [null, 300, null] },
  });
  const file = JSON.parse(JSON.stringify(result));
  assert.deepEqual(
    check(file, { coldStartJsBootMs: 4000, coldStartFirstScreenMs: 2100 }).over.map((r) => r.key),
    ["coldStartFirstScreenMs"],
  );
  assert.equal(tighten(Array.from({ length: 5 }, () => file), { coldStartFirstScreenMs: 6000 }).next.coldStartFirstScreenMs, 2530);
});

test("reads the factory's line of a compact unified log in local time, and asks log show from the launch's second", () => {
  const log = [
    "Timestamp               Ty Process[PID:TID]",
    "2026-10-23 03:44:02.014 Df UniChat[48213:1a2b] [com.apple.UIKit:Lifecycle] launch",
    "2026-10-23 03:44:02.389 I  UniChat[48213:1a2b] [com.facebook.react:native] -[RCTReactNativeFactory _setUpFeatureFlags]",
    "2026-10-23 03:44:03.000 I  UniChat[48213:1a2b] _setUpFeatureFlags again",
  ].join("\n");
  assert.equal(logLineAt(log, "_setUpFeatureFlags"), new Date(2026, 9, 23, 3, 44, 2, 389).getTime());
  assert.equal(logLineAt(log, "_setUpNothing"), null);
  assert.equal(logLineAt("mobile-perf: log show failed: _setUpFeatureFlags", "_setUpFeatureFlags"), null);
  const at = new Date(2026, 9, 23, 3, 44, 2, 900).getTime();
  const offset = -new Date(at).getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  assert.equal(logStartArg(at), `2026-10-23 03:44:02${zone}`);
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

test("reads the device's CPU between two /proc/stat reads, and its 1-minute load", () => {
  const before = parseProcStat("cpu  100 10 40 800 50 0 0 0 0 0\ncpu0 50 5 20 400 25 0 0 0 0 0\nintr 1 2 3\n");
  // Busy is user + nice + system + irq + softirq + steal; idle and iowait are not.
  assert.deepEqual(before, { busy: 150, total: 1000 });
  const after = parseProcStat("cpu  130 10 50 860 50 0 0 0 0 0\n");
  assert.equal(busyPercent(before, after), 40);
  assert.equal(busyPercent(before, before), null, "no time passed");
  assert.equal(busyPercent(null, after), null);
  assert.equal(parseProcStat("intr 1 2 3"), null);
  assert.equal(parseLoadavg("1.52 2.04 2.50 3/412 4321\n"), 1.52);
  assert.equal(parseLoadavg(""), null);
});

/**
 * An emulator as `adb` sees it: each `cat /proc/stat` advances 100 jiffies, busy by the next share of `busy` (the last
 * repeats); each launch of the app logs its START line and both marks, its TotalTime counting up from 1900.
 */
function fakeDevice({ busy = [10] } = {}) {
  const calls = [];
  let jiffies = { busy: 0, idle: 0 };
  let reads = 0;
  let launches = 0;
  let log = "";
  const adb = (...args) => {
    const cmd = args.join(" ");
    calls.push(cmd);
    if (cmd.startsWith("shell cmd package resolve-activity")) return "priority=0 preferredOrder=0\ncom.uniworkos.chat/.MainActivity\n";
    if (cmd === "shell cat /proc/stat") {
      const share = busy[Math.min(reads, busy.length - 1)];
      reads += 1;
      jiffies = { busy: jiffies.busy + share, idle: jiffies.idle + 100 - share };
      return `cpu  ${jiffies.busy} 0 0 ${jiffies.idle} 0 0 0 0 0 0\n`;
    }
    if (cmd === "shell cat /proc/loadavg") return "1.50 2.00 2.50 1/300 4321\n";
    if (cmd === "shell am start -W -n com.uniworkos.chat/.MainActivity") {
      launches += 1;
      const t = 1729584000 + launches * 100;
      log = [
        `${t}.000  500  520 I ActivityTaskManager: START u0 {cmp=com.uniworkos.chat/.MainActivity} from uid 2000`,
        `${t}.900 4321 4400 I ReactNativeJS: UniChatPerf mark=js-boot at=${t * 1000 + 600 + launches}`,
        `${t}.950 4321 4400 I ReactNativeJS: UniChatPerf mark=first-screen at=${t * 1000 + 1800 + launches}`,
      ].join("\n");
      return `Status: ok\nLaunchState: COLD\nTotalTime: ${1900 + launches}\nComplete\n`;
    }
    if (cmd === `shell am start -W -n ${CONTROL_ACTIVITY}`) return "Status: ok\nTotalTime: 700\nComplete\n";
    if (cmd === "logcat -c") log = "";
    if (cmd.startsWith("logcat -d")) return log;
    if (cmd.startsWith("shell cmd package compile")) return "Success\n";
    return "";
  };
  return { adb, sleep: async () => {}, calls };
}

// The third flake of UNI-2142: TotalTime 3092 over 3000 on a commit that did not touch the app. Within one run a launch
// varied by ~28 % (busy emulator just after boot), so each timed launch now starts on a settled device, from a fixed
// compile state, after a launch that is not timed, beside a control app that shares the device's speed.
test("a cold-start run warms up untimed, fixes the compile state, settles the CPU before each launch and times a control app", async () => {
  const device = fakeDevice();
  const result = await measureStartup("com.uniworkos.chat", "first-screen", 3, device);
  const launches = device.calls.flatMap((c, i) => (c === "shell am start -W -n com.uniworkos.chat/.MainActivity" ? [i] : []));
  const compile = device.calls.indexOf("shell cmd package compile -f -m speed-profile com.uniworkos.chat");
  assert.equal(launches.length, 4, "one warm-up and three timed launches");
  assert.ok(compile > launches[0] && compile < launches[1], "compiled after the warm-up, before the first timed launch");
  // Only the timed launches count: the warm-up's TotalTime (1901) is in no sample.
  assert.equal(result.runs, 3);
  assert.deepEqual(result.samples.coldStartTtidMs, [1902, 1903, 1904]);
  assert.deepEqual(result.samples.coldStartFirstScreenMs, [1802, 1803, 1804]);
  assert.deepEqual(result.samples.coldStartJsBootMs, [602, 603, 604]);
  // Each timed launch follows a CPU read after the last force-stop.
  for (const at of launches.slice(1)) {
    const stop = device.calls.lastIndexOf("shell am force-stop com.uniworkos.chat", at);
    assert.ok(device.calls.slice(stop, at).includes("shell cat /proc/stat"), `the launch at call ${at} waited for a settled CPU`);
  }
  assert.deepEqual(result.samples.cpuBusyPercent, [10, 10, 10]);
  assert.deepEqual(result.samples.loadavg1, [1.5, 1.5, 1.5]);
  assert.deepEqual(result.samples.controlTtidMs, [700, 700, 700]);
  assert.equal(result.coldStartTtidMs, 1903);
  assert.deepEqual(result.setup, { warmUp: true, compile: "Success" });
});

test("a busy device delays the launch until it settles, and never for longer than the cap", async () => {
  const settling = await measureStartup("com.uniworkos.chat", "first-screen", 1, fakeDevice({ busy: [10, 90, 80, 15] }));
  // The first read is the baseline; 90 % then 80 % busy windows wait, the 15 % one lets the launch go.
  assert.ok(QUIET_BUSY_PERCENT >= 15 && QUIET_BUSY_PERCENT < 80);
  assert.deepEqual(settling.samples.cpuBusyPercent, [15]);
  assert.deepEqual(settling.samples.settleMs, [3000]);
  const busy = await measureStartup("com.uniworkos.chat", "first-screen", 1, fakeDevice({ busy: [95] }));
  assert.deepEqual(busy.samples.cpuBusyPercent, [95], "a device that never settles is still timed, and says how busy it was");
  assert.deepEqual(busy.samples.settleMs, [QUIET_WAIT_MS]);
});

test("the summary shows each start metric's spread over the runs and the control's, beside the medians", () => {
  const result = summarize([
    { coldStartTtidMs: 2100, coldStartFirstScreenMs: 1950, controlTtidMs: 700, cpuBusyPercent: 12 },
    { coldStartTtidMs: 3300, coldStartFirstScreenMs: 3150, controlTtidMs: 1100, cpuBusyPercent: 30 },
    { coldStartTtidMs: 2400, coldStartFirstScreenMs: 2250, controlTtidMs: 800, cpuBusyPercent: 18 },
  ]);
  const lines = spread({ apkMB: 60.1, ...result });
  assert.ok(lines.includes("- cold start to Android's first frame, held until the splash lifts: TotalTime (ms): 2100–3300 over 3 runs (median 2400)"), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("- control app (Settings) cold start, TotalTime (ms): 700–1100 over 3 runs")));
  assert.ok(lines.some((l) => l.startsWith("- device CPU busy before each launch (%): 12–30 over 3 runs")));
  assert.ok(!lines.some((l) => l.includes("APK")), "a number with no samples has no spread");
});

// TotalTime is held until the splash lifts, right before the first-screen mark; js-boot comes before both. A TotalTime
// ceiling under the first screen's gated the same moment twice, the tighter one by accident (3000 against 6000 flaked).
// android-2gb is a guess the nightly has not measured yet: it is set from its own runs, not by analogy.
test("perf-budget.json › android: the start ceilings follow the order of the moments they time", () => {
  const { android } = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/perf-budget.json"), "utf8"));
  assert.ok(android.coldStartJsBootMs <= android.coldStartFirstScreenMs, "js-boot before the first screen");
  assert.ok(android.coldStartFirstScreenMs <= android.coldStartTtidMs, "the first screen before the lifted splash's frame");
});
