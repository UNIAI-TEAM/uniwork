import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { argsLogger, createLogger, enablePerfMarks, perfMark } from "./logger";
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
  it("logs each startup mark once, and only in a build that measures itself", () => {
    perfMark("first-screen");
    expect(console.info).not.toHaveBeenCalled();
    enablePerfMarks(true);
    perfMark("first-screen");
    perfMark("first-screen");
    perfMark("inbox");
    expect(vi.mocked(console.info).mock.calls).toEqual([["UniChatPerf mark=first-screen"], ["UniChatPerf mark=inbox"]]);
    enablePerfMarks(false);
  });
});
