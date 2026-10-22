import { describe, expect, it } from "vitest";
import { launchRecord, otaLaunchFailure, pendingFromContext, readPendingRecord, readUpdateRecord } from "./ota-launch";

const RUNTIME = "1.4.0";
const EMBEDDED = { id: "0193a1b2-eeee-7e5f-8a9b-0c1d2e3f4a5b", createdAt: 1_000 };
const GOOD = { id: "0193a1b2-0000-7e5f-8a9b-0c1d2e3f4a5b", createdAt: 2_000 };
const BAD = { id: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", createdAt: 3_000 };

const record = (update: { id: string; createdAt: number }, runtimeVersion = RUNTIME) => ({ ...update, runtimeVersion });
const running = (update: { id: string; createdAt: number }, isEmbedded = false) => ({ ...update, runtimeVersion: RUNTIME, isEmbedded });

// Log entries as expo-updates 57.0.26 writes them (UpdatesLogEntry: timestamp, message, code, level, updateId?).
/** iOS StartupProcedure.markFailedLaunchForLaunchedUpdate: the one line that names an update that crashed at launch. */
const iosMarkedFailed = (updateId: string, timestamp = 1_500) => ({
  timestamp,
  message: "AppController markFailedLaunchForUpdate",
  code: "Unknown",
  level: "warn",
  updateId,
});
/** Android StartupProcedure: a remote check that failed, tagged with the update that is RUNNING (here the embedded one). */
const androidRemoteLoadFailed = (updateId: string, timestamp = 1_600) => ({
  timestamp,
  message: "UpdatesController loadRemoteUpdate onFailure",
  code: "UpdateFailedToLoad",
  level: "error",
  updateId,
  stacktrace: ["java.net.UnknownHostException: u.expo.dev"],
});
/** Android FileDownloader: a bad signature, logged without any update id. */
const androidInvalidSignature = (timestamp = 1_700) => ({
  timestamp,
  message: "Code signing verification failed for manifest",
  code: "UpdateCodeSigningError",
  level: "error",
});

const base = {
  isEmergencyLaunch: false,
  running: running(GOOD),
  previous: null,
  pending: null,
  entries: [],
  reportedThrough: 0,
};

describe("otaLaunchFailure", () => {
  it("reports nothing for a clean launch, and remembers how far it read", () => {
    expect(otaLaunchFailure(base)).toEqual({ failure: null, reportedThrough: 0 });
    const info = { timestamp: 5_000, message: "No update available", code: "NoUpdatesAvailable", level: "info" };
    expect(otaLaunchFailure({ ...base, entries: [info] })).toEqual({ failure: null, reportedThrough: 5_000 });
  });

  // Review finding: Android logs no line when it skips an update that crashed at launch, so the update the last launch
  // was told would run next, and an older one running now, is the signal.
  it("reports a downloaded update the next launch did not run", () => {
    const pending = { update: record(BAD), rollback: false };
    expect(otaLaunchFailure({ ...base, pending })).toEqual({
      failure: { kind: "failed_update", failedUpdateId: BAD.id, evidence: "skipped" },
      reportedThrough: 0,
    });
    // Also when the older one is the embedded bundle: the id compared with is expo-updates' own, embedded or not.
    expect(otaLaunchFailure({ ...base, running: running(EMBEDDED, true), pending }).failure?.failedUpdateId).toBe(BAD.id);
  });

  it("reports an update the launch before ran when this launch runs an older one", () => {
    expect(otaLaunchFailure({ ...base, previous: record(BAD) })).toEqual({
      failure: { kind: "failed_update", failedUpdateId: BAD.id, evidence: "rolled_back" },
      reportedThrough: 0,
    });
    // Both kept: the newest one is named.
    const pending = { update: record(BAD), rollback: false };
    const newer = { id: "0193a1b2-ffff-7e5f-8a9b-0c1d2e3f4a5b", createdAt: 4_000 };
    expect(otaLaunchFailure({ ...base, pending, previous: record(newer) }).failure).toEqual({
      kind: "failed_update",
      failedUpdateId: newer.id,
      evidence: "rolled_back",
    });
  });

  it("says nothing when this launch runs the kept update, a newer one, another runtime, or a pending rollback", () => {
    const pending = { update: record(BAD), rollback: false };
    expect(otaLaunchFailure({ ...base, running: running(BAD), pending, previous: record(GOOD) }).failure).toBeNull();
    expect(otaLaunchFailure({ ...base, running: running({ id: "newest", createdAt: 9_000 }), pending }).failure).toBeNull();
    // A store upgrade to a new runtime runs its embedded bundle, built before the old runtime's last OTA.
    const upgraded = { ...running(EMBEDDED, true), runtimeVersion: "1.5.0" };
    expect(otaLaunchFailure({ ...base, running: upgraded, previous: record(BAD) }).failure).toBeNull();
    expect(otaLaunchFailure({ ...base, previous: record(BAD, "1.3.0"), pending: { update: record(BAD, "1.3.0"), rollback: false } }).failure).toBeNull();
    // A roll-back-to-embedded directive was pending: the embedded bundle is what should run.
    expect(otaLaunchFailure({ ...base, running: running(EMBEDDED, true), previous: record(BAD), pending: { update: null, rollback: true } }).failure).toBeNull();
    // Without the running update's publish time nothing is compared.
    expect(otaLaunchFailure({ ...base, running: { ...running(GOOD), createdAt: null }, previous: record(BAD) }).failure).toBeNull();
  });

  // Review finding: Android's "loadRemoteUpdate onFailure" line names the RUNNING update (the embedded one on a store
  // build), and the signature errors name none; neither is an update that failed to launch.
  it("does not take expo-updates' error lines for a failed launch", () => {
    const entries = [androidRemoteLoadFailed(EMBEDDED.id), androidRemoteLoadFailed(BAD.id, 1_650), androidInvalidSignature()];
    expect(otaLaunchFailure({ ...base, running: running(EMBEDDED, true), entries })).toEqual({ failure: null, reportedThrough: 1_700 });
  });

  it("reports the update iOS marked failed, once, and never the one running", () => {
    const entries = [iosMarkedFailed(BAD.id.toUpperCase()), iosMarkedFailed(GOOD.id, 1_800)];
    const first = otaLaunchFailure({ ...base, entries });
    expect(first).toEqual({ failure: { kind: "failed_update", failedUpdateId: BAD.id, evidence: "marked_failed" }, reportedThrough: 1_800 });
    expect(otaLaunchFailure({ ...base, entries, reportedThrough: first.reportedThrough }).failure).toBeNull();
    const two = [iosMarkedFailed(EMBEDDED.id, 1_100), iosMarkedFailed(BAD.id, 1_400), iosMarkedFailed(EMBEDDED.id, 1_200)];
    expect(otaLaunchFailure({ ...base, entries: two }).failure?.failedUpdateId).toBe(BAD.id);
  });

  // Audit "no-emergency-launch-signal": a phone that fell back to the embedded bundle reported as `embedded`.
  it("reports every emergency launch, naming the update it should have run when one is known", () => {
    const emergency = { ...base, isEmergencyLaunch: true, running: running(EMBEDDED, true) };
    expect(otaLaunchFailure({ ...emergency, previous: record(BAD) }).failure).toEqual({
      kind: "emergency",
      failedUpdateId: BAD.id,
      evidence: "rolled_back",
    });
    // A marked line read before still names it.
    expect(otaLaunchFailure({ ...emergency, entries: [iosMarkedFailed(BAD.id)], reportedThrough: 5_000 })).toEqual({
      failure: { kind: "emergency", failedUpdateId: BAD.id, evidence: "marked_failed" },
      reportedThrough: 5_000,
    });
    expect(otaLaunchFailure({ ...emergency, entries: [iosMarkedFailed(BAD.id)] }).failure?.evidence).toBe("marked_failed");
    expect(otaLaunchFailure({ ...emergency, entries: [androidRemoteLoadFailed(EMBEDDED.id)] }).failure).toEqual({
      kind: "emergency",
      failedUpdateId: null,
      evidence: "none",
    });
  });

  it("reads a log that is not what expo-updates documents as empty", () => {
    const junk = [null, "x", { timestamp: "1", message: "markFailedLaunchForUpdate", updateId: BAD.id }, { timestamp: 7, message: 3, updateId: BAD.id }];
    expect(otaLaunchFailure({ ...base, entries: junk, reportedThrough: 3 })).toEqual({ failure: null, reportedThrough: 7 });
    expect(otaLaunchFailure({ ...base, entries: [{ timestamp: 9, message: "markFailedLaunchForUpdate", updateId: "" }] }).failure).toBeNull();
    expect(otaLaunchFailure({ ...base, entries: "not a list", reportedThrough: 3 }).reportedThrough).toBe(3);
  });
});

describe("kept records", () => {
  it("reads back what launchRecord and pendingFromContext keep, lower-casing ids", () => {
    const kept = launchRecord({ ...running(GOOD), id: GOOD.id.toUpperCase() });
    expect(kept).toEqual(record(GOOD));
    expect(readUpdateRecord(JSON.stringify(kept))).toEqual(record(GOOD));
    const pending = { update: record(BAD), rollback: false };
    expect(readPendingRecord(JSON.stringify(pending))).toEqual(pending);
    expect(readPendingRecord(JSON.stringify({ rollback: true }))).toEqual({ update: null, rollback: true });
  });

  it("keeps no launch expo-updates does not describe enough", () => {
    expect(launchRecord({ ...running(GOOD), id: null })).toBeNull();
    expect(launchRecord({ ...running(GOOD), createdAt: null })).toBeNull();
    expect(launchRecord({ ...running(GOOD), runtimeVersion: null })).toBeNull();
  });

  it("reads anything else as nothing kept", () => {
    for (const raw of [undefined, "", "{not json", "[]", "null", JSON.stringify({ id: GOOD.id, createdAt: "2", runtimeVersion: RUNTIME })]) {
      expect(readUpdateRecord(raw)).toBeNull();
      expect(readPendingRecord(raw)).toBeNull();
    }
    expect(readUpdateRecord(JSON.stringify({ id: GOOD.id, createdAt: Number.NaN, runtimeVersion: RUNTIME }))).toBeNull();
    expect(readUpdateRecord(JSON.stringify({ id: GOOD.id, createdAt: 1, runtimeVersion: 2 }))).toBeNull();
    expect(readPendingRecord(JSON.stringify({ update: { id: 1 } }))).toBeNull();
  });
});

describe("pendingFromContext", () => {
  // The state machine context as expo-updates' UpdatesEmitter hands it: manifests already parsed.
  const downloaded = (manifest: Record<string, unknown>) => ({ isUpdatePending: true, downloadedManifest: manifest, sequenceNumber: 4 });

  it("keeps the downloaded update the next launch should run", () => {
    const manifest = { id: BAD.id, createdAt: new Date(BAD.createdAt).toISOString(), runtimeVersion: RUNTIME };
    expect(pendingFromContext(downloaded(manifest), "other")).toEqual({ update: record(BAD), rollback: false });
    const { runtimeVersion: _dropped, ...noRuntime } = manifest;
    expect(pendingFromContext(downloaded(noRuntime), RUNTIME)).toEqual({ update: record(BAD), rollback: false });
  });

  it("keeps a pending rollback to the embedded bundle", () => {
    expect(pendingFromContext({ isUpdatePending: true, rollback: { commitTime: "2026-10-20T00:00:00Z" } }, RUNTIME)).toEqual({
      update: null,
      rollback: true,
    });
  });

  it("keeps nothing when nothing is pending or the manifest is not one", () => {
    expect(pendingFromContext({ isUpdatePending: false, downloadedManifest: { id: BAD.id } }, RUNTIME)).toBeNull();
    expect(pendingFromContext(undefined, RUNTIME)).toBeNull();
    expect(pendingFromContext(downloaded({ id: BAD.id, createdAt: "not a date" }), RUNTIME)).toBeNull();
    expect(pendingFromContext(downloaded({ id: BAD.id, createdAt: "2026-10-20T00:00:00Z" }), null)).toBeNull();
    expect(pendingFromContext({ isUpdatePending: true }, RUNTIME)).toBeNull();
  });
});
