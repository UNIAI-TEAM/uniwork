import { describe, expect, it } from "vitest";
import { otaLaunchFailure } from "./ota-launch";

const BAD = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const GOOD = "0193a1b2-0000-7e5f-8a9b-0c1d2e3f4a5b";

const entry = (over: Record<string, unknown> = {}) => ({
  timestamp: 1_000,
  message: "UpdatesController loadRemoteUpdate onFailure",
  code: "UpdateFailedToLoad",
  level: "error",
  updateId: BAD,
  ...over,
});

describe("otaLaunchFailure", () => {
  it("reports nothing for a clean launch, and remembers how far it read", () => {
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: GOOD, entries: [], reportedThrough: 0 })).toEqual({
      failure: null,
      reportedThrough: 0,
    });
    const info = entry({ level: "info", code: "NoUpdatesAvailable", timestamp: 5_000 });
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: GOOD, entries: [info], reportedThrough: 0 })).toEqual({
      failure: null,
      reportedThrough: 5_000,
    });
  });

  // Audit "no-emergency-launch-signal": a phone that fell back to the embedded bundle reported as `embedded`, and no
  // event said an update failed to launch.
  it("reports an emergency launch with the update that failed, whatever its code", () => {
    const entries = [entry({ timestamp: 900, updateId: GOOD }), entry({ timestamp: 1_000, code: "Unknown", level: "fatal" })];
    expect(otaLaunchFailure({ isEmergencyLaunch: true, runningUpdateId: null, entries, reportedThrough: 0 })).toEqual({
      failure: { kind: "emergency", failedUpdateId: BAD, code: "Unknown" },
      reportedThrough: 1_000,
    });
  });

  it("reports every emergency launch, naming the failed update even from a line read before", () => {
    expect(otaLaunchFailure({ isEmergencyLaunch: true, runningUpdateId: null, entries: [entry()], reportedThrough: 2_000 })).toEqual({
      failure: { kind: "emergency", failedUpdateId: BAD, code: "UpdateFailedToLoad" },
      reportedThrough: 2_000,
    });
    expect(otaLaunchFailure({ isEmergencyLaunch: true, runningUpdateId: null, entries: [entry({ updateId: undefined })], reportedThrough: 0 })).toEqual({
      failure: { kind: "emergency", failedUpdateId: null, code: "Unknown" },
      reportedThrough: 1_000,
    });
  });

  it("reports an update that failed to load once, by the newest such line not read before", () => {
    const entries = [
      entry({ timestamp: 800, code: "AssetsFailedToLoad", updateId: GOOD.toUpperCase() }),
      entry({ timestamp: 1_200, code: "UpdateHasInvalidSignature" }),
      entry({ timestamp: 1_100, code: "UpdateCodeSigningError", updateId: GOOD }),
    ];
    const first = otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: null, entries, reportedThrough: 0 });
    expect(first).toEqual({ failure: { kind: "failed_update", failedUpdateId: BAD, code: "UpdateHasInvalidSignature" }, reportedThrough: 1_200 });
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: null, entries, reportedThrough: first.reportedThrough }).failure).toBeNull();
  });

  it("ignores the update that runs now, lines without an update, warnings and unrelated codes", () => {
    const entries = [
      entry({ updateId: GOOD.toUpperCase() }),
      entry({ updateId: undefined, timestamp: 1_001 }),
      entry({ level: "warn", timestamp: 1_002 }),
      entry({ code: "UpdateServerUnreachable", timestamp: 1_003 }),
    ];
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: GOOD, entries, reportedThrough: 0 })).toEqual({
      failure: null,
      reportedThrough: 1_003,
    });
  });

  it("reads a log that is not what expo-updates documents as empty", () => {
    const junk = [null, "x", { timestamp: "1", code: "UpdateFailedToLoad", level: "error", updateId: BAD }, { timestamp: 7, level: 3 }];
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: null, entries: junk, reportedThrough: 3 })).toEqual({
      failure: null,
      reportedThrough: 7,
    });
    expect(otaLaunchFailure({ isEmergencyLaunch: false, runningUpdateId: null, entries: "not a list", reportedThrough: 3 }).reportedThrough).toBe(3);
  });
});
