// The app's logger: one scope per module ("auth", "realtime", "push"…),
// replacing the scattered console.warn calls. A line goes to
// the console only in a development build, and always to crash reporting as
// a breadcrumb, so a report carries the steps that led to it. `error` with an
// Error also reports it (data/report.ts decides whether it is worth a report).
// Messages are reason codes and ids; data/report.ts redacts what slips in.
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
// time against the launch's. Each mark once per process: a mark is a moment of this start, not an event.
let perfMarks = false;
const marked = new Set<string>();

/** Boot (data/boot.ts): whether this build logs its startup marks. */
export function enablePerfMarks(on: boolean): void {
  perfMarks = on;
}

/** The first time this process reaches `name` ("first-screen", "inbox"), in a build that measures itself. */
export function perfMark(name: string): void {
  if (!perfMarks || marked.has(name)) return;
  marked.add(name);
  console.info(`UniChatPerf mark=${name}`);
}
