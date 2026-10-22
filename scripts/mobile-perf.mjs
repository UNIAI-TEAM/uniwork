#!/usr/bin/env node
// UniChat mobile on a device (audit P1 Perf): cold start, frames while
// scrolling a long room, memory and the APK, measured on the CI emulator and
// simulator and held against apps/chat-mobile/perf-budget.json. Blocks at
// every GATE_LEVEL, like the bundle budget (mobile-bundle-budget.mjs).
//
//   node scripts/mobile-perf.mjs startup --package <id> --mark <name> [--runs 5] --out <file>
//       Cold-starts the app `runs` times (force-stop, then `am start -W`) and
//       records the median of three times: Android's own time to the first
//       frame (TotalTime: the splash), the time from the launch to the
//       bundle's first line ("js-boot": native start before it, the
//       JavaScript graph and boot after it), and the time from the launch to
//       the app's startup mark `name` in the device log ("first-screen": the
//       first screen drawn under the lifted splash; "inbox": the chat list
//       drawn for a signed-in account), each with every run's value under
//       "samples". The marks are logged only by a build made with
//       UNICHAT_PERF_MARKS=1 (data/logger.ts › perfMark).
//   node scripts/mobile-perf.mjs ios-startup --udid <sim> --bundle <id> --mark <name> [--runs 5] --out <file>
//       The same on an iOS simulator (terminate, then `simctl launch`), timed
//       from the kernel's start of the app's process to the marks the build
//       writes to its documents (data/perf/marks-file.ts: iOS's release log
//       drops console.info). The simulator's app is a process of the host, so
//       its start (sysctl) and its marks (Date.now) are on the host's clock;
//       `simctl launch` itself is reported apart (launchOverheadMs), as are
//       the moment React Native began evaluating the bundle (rn-bundle-entry)
//       and, from each run's unified log saved beside --out
//       (ios-startup-run<N>.log), the React factory.
//   node scripts/mobile-perf.mjs frames --package <id> --out <file>
//       Reads `dumpsys gfxinfo` (reset it before the flow it measures) and
//       `dumpsys meminfo`: janky frames, the 90th percentile frame time, PSS.
//   node scripts/mobile-perf.mjs apk <apk> --out <file>
//   node scripts/mobile-perf.mjs check [--profile <name>] <file>...
//       Every measured number against its ceiling in the profile (android,
//       the default: the API 35 emulator; android-2gb: the same with 2 GB of
//       RAM, a low-end phone; ios-simulator); a number nobody measured is not
//       checked. Exits 1 when one is over.
//   node scripts/mobile-perf.mjs tighten --profile <name> [--write] <file>...
//       The rule perf-budget.json states, done by the script: from at least
//       five runs' result files (the jobs upload them as `unichat-perf-*`
//       artifacts), each ceiling becomes the worst run + 15 %, never higher
//       than it was; --write saves it and marks the profile measured.
//
// The emulator is not a phone: these numbers guard against regressions on a
// fixed profile (API 35, x86_64, KVM), they do not say how a mid-range
// Android feels. Release health in production is Sentry's (app start, TTFD,
// slow and frozen frames, and a profile on 5 % of sessions;
// docs/runbooks/unichat-mobile-release.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const BUDGET_FILE = path.join(root, "apps/chat-mobile/perf-budget.json");

export const METRICS = [
  ["apkMB", "release APK, x86_64 (MB)"],
  ["coldStartTtidMs", "cold start to first frame, Android's TotalTime (ms)"],
  ["coldStartJsBootMs", "cold start to the bundle's first line (ms)"],
  ["coldStartFirstScreenMs", "cold start to the first screen (ms)"],
  ["coldStartInboxMs", "cold start to the inbox, signed in (ms)"],
  ["scrollJankyPercent", "janky frames scrolling a long room (%)"],
  ["scrollP90FrameMs", "90th percentile frame scrolling a long room (ms)"],
  ["memoryPssMB", "memory after the scroll, PSS (MB)"],
];

