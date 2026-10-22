// The app's logger: one scope per module ("auth", "realtime", "push"…),
// replacing the scattered console.warn calls. A line goes to
// the console only in a development build, and always to crash reporting as
// a breadcrumb, so a report carries the steps that led to it. `error` with an
// Error also reports it (data/report.ts decides whether it is worth a report).
// Messages are reason codes and ids; data/report.ts redacts what slips in.
import { JS_BOOT_AT } from "./perf/boot-clock";
import { breadcrumb, reportError, type ReportLevel } from "./report";

type Data = Record<string, unknown>;

export interface Logger {
  info(message: string, data?: Data): void;
  warn(message: string, data?: Data): void;
  error(message: string, error?: unknown, data?: Data): void;
}

declare const __DEV__: boolean | undefined;

/** Read per call so a test can flip it; true in `expo start`, false in a release bundle. */
function isDev(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

export function createLogger(scope: string): Logger {
  const write = (level: ReportLevel, message: string, data: Data | undefined, extra: unknown[] = []) => {
    breadcrumb(scope, message, level, data);
    if (!isDev()) return;
    const line = `[${scope}] ${message}`;
    const args = data ? [line, data, ...extra] : [line, ...extra];
    if (level === "error") console.error(...args);
    else if (level === "warning") console.warn(...args);
    else console.info(...args);
  };
  return {
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warning", message, data),
    error: (message, error, data) => {
      write("error", message, data, error === undefined ? [] : [error]);
      if (error !== undefined) reportError(error, { source: scope, extra: { message, ...data } });
    },
  };
}

/** The console-shaped logger ws-client.ts takes (`info/warn/debug(...args)`). */
export interface ArgsLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Adapts a scoped logger to ws-client's console shape. The first argument is
 * the message; of the rest only numbers and booleans (a close code, an
 * attempt) reach the breadcrumb — a frame or a URL may carry chat text or ids,
 * and stays on the development console. `debug` (one line per frame) never
 * leaves the console: it would push every useful breadcrumb out.
 */
export function argsLogger(scope: string): ArgsLogger {
  const log = createLogger(scope);
  const split = (args: unknown[]): [string, Record<string, unknown> | undefined] => {
    const [first, ...rest] = args;
    const scalars = rest.filter((v) => typeof v === "number" || typeof v === "boolean");
    return [String(first), scalars.length > 0 ? { values: scalars.join(",") } : undefined];
  };
  return {
    info: (...args) => log.info(...split(args)),
    warn: (...args) => log.warn(...split(args)),
    debug: (...args) => {
      if (isDev()) console.debug(...args);
    },
  };
}

// Startup marks for on-device measurement (scripts/mobile-perf.mjs): only a build made with
// UNICHAT_PERF_MARKS=1 logs them, to the device log (logcat's ReactNativeJS tag), where CI reads each mark's
// time against the launch's. Each mark once per process: a mark is a moment of this start, not an event. A
// line carries the mark's own time (`at=`, epoch ms): js-boot is logged once marks are on, after the moment
// it names. iOS's release log drops console.info, so boot passes a sink that keeps them in a file there.
let perfMarks = false;
let perfSink: ((text: string) => void) | null = null;
const marked = new Set<string>();
const markLines: string[] = [];

/** Adds a mark not logged yet; false when this process already logged it. */
function addMark(name: string, at: number): boolean {
  if (marked.has(name)) return false;
  marked.add(name);
  const line = `UniChatPerf mark=${name} at=${at}`;
  markLines.push(line);
  console.info(line);
  return true;
}

function logMark(name: string, at: number): void {
  if (addMark(name, at)) perfSink?.(markLines.join("\n"));
}

// React Native's own timing (performance.rnStartupTiming), reduced to the one moment it names on iOS: on the bridgeless
// runtime ReactInstance::loadScript logs the bundle-run, runtime-init and app-startup markers back to back just before
// Hermes evaluates the bundle, so startTime and initializeRuntimeStart are that same instant and mark neither the app's
// start nor the runtime's. rn-bundle-entry is that moment: what comes before it (process, React factory, host and
// instance, reading the bundle) is the native start, what comes after it until js-boot is Hermes reaching the bundle's
// first line. Its time is ms on performance.now()'s clock (iOS: both read mach_absolute_time, RCTPerformanceLogger
// through CACurrentMediaTime and HighResTimeStamp directly), turned into epoch ms like every other mark.
type StartupTiming = { executeJavaScriptBundleEntryPointStart?: number | null };

/** Adds the bundle-entry mark; a runtime without the API (or one whose getter throws) adds none. */
function addRnBundleEntryMark(): boolean {
  try {
    const perf = (globalThis as { performance?: { now?: () => number; rnStartupTiming?: StartupTiming } }).performance;
    const value = perf?.rnStartupTiming?.executeJavaScriptBundleEntryPointStart;
    if (typeof perf?.now !== "function" || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
    return addMark("rn-bundle-entry", Math.round(value + Date.now() - perf.now()));
  } catch {
    // Attribution only: a measured build without it still logs its own marks.
    return false;
  }
}

/**
 * Boot (data/boot.ts): whether this build logs its startup marks, and where else they go. Turning them on
 * logs "js-boot", the moment the bundle started (data/perf/boot-clock.ts), and "rn-bundle-entry", the moment React
 * Native began evaluating it, when the runtime reports it, in one write of the sink.
 */
export function enablePerfMarks(on: boolean, sink?: (text: string) => void): void {
  perfMarks = on;
  perfSink = on ? (sink ?? null) : null;
  if (!on) return;
  const boot = addMark("js-boot", JS_BOOT_AT);
  if (addRnBundleEntryMark() || boot) perfSink?.(markLines.join("\n"));
}

/** The first time this process reaches `name` ("first-screen", "inbox"), in a build that measures itself. */
export function perfMark(name: string): void {
  if (perfMarks) logMark(name, Date.now());
}
