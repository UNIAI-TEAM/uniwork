#!/usr/bin/env node
// UniChat mobile on a device (audit P1 Perf): cold start, frames while
// scrolling a long room, memory and the APK, measured on the CI emulator and
// held against apps/chat-mobile/perf-budget.json. Blocks at every GATE_LEVEL,
// like the bundle budget (mobile-bundle-budget.mjs).
//
//   node scripts/mobile-perf.mjs startup --package <id> --mark <name> [--runs 5] --out <file>
//       Cold-starts the app `runs` times (force-stop, then `am start -W`) and
//       records the median of two times: Android's own time to the first
//       frame (TotalTime: the splash), and the time from the launch to the
//       app's startup mark `name` in the device log ("first-screen": the
//       first screen drawn under the lifted splash; "inbox": the chat list
//       drawn for a signed-in account). The marks are logged only by a build
//       made with UNICHAT_PERF_MARKS=1 (data/logger.ts › perfMark).
//   node scripts/mobile-perf.mjs frames --package <id> --out <file>
//       Reads `dumpsys gfxinfo` (reset it before the flow it measures) and
//       `dumpsys meminfo`: janky frames, the 90th percentile frame time, PSS.
//   node scripts/mobile-perf.mjs apk <apk> --out <file>
//   node scripts/mobile-perf.mjs check <file>...
//       Every measured number against its ceiling; a number nobody measured
//       is not checked. Exits 1 when one is over.
//
// The emulator is not a phone: these numbers guard against regressions on a
// fixed profile (API 35, x86_64, KVM), they do not say how a mid-range
// Android feels. Release health in production is Sentry's (app start, TTFD,
// slow and frozen frames; docs/runbooks/unichat-mobile-release.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const BUDGET_FILE = path.join(root, "apps/chat-mobile/perf-budget.json");

export const METRICS = [
  ["apkMB", "release APK, x86_64 (MB)"],
  ["coldStartTtidMs", "cold start to first frame, Android's TotalTime (ms)"],
  ["coldStartFirstScreenMs", "cold start to the first screen (ms)"],
  ["coldStartInboxMs", "cold start to the inbox, signed in (ms)"],
  ["scrollJankyPercent", "janky frames scrolling a long room (%)"],
  ["scrollP90FrameMs", "90th percentile frame scrolling a long room (ms)"],
  ["memoryPssMB", "memory after the scroll, PSS (MB)"],
];

/** `am start -W` output: Android's time to the activity's first frame. */
export function parseAmStart(text) {
  const total = /TotalTime:\s*(\d+)/.exec(text);
  return total ? Number(total[1]) : null;
}

/** One `logcat -v epoch` line: its time in ms, tag and message; null for anything else. */
export function parseEpochLine(line) {
  const match = /^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[VDIWEF]\s+(.+?)\s*:\s(.*)$/.exec(line);
  return match ? { ms: Math.round(Number(match[1]) * 1000), tag: match[2], message: match[3] } : null;
}

/**
 * Launch to mark, in ms, from one launch's `logcat -v epoch`: the system's
 * start of the activity (or of the process) for `pkg`, then the app's line
 * `UniChatPerf mark=<mark>`. Null while either is missing.
 */
export function launchToMark(log, pkg, mark) {
  let launch = null;
  let marked = null;
  for (const line of log.split("\n")) {
    const entry = parseEpochLine(line);
    if (!entry) continue;
    const launching = (/^START u\d+ /.test(entry.message) || /^Start proc /.test(entry.message)) && entry.message.includes(pkg);
    if (launching && launch === null) launch = entry.ms;
    if (entry.message.includes(`UniChatPerf mark=${mark}`) && marked === null) marked = entry.ms;
  }
  return launch !== null && marked !== null && marked >= launch ? marked - launch : null;
}

/** `dumpsys gfxinfo <pkg>`: janky frames as a percentage and the 90th percentile frame time. */
export function parseGfxinfo(text) {
  const frames = /Total frames rendered:\s*(\d+)/.exec(text);
  const janky = /Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(text);
  const p90 = /90th percentile:\s*(\d+)ms/.exec(text);
  return {
    frames: frames ? Number(frames[1]) : 0,
    scrollJankyPercent: janky ? Number(janky[1]) : null,
    scrollP90FrameMs: p90 ? Number(p90[1]) : null,
  };
}

/** `dumpsys meminfo <pkg>`: the app's total PSS in MB. */
export function parseMeminfo(text) {
  const pss = /TOTAL PSS:\s*(\d+)/.exec(text) ?? /^\s*TOTAL\s+(\d+)/m.exec(text);
  return pss ? Math.round((Number(pss[1]) / 1024) * 10) / 10 : null;
}

