// How this launch went, told once at each cold start (data/app-startup.ts): whether the run before it crashed, and
// whether an OTA update failed to launch (audit "no-emergency-launch-signal"). expo-updates falls back quietly — an
// emergency launch runs the bundle embedded in the binary, an update that crashes before its first screen is skipped
// for the one before it — so without this a phone stuck behind a bad update reported as healthy. A failure is one crash
// report (tag `failed_update_id`, one issue per update and OS) that scripts/mobile-release-health.mjs counts against
// that update, and one anonymous counter (`ota_launch`) the server's alert pages on; a crashed last run is the counter
// `app_crash` (deploy/alerts.yml › UniChatMobileCrashes, UniChatMobileUpdateLaunchFailures). The verdict is
// lib/ota-launch.ts's, from what the device keeps here: the update this launch runs, the one expo-updates downloaded
// for the next launch, and how far its log was read.
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { launchRecord, otaLaunchFailure, pendingFromContext, readPendingRecord, readUpdateRecord } from "@/lib/ota-launch";
import { track } from "../analytics";
import { bestEffort, reportError } from "../report";
import { crashedLastRun } from "../sentry";
import { openDeviceStore, type DeviceStore } from "../storage/device-store";

/** The newest expo-updates log line already read (its timestamp), in the device store. */
export const REPORTED_THROUGH_KEY = "ota-launch/reported-through";
/** The update the last launch ran (lib/ota-launch.ts › launchRecord). */
export const LAST_LAUNCH_KEY = "ota-launch/last-launch";
/** What expo-updates said the next launch would run (lib/ota-launch.ts › pendingFromContext). */
export const PENDING_KEY = "ota-launch/pending";
/** How far back the update log is read: an update that failed while the phone sat unopened is still told. */
export const LOG_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The error a launch failure is reported as: never thrown, its name is the issue's title in Sentry. */
export class OtaLaunchError extends Error {
  override name = "OtaLaunchError";
}

/** Keeps what expo-updates downloads for the next launch, now and whenever its state machine changes. */
function keepPendingUpdate(store: DeviceStore): void {
  const keep = (context: unknown) => {
    const pending = pendingFromContext(context, Updates.runtimeVersion);
    if (pending) store.set(PENDING_KEY, JSON.stringify(pending));
  };
  keep(Updates.latestContext);
  Updates.addUpdatesStateChangeListener((event) => keep(event.context));
}

export async function reportLaunchHealth(): Promise<void> {
  if (await crashedLastRun()) track({ name: "app_crash", result: "last_run" });
  if (!Updates.isEnabled) return;
  const store = await openDeviceStore();
  const previous = readUpdateRecord(store.getString(LAST_LAUNCH_KEY));
  const pending = readPendingRecord(store.getString(PENDING_KEY));
  const running = {
    id: Updates.updateId,
    createdAt: Updates.createdAt?.getTime() ?? null,
    runtimeVersion: Updates.runtimeVersion,
    isEmbedded: Updates.isEmbeddedLaunch,
  };
  // This launch is kept as soon as the store is open: if it crashes from here on and expo-updates skips it, the
  // launch after names it. What was pending was for this launch; what is pending now is for the next.
  const current = launchRecord(running);
  if (current) store.set(LAST_LAUNCH_KEY, JSON.stringify(current));
  else store.remove(LAST_LAUNCH_KEY);
  store.remove(PENDING_KEY);
  keepPendingUpdate(store);

  const kept = Number(store.getString(REPORTED_THROUGH_KEY) ?? "0");
  const before = Number.isFinite(kept) ? kept : 0;
  const entries = await Updates.readLogEntriesAsync(LOG_WINDOW_MS).catch(bestEffort("updates", "update log not read", "breadcrumb"));
  const { failure, reportedThrough } = otaLaunchFailure({
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    running,
    previous,
    pending,
    entries,
    reportedThrough: before,
  });
  if (reportedThrough > before) store.set(REPORTED_THROUGH_KEY, String(reportedThrough));
  if (!failure) return;
  track({ name: "ota_launch", result: failure.kind });
  const what =
    failure.kind === "emergency"
      ? "UniChat fell back to the bundle in its binary: the update launcher failed"
      : "An update failed to launch; UniChat runs an older one";
  reportError(new OtaLaunchError(what), {
    source: "updates",
    force: true,
    tags: { ota_failure: failure.kind, failed_update_id: failure.failedUpdateId ?? "unknown", failed_update_evidence: failure.evidence },
    ...(Updates.emergencyLaunchReason ? { extra: { reason: Updates.emergencyLaunchReason } } : {}),
    fingerprint: ["ota-launch-failure", Platform.OS, failure.failedUpdateId ?? failure.kind],
  });
}
