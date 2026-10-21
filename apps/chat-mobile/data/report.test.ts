import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "@/lib/redact";
import { breadcrumb, installReportSink, isExpectedError, isReporting, RefusedError, reportError, setReportTag, setReportUser, type ReportSink } from "./report";

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { name: "ApiError", status });

function fakeSink() {
  return {
    captureException: vi.fn<ReportSink["captureException"]>(),
    addBreadcrumb: vi.fn<ReportSink["addBreadcrumb"]>(),
    setUser: vi.fn<ReportSink["setUser"]>(),
    setTag: vi.fn<ReportSink["setTag"]>(),
  };
}

afterEach(() => installReportSink(null));

describe("without a sink (no DSN)", () => {
  it("does nothing and says so", () => {
    expect(isReporting()).toBe(false);
    expect(() => {
      reportError(new Error("x"), { source: "test" });
      breadcrumb("auth", "x");
      setReportUser("u1");
      setReportTag("channel", "production");
    }).not.toThrow();
  });
});

describe("isExpectedError", () => {
  it("treats the network, aborts and 4xx as expected; 5xx and other errors as bugs", () => {
    expect(isExpectedError(apiError(0))).toBe(true);
    expect(isExpectedError(apiError(404))).toBe(true);
    expect(isExpectedError(apiError(429))).toBe(true);
    expect(isExpectedError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isExpectedError(new RefusedError("chat_pending_op_refused"))).toBe(true);
    expect(isExpectedError(apiError(500))).toBe(false);
    expect(isExpectedError(Object.assign(new Error("x"), { name: "ApiError", status: "500" }))).toBe(false);
    expect(isExpectedError(new TypeError("undefined is not a function"))).toBe(false);
    expect(isExpectedError("a string")).toBe(false);
  });
});

describe("with a sink", () => {
  it("reports bugs with the source and the HTTP status as tags and redacted extra", () => {
    const sink = fakeSink();
    installReportSink(sink);
    expect(isReporting()).toBe(true);
    const error = apiError(503);
    reportError(error, { source: "query", tags: { key: "chat" }, extra: { url: "https://a.example/x?t=1" } });
    expect(sink.captureException).toHaveBeenCalledWith(error, {
      tags: { source: "query", key: "chat", http_status: "503" },
      extra: { url: `https://a.example/x?${REDACTED}` },
    });
  });

  it("skips expected errors unless forced, and wraps a thrown non-Error with its text redacted", () => {
    const sink = fakeSink();
    installReportSink(sink);
    reportError(apiError(404), { source: "query" });
    expect(sink.captureException).not.toHaveBeenCalled();
    reportError(apiError(404), { source: "boundary:root", force: true });
    expect(sink.captureException).toHaveBeenCalledTimes(1);
    reportError("bad token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", { source: "x" });
    const wrapped = sink.captureException.mock.calls[1]?.[0] as Error;
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe(`bad token ${REDACTED}`);
  });

  it("forwards breadcrumbs redacted, the user id and tags", () => {
    const sink = fakeSink();
    installReportSink(sink);
    breadcrumb("auth", "callback for a@b.co", "warning", { reason: "state" });
    breadcrumb("realtime", "online");
    expect(sink.addBreadcrumb).toHaveBeenNthCalledWith(1, { category: "auth", message: `callback for ${REDACTED}`, level: "warning", data: { reason: "state" } });
    expect(sink.addBreadcrumb).toHaveBeenNthCalledWith(2, { category: "realtime", message: "online", level: "info", data: undefined });
    setReportUser("u1");
    setReportUser(null);
    expect(sink.setUser.mock.calls).toEqual([["u1"], [null]]);
    setReportTag("channel", "internal");
    expect(sink.setTag).toHaveBeenCalledWith("channel", "internal");
  });
});