/** The profiles of perf-budget.json: where each set of ceilings was measured. */
export const PROFILES = ["android", "android-2gb", "ios-simulator"];
/** Runs a ceiling is set from, and the room left above the worst of them (the emulator is noisy). */
export const TIGHTEN_MIN_RUNS = 5;
export const TIGHTEN_MARGIN = 0.15;

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

/** A mark's line: `UniChatPerf mark=<name>`, with the mark's own time (`at=<epoch ms>`) when the build says it. */
export function parseMark(message) {
  const match = /UniChatPerf mark=([\w-]+)(?: at=(\d+))?/.exec(message);
  return match ? { name: match[1], at: match[2] ? Number(match[2]) : null } : null;
}

/**
 * Launch to mark, in ms, from one launch's `logcat -v epoch`: the system's
 * start of the activity (or of the process) for `pkg`, then the app's line
 * `UniChatPerf mark=<mark>`, at the time it carries or else the line's.
 * Null while either is missing.
 */
export function launchToMark(log, pkg, mark) {
  let launch = null;
  let marked = null;
  for (const line of log.split("\n")) {
    const entry = parseEpochLine(line);
    if (!entry) continue;
    const launching = (/^START u\d+ /.test(entry.message) || /^Start proc /.test(entry.message)) && entry.message.includes(pkg);
    if (launching && launch === null) launch = entry.ms;
    const found = parseMark(entry.message);
    if (found?.name === mark && marked === null) marked = found.at ?? entry.ms;
  }
  return launch !== null && marked !== null && marked >= launch ? marked - launch : null;
}

/**
 * The marks of a marks file (data/perf/marks-file.ts) at their own times (epoch ms), when the file is this launch's:
 * each process rewrites it whole, js-boot first, so a js-boot at or after the launch (host epoch ms) makes every line
 * this process's. An earlier launch's file, or one not written yet, has no marks.
 */
export function launchMarks(text, launchedAt) {
  const marks = {};
  for (const line of text.split("\n")) {
    const found = parseMark(line);
    if (found?.at != null && !(found.name in marks)) marks[found.name] = found.at;
  }
  return marks["js-boot"] !== undefined && marks["js-boot"] >= launchedAt ? marks : {};
}

/** The pid `simctl launch` prints for `bundle` ("com.uniworkos.chat: 4321"); null when it printed none. */
export function parseLaunchPid(text, bundle) {
  const escaped = bundle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(\\d+)\\s*$`, "m").exec(text);
  return match ? Number(match[1]) : null;
}

/** `log show --start` in the host's local time with its offset ('Y-M-D H:m:s+zzzz'), floored to the second. */
export function logStartArg(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`;
}

/**
 * The time (epoch ms) of the first line of a `log show --style compact` log that contains `needle`, read in the
 * host's local time zone (the simulator's, which it inherits); null when no line does.
 */
export function logLineAt(log, needle) {
  for (const line of log.split("\n")) {
    if (!line.includes(needle)) continue;
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(line);
    if (match) {
      const [y, mo, d, h, mi, sec, ms] = match.slice(1).map(Number);
      return new Date(y, mo - 1, d, h, mi, sec, ms).getTime();
    }
  }
  return null;
}

/**
 * React Native's bundle-entry mark (data/logger.ts › enablePerfMarks), only where it can be: after the process
 * started and no later than js-boot. Its time is converted from another clock than the other marks, so one outside
 * that window is a conversion gone wrong, not a moment of this launch.
 */
function bundleEntryAt(marks, processStart) {
  const at = marks["rn-bundle-entry"];
  const boot = marks["js-boot"];
  return typeof at === "number" && typeof boot === "number" && at >= processStart && at <= boot ? at : null;
}

/**
 * One iOS launch, every time from the kernel's start of the app's process (epoch ms, fractional): the bundle's first
 * line, the mark `mark`, the React factory and the moment React Native began evaluating the bundle (null when absent),
 * and the time `simctl launch` took to start the process (launchOverheadMs, from the host's clock before it ran).
 */
