// Whether an OTA update failed to launch on this phone (audit "no-emergency-launch-signal"). expo-updates falls back
// quietly: an emergency launch runs the bundle embedded in the binary when the launcher itself fails, and an update
// that crashes before its first screen is marked failed and skipped for the one before it. Either way the phone
// reported as `embedded` (or as the older update) and nothing said an update had failed.
//
// expo-updates (57.x) writes no log line that names a skipped update on Android, and on iOS only a warn line
// ("AppController markFailedLaunchForUpdate", code Unknown); the error codes it does log (signature, code signing,
// remote load) carry no update id or name the update that is running. So the verdict comes from state the device
// keeps itself (data/release/launch-health.ts):
// - the update expo-updates said was downloaded and would run at the next launch (`pending`, from its state machine);
// - the update the launch before this one ran (`previous`).
// If this launch, on the same runtime version, runs something older than either — and no roll-back-to-embedded
// directive was pending — that newer update failed to launch. The iOS warn line names one too.
// Pure: launch-health.ts hands it what expo-updates and the device store say; the verdict becomes one crash report
// tagged with the failed update's id, which scripts/mobile-release-health.mjs counts against that update.
import { isRecord, pathOf } from "./unknown-shape";

type OtaLaunchFailureKind = "emergency" | "failed_update";

/**
 * What named the failed update: `skipped` (downloaded for the next launch, which ran an older one), `rolled_back`
 * (the launch before ran it, this one an older one), `marked_failed` (expo-updates' iOS log line), `none`.
 */
type OtaLaunchEvidence = "skipped" | "rolled_back" | "marked_failed" | "none";

interface OtaLaunchFailure {
  kind: OtaLaunchFailureKind;
  /** The update that failed, when one is known (lower case, as expo-updates' own ids). */
  failedUpdateId: string | null;
  evidence: OtaLaunchEvidence;
}

/** One update as the device store keeps it: enough to tell whether a later launch went backwards. */
interface UpdateRecord {
  id: string;
  /** Its publish time, ms since the epoch. */
  createdAt: number;
  runtimeVersion: string;
}

/** What expo-updates said the next launch would run: a downloaded update, or the embedded bundle (a rollback). */
interface PendingRecord {
  update: UpdateRecord | null;
  rollback: boolean;
}

/** The update this launch runs, as expo-updates' constants tell it (the embedded bundle has an id too). */
interface RunningUpdate {
  id: string | null;
  createdAt: number | null;
  runtimeVersion: string | null;
  isEmbedded: boolean;
}

/** The message of expo-updates' iOS line for an update that crashed before its first screen. */
const MARKED_FAILED = "markFailedLaunchForUpdate";

const lower = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value.toLowerCase() : null);

