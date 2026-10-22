// How this launch went, told once at each cold start (data/app-startup.ts): whether the run before it crashed, and
// whether an OTA update failed to launch (audit "no-emergency-launch-signal"). expo-updates falls back quietly — an
// emergency launch runs the bundle embedded in the binary, an update whose files fail to load or verify is skipped for
// the one before it — so without this a phone stuck behind a bad update reported as healthy. A failure is one crash
// report (tag `failed_update_id`, one issue per update and OS) that scripts/mobile-release-health.mjs counts against
// that update, and one anonymous counter (`ota_launch`) the server's alert pages on; a crashed last run is the counter
// `app_crash` (deploy/alerts.yml › UniChatMobileCrashes, UniChatMobileUpdateLaunchFailures). The verdict is
// lib/ota-launch.ts's; how far the update log was read stays on the device so a failure is reported once.
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { otaLaunchFailure } from "@/lib/ota-launch";
import { track } from "../analytics";
import { bestEffort, reportError } from "../report";
import { crashedLastRun } from "../sentry";
import { openDeviceStore } from "../storage/device-store";

/** The newest expo-updates log line already reported (its timestamp), in the device store. */
export const REPORTED_THROUGH_KEY = "ota-launch/reported-through";
/** How far back the update log is read: an update that failed while the phone sat unopened is still told. */
export const LOG_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The error a launch failure is reported as: never thrown, its name is the issue's title in Sentry. */
export class OtaLaunchError extends Error {
  override name = "OtaLaunchError";
}

export async function reportLaunchHealth(): Promise<void> {
  if (await crashedLastRun()) track({ name: "app_crash", result: "last_run" });
  if (!Updates.isEnabled) return;
  const store = await openDeviceStore();
  const kept = Number(store.getString(REPORTED_THROUGH_KEY) ?? "0");
  const before = Number.isFinite(kept) ? kept : 0;
  const entries = await Updates.readLogEntriesAsync(LOG_WINDOW_MS).catch(bestEffort("updates", "update log not read", "breadcrumb"));
  const { failure, reportedThrough } = otaLaunchFailure({
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    runningUpdateId: Updates.isEmbeddedLaunch ? null : Updates.updateId,
    entries,
    reportedThrough: before,
  });
  if (reportedThrough > before) store.set(REPORTED_THROUGH_KEY, String(reportedThrough));
  if (!failure) return;
  track({ name: "ota_launch", result: failure.kind });
  const what =
    failure.kind === "emergency"
      ? "UniChat fell back to the bundle in its binary: the update launcher failed"
      : "A downloaded update could not be launched; UniChat runs the one before it";
  reportError(new OtaLaunchError(what), {
    source: "updates",
    force: true,
    tags: { ota_failure: failure.kind, failed_update_id: failure.failedUpdateId ?? "unknown", failed_update_code: failure.code },
    ...(Updates.emergencyLaunchReason ? { extra: { reason: Updates.emergencyLaunchReason } } : {}),
    fingerprint: ["ota-launch-failure", Platform.OS, failure.failedUpdateId ?? failure.kind],
  });
}