export function iosStartupRun({ mark, marks, launchedAt, processStart, reactFactoryAt }) {
  const since = (at) => (typeof at === "number" ? Math.round(at - processStart) : null);
  const run = { launchOverheadMs: Math.round(processStart - launchedAt), coldStartJsBootMs: since(marks["js-boot"]), [markKey(mark)]: since(marks[mark]) };
  run.reactFactoryMs = since(reactFactoryAt);
  run.rnBundleEntryMs = since(bundleEntryAt(marks, processStart));
  return run;
}

/** One result file from the runs: each number's median, the run count, and every run's value under `samples` (null where a run had none). */
export function summarize(perRun) {
  const keys = [...new Set(perRun.flatMap((run) => Object.keys(run)))];
  const medians = Object.fromEntries(keys.map((key) => [key, median(perRun.map((run) => run[key]))]));
  const samples = Object.fromEntries(keys.map((key) => [key, perRun.map((run) => run[key] ?? null)]));
  return { ...medians, runs: perRun.length, samples };
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

/** A ceiling's precision: whole ms, tenths of a MB or a percent; always rounded up. */
function roundUp(key, value) {
  return /Ms$/.test(key) ? Math.ceil(value) : Math.ceil(value * 10) / 10;
}

/**
 * Each ceiling of `budget` set from `runs` (one result file each, as the jobs write them): the worst
 * run + TIGHTEN_MARGIN, rounded up, and never above the ceiling it replaces. A metric with fewer than
 * TIGHTEN_MIN_RUNS measurements keeps its ceiling, and says so.
 */
export function tighten(runs, budget) {
  const next = { ...budget };
  const rows = Object.keys(budget).map((key) => {
    const values = runs.map((run) => run[key]).filter((v) => typeof v === "number");
    if (values.length < TIGHTEN_MIN_RUNS) return { key, runs: values.length, from: budget[key], to: budget[key], worst: null };
    const worst = Math.max(...values);
    const to = Math.min(budget[key], roundUp(key, worst * (1 + TIGHTEN_MARGIN)));
    next[key] = to;
    return { key, runs: values.length, from: budget[key], to, worst };
  });
  return { rows, next, complete: rows.every((row) => row.worst !== null) };
}

/** The ceilings of one profile of perf-budget.json; a profile it does not have is an error, not "no ceiling". */
export function budgetOf(file, profile) {
  const ceilings = file[profile];
  if (!PROFILES.includes(profile) || !ceilings) throw new Error(`mobile-perf: perf-budget.json has no profile "${profile}" (${PROFILES.join(", ")})`);
  return ceilings;
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
  const perRun = [];
  for (let run = 0; run < runs; run += 1) {
    adb("shell", "am", "force-stop", pkg);
    await sleep(1000);
    adb("logcat", "-c");
    const ttid = parseAmStart(adb("shell", "am", "start", "-W", "-n", activity));
    let ms = null;
    for (let waited = 0; ms === null && waited < 60_000; waited += 250) {
      await sleep(250);
      ms = launchToMark(adb("logcat", "-d", "-v", "epoch", "ActivityTaskManager:I", "ActivityManager:I", "ReactNativeJS:I", "*:S"), pkg, mark);
    }
    if (ms === null) throw new Error(`mobile-perf: no "UniChatPerf mark=${mark}" within 60 s of launch ${run + 1} (is the build made with UNICHAT_PERF_MARKS=1?)`);
    const toBoot = launchToMark(adb("logcat", "-d", "-v", "epoch", "ActivityTaskManager:I", "ActivityManager:I", "ReactNativeJS:I", "*:S"), pkg, "js-boot");
    perRun.push({ coldStartTtidMs: ttid, coldStartJsBootMs: toBoot, [markKey(mark)]: ms });
  }
  return summarize(perRun);
}

const markKey = (mark) => (mark === "inbox" ? "coldStartInboxMs" : "coldStartFirstScreenMs");

function simctl(...args) {
  return execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8" });
}

// A Release launch logs a lot at info level, and `log show` can stall in a fresh simulator: a cap well above one
// launch and a time limit, so the capture (attribution only) fails instead of failing or hanging the step.
const LOG_SHOW_LIMITS = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 };