export function median(values) {
  const sorted = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Each measured number against its ceiling; `over` lists what broke one. */
export function check(measured, budget) {
  const rows = METRICS.filter(([key]) => typeof measured[key] === "number").map(([key, label]) => {
    const value = measured[key];
    const ceiling = budget[key];
    return { key, label, value, ceiling, over: typeof ceiling === "number" && value > ceiling };
  });
  return { rows, over: rows.filter((row) => row.over) };
}

export function table(rows) {
  const lines = ["| | measured | ceiling | |", "| --- | ---: | ---: | --- |"];
  for (const r of rows) {
    const ceiling = typeof r.ceiling === "number" ? String(r.ceiling) : "–";
    const note = r.over ? "**over**" : typeof r.ceiling === "number" ? `${(((r.ceiling - r.value) / r.ceiling) * 100).toFixed(0)}% left` : "no ceiling";
    lines.push(`| ${r.label} | ${Number.isInteger(r.value) ? r.value : r.value.toFixed(1)} | ${ceiling} | ${note} |`);
  }
  return lines.join("\n");
}

function adb(...args) {
  return execFileSync("adb", args, { encoding: "utf8" });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The launcher activity of `pkg`, as `cmd package resolve-activity` names it. */
function launcherActivity(pkg) {
  const out = adb("shell", "cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LAUNCHER", pkg);
  const component = out.trim().split("\n").at(-1);
  if (!component?.includes("/")) throw new Error(`mobile-perf: no launcher activity for ${pkg}`);
  return component;
}

async function measureStartup(pkg, mark, runs) {
  const activity = launcherActivity(pkg);
  const ttid = [];
  const toMark = [];
  for (let run = 0; run < runs; run += 1) {
    adb("shell", "am", "force-stop", pkg);
    await sleep(1000);
    adb("logcat", "-c");
    ttid.push(parseAmStart(adb("shell", "am", "start", "-W", "-n", activity)));
    let ms = null;
    for (let waited = 0; ms === null && waited < 60_000; waited += 250) {
      await sleep(250);
      ms = launchToMark(adb("logcat", "-d", "-v", "epoch", "ActivityTaskManager:I", "ActivityManager:I", "ReactNativeJS:I", "*:S"), pkg, mark);
    }
    if (ms === null) throw new Error(`mobile-perf: no "UniChatPerf mark=${mark}" within 60 s of launch ${run + 1} (is the build made with UNICHAT_PERF_MARKS=1?)`);
    toMark.push(ms);
  }
  const key = mark === "inbox" ? "coldStartInboxMs" : "coldStartFirstScreenMs";
  return { coldStartTtidMs: median(ttid), [key]: median(toMark), runs };
}

function measureFrames(pkg) {
  const frames = parseGfxinfo(adb("shell", "dumpsys", "gfxinfo", pkg));
  if (frames.frames === 0) throw new Error(`mobile-perf: gfxinfo counted no frame for ${pkg}; did the flow run?`);
  return { scrollJankyPercent: frames.scrollJankyPercent, scrollP90FrameMs: frames.scrollP90FrameMs, memoryPssMB: parseMeminfo(adb("shell", "dumpsys", "meminfo", pkg)), frames: frames.frames };
}

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
}

async function main(argv) {
  const [command, ...args] = argv;
  const out = option(args, "out");
  const write = (result) => {
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  };
  if (command === "startup") return write(await measureStartup(option(args, "package"), option(args, "mark", "first-screen"), Number(option(args, "runs", "5"))));
  if (command === "frames") return write(measureFrames(option(args, "package")));
  if (command === "apk") return write({ apkMB: Math.round((fs.statSync(args[0]).size / 1048576) * 10) / 10 });
  if (command === "check") {
    const files = args.filter((arg) => !arg.startsWith("--"));
    const measured = Object.assign({}, ...files.map((file) => JSON.parse(fs.readFileSync(file, "utf8"))));
    const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")).android;
    const { rows, over } = check(measured, budget);
    const report = `### UniChat Android on the emulator\n\n${table(rows)}\n`;
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    for (const r of over) console.log(`::error::${r.label} ${r.value} is over the ceiling ${r.ceiling} (apps/chat-mobile/perf-budget.json)`);
    return over.length > 0 ? process.exit(1) : undefined;
  }
  console.error("usage: node scripts/mobile-perf.mjs startup|frames|apk|check … (see the header)");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
