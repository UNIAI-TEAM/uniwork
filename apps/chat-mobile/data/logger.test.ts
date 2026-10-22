import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { argsLogger, createLogger, enablePerfMarks, perfMark } from "./logger";
import { JS_BOOT_AT } from "./perf/boot-clock";
import { installReportSink, type ReportSink } from "./report";

const sink = {
  captureException: vi.fn<ReportSink["captureException"]>(),
  addBreadcrumb: vi.fn<ReportSink["addBreadcrumb"]>(),
  setUser: vi.fn<ReportSink["setUser"]>(),
  setTag: vi.fn<ReportSink["setTag"]>(),
};
const dev = globalThis as { __DEV__?: boolean };

beforeEach(() => {
  installReportSink(sink);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  installReportSink(null);
  delete dev.__DEV__;
  vi.restoreAllMocks();
  for (const fn of Object.values(sink)) fn.mockReset();
});

describe("createLogger", () => {
  it("leaves a breadcrumb per line and stays off the console in a release build", () => {
    const log = createLogger("auth");
    log.info("restored");
    log.warn("refresh failed", { code: "network" });
    expect(sink.addBreadcrumb.mock.calls).toEqual([
      [{ category: "auth", message: "restored", level: "info", data: undefined }],
      [{ category: "auth", message: "refresh failed", level: "warning", data: { code: "network" } }],
    ]);
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("writes to the console in a development build, at the line's level", () => {
    dev.__DEV__ = true;
    const log = createLogger("realtime");
    const error = new Error("boom");
    log.info("online");
    log.warn("refused", { reason: "not a member" });
    log.error("refresh failed", error);
    log.error("plain failure");
    expect(console.info).toHaveBeenCalledWith("[realtime] online");
    expect(console.warn).toHaveBeenCalledWith("[realtime] refused", { reason: "not a member" });
    expect(console.error).toHaveBeenNthCalledWith(1, "[realtime] refresh failed", error);
    expect(console.error).toHaveBeenNthCalledWith(2, "[realtime] plain failure");
  });

  it("reports an error line's error with the scope as its source; a line without one reports nothing", () => {
    const log = createLogger("push");
    const error = new TypeError("x is undefined");
    log.error("registration failed", error, { platform: "android" });
    log.error("nothing thrown");
    expect(sink.captureException).toHaveBeenCalledTimes(1);
    expect(sink.captureException).toHaveBeenCalledWith(error, {
      tags: { source: "push" },
      extra: { message: "registration failed", platform: "android" },
      level: "error",
    });
  });
});

describe("argsLogger", () => {
  it("keeps the message and the scalar arguments, never a string or a frame", () => {
    const ws = argsLogger("ws");
    ws.warn("[ws] socket closed", 4001, "frame text", { type: "x" });
    ws.info("[ws] dialing", "wss://api.example/ws?workspace_slug=a/b");
    ws.info("[ws] authenticated");
    expect(sink.addBreadcrumb.mock.calls).toEqual([
      [{ category: "ws", message: "[ws] socket closed", level: "warning", data: { values: "4001" } }],
      [{ category: "ws", message: "[ws] dialing", level: "info", data: undefined }],
      [{ category: "ws", message: "[ws] authenticated", level: "info", data: undefined }],
    ]);
  });

  it("keeps debug lines on the development console only", () => {
    const ws = argsLogger("ws");
    ws.debug("[ws] event", "chat.message.created");
    expect(console.debug).not.toHaveBeenCalled();
    dev.__DEV__ = true;
    ws.debug("[ws] event", "chat.message.created");
    expect(console.debug).toHaveBeenCalledWith("[ws] event", "chat.message.created");
    expect(sink.addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe("perfMark", () => {
  it("logs each startup mark once with its time, js-boot first, and only in a build that measures itself", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_729_584_001_900);
    perfMark("first-screen");
    expect(console.info).not.toHaveBeenCalled();
    const sink = vi.fn();
    enablePerfMarks(true, sink);
    perfMark("first-screen");
    perfMark("first-screen");
    perfMark("inbox");
    // js-boot is the moment the bundle started (data/perf/boot-clock.ts), logged when the marks turn on.
    expect(vi.mocked(console.info).mock.calls).toEqual([
      [`UniChatPerf mark=js-boot at=${JS_BOOT_AT}`],
      ["UniChatPerf mark=first-screen at=1729584001900"],
      ["UniChatPerf mark=inbox at=1729584001900"],
    ]);
    // The sink gets every mark so far, each time: a file rewritten whole (data/perf/marks-file.ts).
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenLastCalledWith(
      [`UniChatPerf mark=js-boot at=${JS_BOOT_AT}`, "UniChatPerf mark=first-screen at=1729584001900", "UniChatPerf mark=inbox at=1729584001900"].join("\n"),
    );
    // Off again: no mark, no sink; on without a sink still logs.
    enablePerfMarks(false, sink);
    perfMark("settings");
    enablePerfMarks(true);
    perfMark("settings");
    expect(sink).toHaveBeenCalledTimes(3);
    expect(console.info).toHaveBeenLastCalledWith("UniChatPerf mark=settings at=1729584001900");
    enablePerfMarks(false);
  });
});

describe("React Native's bundle-entry mark", () => {
  it("logs it at an epoch time beside js-boot, in one write, and never breaks a runtime without it", async () => {
    // A fresh module: each mark is logged once per process, and the test above already logged js-boot.
    vi.resetModules();
    const fresh = await import("./logger");
    const { JS_BOOT_AT: bootAt } = await import("./perf/boot-clock");
    const marksSink = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1_729_584_001_900);
    try {
      // No performance object at all: js-boot alone.
      vi.stubGlobal("performance", undefined);
      fresh.enablePerfMarks(true, marksSink);
      expect(marksSink).toHaveBeenLastCalledWith(`UniChatPerf mark=js-boot at=${bootAt}`);
      // A getter that throws, a runtime without performance.now, a field the platform did not set, or a time that is
      // not a real moment (infinite, zero): no mark, no write, no throw.
      vi.stubGlobal("performance", {
        now: () => 5_000,
        get rnStartupTiming(): never {
          throw new Error("not supported");
        },
      });
      fresh.enablePerfMarks(true, marksSink);
      vi.stubGlobal("performance", { rnStartupTiming: { executeJavaScriptBundleEntryPointStart: 4_000 } });
      fresh.enablePerfMarks(true, marksSink);
      for (const executeJavaScriptBundleEntryPointStart of [null, Number.POSITIVE_INFINITY, 0]) {
        vi.stubGlobal("performance", { now: () => 5_000, rnStartupTiming: { executeJavaScriptBundleEntryPointStart } });
        fresh.enablePerfMarks(true, marksSink);
      }
      expect(marksSink).toHaveBeenCalledTimes(1);
      // Ms on performance.now()'s clock become epoch ms. startTime and initializeRuntimeStart name the same moment on
      // the bridgeless runtime: they are not marks.
      vi.stubGlobal("performance", {
        now: () => 5_000,
        rnStartupTiming: { startTime: 3_999.6, initializeRuntimeStart: 3_999.8, executeJavaScriptBundleEntryPointStart: 4_000.4 },
      });
      fresh.enablePerfMarks(true, marksSink);
      expect(marksSink).toHaveBeenCalledTimes(2);
      expect(marksSink).toHaveBeenLastCalledWith([`UniChatPerf mark=js-boot at=${bootAt}`, "UniChatPerf mark=rn-bundle-entry at=1729584000900"].join("\n"));
      // Once per process.
      vi.stubGlobal("performance", { now: () => 5_000, rnStartupTiming: { executeJavaScriptBundleEntryPointStart: 4_500 } });
      fresh.enablePerfMarks(true, marksSink);
      expect(marksSink).toHaveBeenCalledTimes(2);
    } finally {
      fresh.enablePerfMarks(false);
      vi.unstubAllGlobals();
    }
  });
});