/** The app's data container, where its documents (and the marks file) live; null when simctl cannot name it yet. */
function dataContainer(udid, bundle) {
  try {
    return simctl("get_app_container", udid, bundle, "data").trim() || null;
  } catch {
    return null;
  }
}

// The kernel's start of a host process, from sysctl(CTL_KERN, KERN_PROC, KERN_PROC_PID): kp_proc.p_starttime is the
// struct timeval at offset 0 of struct extern_proc, the first member of kinfo_proc (sys/proc.h, sys/sysctl.h; 64-bit
// macOS: tv_sec int64, tv_usec int32). A pid with no process returns no bytes.
const PROCESS_START_PY = `
import ctypes, struct, sys
libc = ctypes.CDLL(None, use_errno=True)
mib = (ctypes.c_int * 4)(1, 14, 1, int(sys.argv[1]))
buf = ctypes.create_string_buffer(1024)
size = ctypes.c_size_t(len(buf))
if libc.sysctl(mib, 4, buf, ctypes.byref(size), None, ctypes.c_size_t(0)) != 0:
    sys.exit("sysctl failed: errno %d" % ctypes.get_errno())
if size.value < 16:
    sys.exit("no process %s" % sys.argv[1])
sec, usec = struct.unpack_from("=qi", buf.raw, 0)
print("%d.%06d" % (sec, usec))
`;

