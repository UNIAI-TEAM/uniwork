// Whether an OTA update failed to launch on this phone (audit "no-emergency-launch-signal"). expo-updates falls back
// quietly: an emergency launch runs the bundle embedded in the binary when the launcher itself fails, and an update
// whose files fail to load or verify is skipped for the one before it. Either way the phone reported as `embedded` (or
// as the older update) and nothing said an update had failed. Pure: data/release/launch-health.ts reads expo-updates
// and its log (`readLogEntriesAsync`) and hands them here; the verdict becomes one crash report tagged with the failed
// update's id, which scripts/mobile-release-health.mjs counts against that update, and one anonymous counter.
import { isRecord } from "./unknown-shape";

type OtaLaunchFailureKind = "emergency" | "failed_update";

export interface OtaLaunchFailure {
  kind: OtaLaunchFailureKind;
  /** The update that failed, when the log names it (lower case, as expo-updates' own ids). */
  failedUpdateId: string | null;
  /** expo-updates' log code of the line that named it ("Unknown" when none did). */
  code: string;
}

/** The log codes that mean a downloaded update could not be launched. */
const FAILED_UPDATE_CODES: ReadonlySet<string> = new Set([
  "UpdateFailedToLoad",
  "AssetsFailedToLoad",
  "JSRuntimeError",
  "UpdateHasInvalidSignature",
  "UpdateCodeSigningError",
]);

interface LogLine {
  timestamp: number;
  code: string;
  level: string;
  updateId: string | null;
}

function lineOf(value: unknown): LogLine | null {
  if (!isRecord(value) || typeof value.timestamp !== "number") return null;
  return {
    timestamp: value.timestamp,
    code: typeof value.code === "string" ? value.code : "Unknown",
    level: typeof value.level === "string" ? value.level : "",
    updateId: typeof value.updateId === "string" && value.updateId !== "" ? value.updateId.toLowerCase() : null,
  };
}

export interface LaunchState {
  isEmergencyLaunch: boolean;
  /** The update this launch runs; null for the embedded bundle. */
  runningUpdateId: string | null;
  /** What `Updates.readLogEntriesAsync` gave, unchecked. */
  entries: unknown;
  /** The newest log line already reported (a timestamp), kept on the device so a failure is reported once. */
  reportedThrough: number;
}

/**
 * The failure to report for this launch, if any, and how far the log has now been read. An emergency launch is
 * reported every time it happens (each one is a phone that could not start an update), naming the newest update an
 * error line names; a failed update without an emergency launch only once, from lines not reported before.
 */
export function otaLaunchFailure(state: LaunchState): { failure: OtaLaunchFailure | null; reportedThrough: number } {
  const lines = (Array.isArray(state.entries) ? state.entries : []).map(lineOf).filter((line): line is LogLine => line !== null);
  const reportedThrough = lines.reduce((newest, line) => Math.max(newest, line.timestamp), state.reportedThrough);
  const running = state.runningUpdateId?.toLowerCase() ?? null;
  const failed = lines
    .filter((line) => (line.level === "error" || line.level === "fatal") && line.updateId !== null && line.updateId !== running)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (state.isEmergencyLaunch) {
    const named = failed[0];
    return { failure: { kind: "emergency", failedUpdateId: named?.updateId ?? null, code: named?.code ?? "Unknown" }, reportedThrough };
  }
  const fresh = failed.find((line) => line.timestamp > state.reportedThrough && FAILED_UPDATE_CODES.has(line.code));
  return { failure: fresh ? { kind: "failed_update", failedUpdateId: fresh.updateId, code: fresh.code } : null, reportedThrough };
}
