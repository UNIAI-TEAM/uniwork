import { beforeEach, describe, expect, it, vi } from "vitest";

const RUNTIME = "1.4.0";
const EMBEDDED = "0193a1b2-eeee-7e5f-8a9b-0c1d2e3f4a5b";
const BAD = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const GOOD = "0193a1b2-0000-7e5f-8a9b-0c1d2e3f4a5b";

type StateListener = (event: { context: unknown }) => void;

const updates = vi.hoisted(() => ({
  isEnabled: true,
  isEmergencyLaunch: false,
  isEmbeddedLaunch: true,
  updateId: null as string | null,
  createdAt: null as Date | null,
  runtimeVersion: null as string | null,
  emergencyLaunchReason: null as string | null,
  latestContext: {} as unknown,
  listeners: [] as StateListener[],
  addUpdatesStateChangeListener: vi.fn(),
  readLogEntriesAsync: vi.fn<(maxAge?: number) => Promise<unknown[]>>(async () => []),
}));
const calls = vi.hoisted(() => ({
  track: vi.fn(),
  crashedLastRun: vi.fn<() => Promise<boolean | null>>(async () => null),
}));

vi.mock("expo-updates", () => updates);
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../analytics", () => ({ track: calls.track }));
vi.mock("../sentry", () => ({ crashedLastRun: calls.crashedLastRun }));

import { installReportSink, type ReportSink } from "../report";
import { installDeviceStore, memoryDeviceStore, type DeviceStore } from "../storage/device-store";
import { LAST_LAUNCH_KEY, LOG_WINDOW_MS, OtaLaunchError, PENDING_KEY, REPORTED_THROUGH_KEY, reportLaunchHealth } from "./launch-health";

/** expo-updates' constants for a launch of `id`, published at `createdAt`. */
const launch = (id: string, createdAt: number, isEmbeddedLaunch = false) =>
  Object.assign(updates, { updateId: id, createdAt: new Date(createdAt), runtimeVersion: RUNTIME, isEmbeddedLaunch });
/** The state machine context once expo-updates has downloaded `id` for the next launch. */
const downloaded = (id: string, createdAt: number) => ({
  isUpdatePending: true,
  downloadedManifest: { id, createdAt: new Date(createdAt).toISOString(), runtimeVersion: RUNTIME },
});
/** iOS's line for an update that crashed before its first screen, as expo-updates 57.0.26 writes it. */
const iosMarkedFailed = (updateId: string, timestamp: number) => ({
  timestamp,
  message: "AppController markFailedLaunchForUpdate",
  code: "Unknown",
  level: "warn",
  updateId,
});

let store: DeviceStore;
let sink: { captureException: ReturnType<typeof vi.fn<ReportSink["captureException"]>> } & ReportSink;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(updates, {
    isEnabled: true,
    isEmergencyLaunch: false,
    isEmbeddedLaunch: true,
    updateId: null,
    createdAt: null,
    runtimeVersion: null,
    emergencyLaunchReason: null,
    latestContext: {},
    listeners: [],
  });
  updates.readLogEntriesAsync.mockReset().mockResolvedValue([]);
  updates.addUpdatesStateChangeListener.mockImplementation((listener: StateListener) => void updates.listeners.push(listener));
  store = memoryDeviceStore();
  installDeviceStore(async () => store);
  sink = { captureException: vi.fn(), addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() };
  installReportSink(sink);
});