function parsed(raw: string | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function recordOf(value: unknown): UpdateRecord | null {
  const id = lower(pathOf(value, "id"));
  const createdAt = pathOf(value, "createdAt");
  const runtimeVersion = pathOf(value, "runtimeVersion");
  if (!id || typeof createdAt !== "number" || !Number.isFinite(createdAt) || typeof runtimeVersion !== "string") return null;
  return { id, createdAt, runtimeVersion };
}

/** The kept record of a launch, as stored by `launchRecord`; null for anything else. */
export function readUpdateRecord(raw: string | undefined): UpdateRecord | null {
  return recordOf(parsed(raw));
}

/** The kept pending record; null for anything else. */
export function readPendingRecord(raw: string | undefined): PendingRecord | null {
  const value = parsed(raw);
  if (!isRecord(value)) return null;
  if (value.rollback === true) return { update: null, rollback: true };
  const update = recordOf(value.update);
  return update ? { update, rollback: false } : null;
}

/** The record this launch leaves for the next one; null when expo-updates does not say enough to compare. */
export function launchRecord(running: RunningUpdate): UpdateRecord | null {
  const id = lower(running.id);
  if (!id || running.createdAt === null || running.runtimeVersion === null) return null;
  return { id, createdAt: running.createdAt, runtimeVersion: running.runtimeVersion };
}

/**
 * What the next launch should run, from expo-updates' state machine context (`latestContext` or a state change
 * event): null unless an update or a rollback is pending. The manifest's own runtime version wins; an EAS manifest
 * always carries one, `runtimeVersion` is the fallback.
 */
export function pendingFromContext(context: unknown, runtimeVersion: string | null): PendingRecord | null {
  if (pathOf(context, "isUpdatePending") !== true) return null;
  if (isRecord(pathOf(context, "rollback"))) return { update: null, rollback: true };
  const manifest = pathOf(context, "downloadedManifest");
  const createdAt = Date.parse(String(pathOf(manifest, "createdAt")));
  const own = pathOf(manifest, "runtimeVersion");
  const update = recordOf({ id: pathOf(manifest, "id"), createdAt, runtimeVersion: typeof own === "string" ? own : runtimeVersion });
  return update ? { update, rollback: false } : null;
}

interface MarkedLine {
  timestamp: number;
  updateId: string;
}

function markedLineOf(value: unknown): MarkedLine | null {
  if (!isRecord(value) || typeof value.timestamp !== "number") return null;
  const updateId = lower(value.updateId);
  if (!updateId || typeof value.message !== "string" || !value.message.includes(MARKED_FAILED)) return null;
  return { timestamp: value.timestamp, updateId };
}

interface LaunchState {
  isEmergencyLaunch: boolean;
  running: RunningUpdate;
  /** The launch before this one (`readUpdateRecord` of the kept value). */
  previous: UpdateRecord | null;
  /** What the launch before was told would run next (`readPendingRecord` of the kept value). */
  pending: PendingRecord | null;
  /** What `Updates.readLogEntriesAsync` gave, unchecked. */
  entries: unknown;
  /** The newest log line already read (a timestamp), kept on the device so a log line is reported once. */
  reportedThrough: number;
}

interface Named {
  updateId: string;
  createdAt: number;
  evidence: OtaLaunchEvidence;
}

/** The kept updates newer than the one running, on its runtime, that it should have run: newest first. */
function skippedUpdates(state: LaunchState, runningId: string | null): Named[] {
  const { running, pending, previous } = state;
  // A roll-back-to-embedded directive was pending: the embedded bundle is what should run.
  if (running.createdAt === null || (pending?.rollback === true && running.isEmbedded)) return [];
  const since = running.createdAt;
  const kept: Named[] = [];
  if (pending?.update) kept.push({ updateId: pending.update.id, createdAt: pending.update.createdAt, evidence: "skipped" });
  if (previous) kept.push({ updateId: previous.id, createdAt: previous.createdAt, evidence: "rolled_back" });
  const runtimeOf = (named: Named) => (named.evidence === "skipped" ? pending?.update?.runtimeVersion : previous?.runtimeVersion);
  return kept
    .filter((named) => named.updateId !== runningId && named.createdAt > since && runtimeOf(named) === running.runtimeVersion)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The failure to report for this launch, if any, and how far the log has now been read. An emergency launch is
 * reported every time it happens (each one is a phone that could not start an update), naming the update it should
 * have run when one is known; a skipped update once, since each launch replaces what it is compared with.
 */
export function otaLaunchFailure(state: LaunchState): { failure: OtaLaunchFailure | null; reportedThrough: number } {
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const reportedThrough = entries.reduce<number>(
    (newest, line) => (isRecord(line) && typeof line.timestamp === "number" ? Math.max(newest, line.timestamp) : newest),
    state.reportedThrough,
  );
  const runningId = lower(state.running.id);
  const marked = entries
    .map(markedLineOf)
    .filter((line): line is MarkedLine => line !== null && line.updateId !== runningId)
    .sort((a, b) => b.timestamp - a.timestamp);
  const skipped = skippedUpdates(state, runningId)[0];
  const fresh = marked.find((line) => line.timestamp > state.reportedThrough);
  const named = skipped ?? (fresh ? { updateId: fresh.updateId, evidence: "marked_failed" as const } : undefined);
  if (state.isEmergencyLaunch) {
    const any = named ?? (marked[0] ? { updateId: marked[0].updateId, evidence: "marked_failed" as const } : undefined);
    return { failure: { kind: "emergency", failedUpdateId: any?.updateId ?? null, evidence: any?.evidence ?? "none" }, reportedThrough };
  }
  return { failure: named ? { kind: "failed_update", failedUpdateId: named.updateId, evidence: named.evidence } : null, reportedThrough };
}