/** When the kernel started `pid`, in epoch ms with microseconds; throws when it cannot say, rather than guess. */
function processStartMs(pid) {
  try {
    const out = execFileSync("python3", ["-I", "-c", PROCESS_START_PY, String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const ms = Number(out.trim()) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`unreadable start time "${out.trim()}"`);
    return ms;
  } catch (error) {
    const detail = error?.stderr ? String(error.stderr).trim() : error instanceof Error ? error.message : String(error);
    throw new Error(`mobile-perf: cannot read the start time of process ${pid} (${detail})`);
  }
}

/** The app's unified log since the launch, for one pid; the error in its place when `log show` fails (it only attributes). */
function unifiedLog(udid, pid, launchedAt) {
  try {
    const args = ["simctl", "spawn", udid, "log", "show", "--style", "compact", "--info", "--start", logStartArg(launchedAt), "--predicate", `processIdentifier == ${pid}`];
    return execFileSync("xcrun", args, LOG_SHOW_LIMITS);
  } catch (error) {
    const detail = error?.stderr ? String(error.stderr).trim() : error instanceof Error ? error.message : String(error);
    console.warn(`mobile-perf: no unified log for process ${pid}: ${detail}`);
    return `mobile-perf: log show failed: ${detail}\n`;
  }
}

/**
 * Terminates and launches the app, and returns the pid `simctl launch` printed. The container's lookup and the
 * process's start time are read by spawning xcrun and python3: never while the app is starting.
 */
async function launchIos(udid, bundle, run) {
  try {
    simctl("terminate", udid, bundle);
  } catch {
    // Not running: the first launch, or a run that ended on its own.
  }
  await sleep(1000);
  const launchedAt = Date.now();
  const out = simctl("launch", udid, bundle);
  const pid = parseLaunchPid(out, bundle);
  if (pid === null) throw new Error(`mobile-perf: simctl launch printed no pid for ${bundle} (launch ${run}): ${out.trim()}`);
  return { launchedAt, pid };
}

// A unified log line's time outside this window after the launch is a clock or time-zone mismatch, not the app's.
const LOG_WINDOW_MS = 120_000;

async function measureIosStartup(udid, bundle, mark, runs, outDir) {
  // An installed app's data container does not move between its launches: named once, before any timed run. If
  // simctl cannot name it before a first launch, an untimed launch creates it and is not counted.
  let container = dataContainer(udid, bundle);
  if (container === null) {
    await launchIos(udid, bundle, "untimed");
    for (let waited = 0; container === null && waited < 30_000; waited += 500) {
      await sleep(500);
      container = dataContainer(udid, bundle);
    }
    if (container === null) throw new Error(`mobile-perf: simctl names no data container for ${bundle} on ${udid}`);
  }
  const file = path.join(container, "Documents", "unichat-perf-marks.txt");
  const perRun = [];
  for (let run = 1; run <= runs; run += 1) {
    const { launchedAt, pid } = await launchIos(udid, bundle, run);
    // While the app starts the host only reads one file every 250 ms: no process competes with it for the CPU.
    let marks = {};
    for (let waited = 0; marks[mark] === undefined && waited < 60_000; waited += 250) {
      await sleep(250);
      marks = fs.existsSync(file) ? launchMarks(fs.readFileSync(file, "utf8"), launchedAt) : {};
    }
    if (marks[mark] === undefined) throw new Error(`mobile-perf: no "${mark}" mark within 60 s of launch ${run} (is the build made with UNICHAT_PERF_MARKS=1?)`);
    // The mark is drawn: what follows spawns processes, and the app is still running for its start time and its log.
    const processStart = processStartMs(pid);
    const log = unifiedLog(udid, pid, launchedAt);
    fs.writeFileSync(path.join(outDir, `ios-startup-run${run}.log`), log);
    let reactFactoryAt = logLineAt(log, "_setUpFeatureFlags");
    if (reactFactoryAt !== null && (reactFactoryAt < launchedAt - 1000 || reactFactoryAt > launchedAt + LOG_WINDOW_MS)) {
      console.warn(`mobile-perf: launch ${run}'s _setUpFeatureFlags line is ${reactFactoryAt - launchedAt} ms from the launch: not read (time zone?)`);
      reactFactoryAt = null;
    }
    if (marks["rn-bundle-entry"] !== undefined && bundleEntryAt(marks, processStart) === null) {
      console.warn(`mobile-perf: launch ${run}'s rn-bundle-entry mark is not between the process start and js-boot: not read`);
    }
    perRun.push(iosStartupRun({ mark, marks, launchedAt, processStart, reactFactoryAt }));
  }
  return summarize(perRun);
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
  if (command === "ios-startup") {
    const result = await measureIosStartup(option(args, "udid"), option(args, "bundle"), option(args, "mark", "first-screen"), Number(option(args, "runs", "5")), path.dirname(path.resolve(out)));
    return write(result);
  }
  if (command === "frames") return write(measureFrames(option(args, "package")));
  if (command === "apk") return write({ apkMB: Math.round((fs.statSync(args[0]).size / 1048576) * 10) / 10 });
  const profile = option(args, "profile", "android");
  const files = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--profile");
  const file = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  if (command === "check") {
    const measured = Object.assign({}, ...files.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))));
    const { rows, over } = check(measured, budgetOf(file, profile));
    const provisional = (file.provisional ?? []).includes(profile) ? " (provisional ceilings: `tighten` after five runs)" : "";
    const report = `### UniChat ${profile}${provisional}\n\n${table(rows)}\n`;
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    for (const r of over) console.log(`::error::${r.label} ${r.value} is over the ceiling ${r.ceiling} (apps/chat-mobile/perf-budget.json › ${profile})`);
    return over.length > 0 ? process.exit(1) : undefined;
  }
  if (command === "tighten") {
    const { rows, next, complete } = tighten(
      files.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))),
      budgetOf(file, profile),
    );
    for (const r of rows) console.log(r.worst === null ? `${r.key}: ${r.from} kept (${r.runs} of ${TIGHTEN_MIN_RUNS} runs)` : `${r.key}: worst ${r.worst} of ${r.runs} runs → ${r.from} becomes ${r.to}`);
    if (!args.includes("--write")) return undefined;
    file[profile] = next;
    if (complete) file.provisional = (file.provisional ?? []).filter((p) => p !== profile);
    fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(file, null, 2)}\n`);
    return console.log(`wrote apps/chat-mobile/perf-budget.json › ${profile}${complete ? "" : " (still provisional: a metric had fewer than five runs)"}`);
  }
  console.error("usage: node scripts/mobile-perf.mjs startup|ios-startup|frames|apk|check|tighten … (see the header)");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