describe("reportLaunchHealth", () => {
  it("does nothing on a clean launch, and counts a run that ended in a crash", async () => {
    launch(EMBEDDED, 1_000, true);
    await reportLaunchHealth();
    expect(calls.track).not.toHaveBeenCalled();
    expect(sink.captureException).not.toHaveBeenCalled();
    expect(updates.readLogEntriesAsync).toHaveBeenCalledWith(LOG_WINDOW_MS);
    expect(JSON.parse(store.getString(LAST_LAUNCH_KEY) ?? "null")).toEqual({ id: EMBEDDED, createdAt: 1_000, runtimeVersion: RUNTIME });
    calls.crashedLastRun.mockResolvedValueOnce(true);
    await reportLaunchHealth();
    expect(calls.track).toHaveBeenCalledWith({ name: "app_crash", result: "last_run" });
  });

  // Review finding: Android logs nothing when it skips an update that crashed at its first launch. The update
  // expo-updates downloaded for the next launch, and that launch running an older one, is what tells it.
  it("reports a downloaded update the next launch skipped, once", async () => {
    launch(EMBEDDED, 1_000, true);
    await reportLaunchHealth();
    updates.listeners[0]?.({ context: downloaded(BAD, 3_000) });
    expect(store.getString(PENDING_KEY)).toBeDefined();

    // The next cold start: BAD crashed before its first screen, so expo-updates runs the embedded bundle again.
    await reportLaunchHealth();
    expect(calls.track.mock.calls).toEqual([[{ name: "ota_launch", result: "failed_update" }]]);
    const [error, context] = sink.captureException.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(OtaLaunchError);
    expect(context).toEqual({
      tags: { source: "updates", ota_failure: "failed_update", failed_update_id: BAD, failed_update_evidence: "skipped" },
      level: "error",
      fingerprint: ["ota-launch-failure", "android", BAD],
    });
    expect(store.getString(PENDING_KEY)).toBeUndefined();

    await reportLaunchHealth();
    expect(sink.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports an update that ran last launch when this one runs an older one", async () => {
    launch(BAD, 3_000);
    await reportLaunchHealth();
    launch(GOOD, 2_000);
    await reportLaunchHealth();
    expect(sink.captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { ota_failure: "failed_update", failed_update_id: BAD, failed_update_evidence: "rolled_back" },
    });
  });

  // Review finding: on a store build (embedded launch) the id compared with was null, so any line naming the embedded
  // update read as a failed OTA; and a launch running the update it downloaded is healthy.
  it("never reports the update that runs, embedded or not", async () => {
    launch(EMBEDDED, 1_000, true);
    updates.latestContext = downloaded(BAD, 3_000);
    updates.readLogEntriesAsync.mockResolvedValue([iosMarkedFailed(EMBEDDED, 5_000)]);
    await reportLaunchHealth();
    launch(BAD, 3_000);
    await reportLaunchHealth();
    expect(sink.captureException).not.toHaveBeenCalled();
    expect(store.getString(REPORTED_THROUGH_KEY)).toBe("5000");
  });

  it("keeps a pending rollback, so the embedded launch after it is not a failure", async () => {
    launch(BAD, 3_000);
    updates.latestContext = { isUpdatePending: true, rollback: { commitTime: "2026-10-20T00:00:00Z" } };
    await reportLaunchHealth();
    launch(EMBEDDED, 1_000, true);
    updates.latestContext = {};
    await reportLaunchHealth();
    expect(sink.captureException).not.toHaveBeenCalled();
  });

  // Audit "no-emergency-launch-signal": a phone that fell back is one crash report tagged with the update that failed
  // (what scripts/mobile-release-health.mjs counts against it) and one anonymous counter.
  it("reports every emergency launch, with the update it should have run, grouped per update", async () => {
    launch(BAD, 3_000);
    await reportLaunchHealth();
    launch(EMBEDDED, 1_000, true);
    Object.assign(updates, { isEmergencyLaunch: true, emergencyLaunchReason: "launcher failed" });
    await reportLaunchHealth();
    expect(calls.track).toHaveBeenCalledWith({ name: "ota_launch", result: "emergency" });
    expect(sink.captureException.mock.calls[0]?.[1]).toEqual({
      tags: { source: "updates", ota_failure: "emergency", failed_update_id: BAD, failed_update_evidence: "rolled_back" },
      extra: { reason: "launcher failed" },
      level: "error",
      fingerprint: ["ota-launch-failure", "android", BAD],
    });

    // Unnamed (the log not read, nothing kept to compare): grouped by its kind.
    updates.readLogEntriesAsync.mockRejectedValueOnce(new Error("log locked"));
    await reportLaunchHealth();
    expect(sink.captureException.mock.calls[1]?.[1]).toMatchObject({
      tags: { ota_failure: "emergency", failed_update_id: "unknown", failed_update_evidence: "none" },
      fingerprint: ["ota-launch-failure", "android", "emergency"],
    });
  });

  it("names the update iOS marked failed once, and reads a kept mark that is not a number as nothing read", async () => {
    store.set(REPORTED_THROUGH_KEY, "garbage");
    launch(GOOD, 2_000);
    updates.readLogEntriesAsync.mockResolvedValue([iosMarkedFailed(BAD, 9_000)]);
    await reportLaunchHealth();
    await reportLaunchHealth();
    expect(calls.track.mock.calls).toEqual([[{ name: "ota_launch", result: "failed_update" }]]);
    expect(sink.captureException.mock.calls[0]?.[1]).toMatchObject({ tags: { failed_update_id: BAD, failed_update_evidence: "marked_failed" } });
    expect(store.getString(REPORTED_THROUGH_KEY)).toBe("9000");
  });

  it("keeps no launch expo-updates does not describe", async () => {
    store.set(LAST_LAUNCH_KEY, "stale");
    await reportLaunchHealth();
    expect(store.getString(LAST_LAUNCH_KEY)).toBeUndefined();
  });

  it("reads nothing where expo-updates is off (a dev build)", async () => {
    updates.isEnabled = false;
    await reportLaunchHealth();
    expect(updates.readLogEntriesAsync).not.toHaveBeenCalled();
    expect(updates.addUpdatesStateChangeListener).not.toHaveBeenCalled();
  });
});
