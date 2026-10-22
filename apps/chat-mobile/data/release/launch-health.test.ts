import { beforeEach, describe, expect, it, vi } from "vitest";

const BAD = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const updates = vi.hoisted(() => ({
  isEnabled: true,
  isEmergencyLaunch: false,
  isEmbeddedLaunch: true,
  updateId: null as string | null,
  emergencyLaunchReason: null as string | null,
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
import { LOG_WINDOW_MS, OtaLaunchError, REPORTED_THROUGH_KEY, reportLaunchHealth } from "./launch-health";

const failedLine = (timestamp: number) => ({ timestamp, message: "loadRemoteUpdate onFailure", code: "UpdateFailedToLoad", level: "error", updateId: BAD });

let store: DeviceStore;
let sink: { captureException: ReturnType<typeof vi.fn<ReportSink["captureException"]>> } & ReportSink;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(updates, { isEnabled: true, isEmergencyLaunch: false, isEmbeddedLaunch: true, updateId: null, emergencyLaunchReason: null });
  store = memoryDeviceStore();
  installDeviceStore(async () => store);
  sink = { captureException: vi.fn(), addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() };
  installReportSink(sink);
});

describe("reportLaunchHealth", () => {
  it("does nothing on a clean launch, and counts a run that ended in a crash", async () => {
    await reportLaunchHealth();
    expect(calls.track).not.toHaveBeenCalled();
    expect(sink.captureException).not.toHaveBeenCalled();
    expect(updates.readLogEntriesAsync).toHaveBeenCalledWith(LOG_WINDOW_MS);
    calls.crashedLastRun.mockResolvedValueOnce(true);
    await reportLaunchHealth();
    expect(calls.track).toHaveBeenCalledWith({ name: "app_crash", result: "last_run" });
  });

  // Audit "no-emergency-launch-signal": a phone that fell back is one crash report tagged with the update that failed
  // (what scripts/mobile-release-health.mjs counts against it) and one anonymous counter.
  it("reports an emergency launch with the failed update, grouped per update", async () => {
    Object.assign(updates, { isEmergencyLaunch: true, emergencyLaunchReason: "launcher failed" });
    updates.readLogEntriesAsync.mockResolvedValueOnce([failedLine(5_000)]);
    await reportLaunchHealth();
    expect(calls.track).toHaveBeenCalledWith({ name: "ota_launch", result: "emergency" });
    const [error, context] = sink.captureException.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(OtaLaunchError);
    expect(context).toEqual({
      tags: { source: "updates", ota_failure: "emergency", failed_update_id: BAD, failed_update_code: "UpdateFailedToLoad" },
      extra: { reason: "launcher failed" },
      level: "error",
      fingerprint: ["ota-launch-failure", "android", BAD],
    });
    expect(store.getString(REPORTED_THROUGH_KEY)).toBe("5000");
  });

  it("reports an update that failed to load once, and an unnamed emergency by its kind", async () => {
    Object.assign(updates, { isEmbeddedLaunch: false, updateId: "0193a1b2-0000-7e5f-8a9b-0c1d2e3f4a5b" });
    updates.readLogEntriesAsync.mockResolvedValue([failedLine(7_000)]);
    await reportLaunchHealth();
    await reportLaunchHealth();
    expect(calls.track.mock.calls).toEqual([[{ name: "ota_launch", result: "failed_update" }]]);
    expect(sink.captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { ota_failure: "failed_update", failed_update_id: BAD },
    });
    expect(sink.captureException.mock.calls[0]?.[1].extra).toBeUndefined();

    updates.readLogEntriesAsync.mockReset();
    updates.readLogEntriesAsync.mockRejectedValueOnce(new Error("log locked"));
    Object.assign(updates, { isEmergencyLaunch: true });
    await reportLaunchHealth();
    expect(sink.captureException.mock.calls[1]?.[1]).toMatchObject({
      tags: { ota_failure: "emergency", failed_update_id: "unknown", failed_update_code: "Unknown" },
      fingerprint: ["ota-launch-failure", "android", "emergency"],
    });
    expect(store.getString(REPORTED_THROUGH_KEY)).toBe("7000");
  });

  it("reads a kept mark that is not a number as nothing read", async () => {
    store.set(REPORTED_THROUGH_KEY, "garbage");
    updates.readLogEntriesAsync.mockResolvedValueOnce([failedLine(9_000)]);
    await reportLaunchHealth();
    expect(calls.track).toHaveBeenCalledWith({ name: "ota_launch", result: "failed_update" });
    expect(store.getString(REPORTED_THROUGH_KEY)).toBe("9000");
  });

  it("reads nothing where expo-updates is off (a dev build)", async () => {
    updates.isEnabled = false;
    await reportLaunchHealth();
    expect(updates.readLogEntriesAsync).not.toHaveBeenCalled();
  });
});
