import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSheetError } from "@/lib/provider-sheet-error";
import { REDACTED } from "@/lib/redact";
import { SchemaMismatchError } from "@/lib/schema-mismatch";
import { bestEffort, breadcrumb, classifyError, installReportSink, isReporting, RefusedError, reportError, schemaDriftLogger, setReportTag, setReportUser, type ReportSink } from "./report";

const apiError = (status: number, extra: { body?: unknown; endpoint?: string } = {}) => Object.assign(new Error(`HTTP ${status}`), { name: "ApiError", status, ...extra });
const coded = (status: number, code: unknown) => apiError(status, { body: { error: { code } }, endpoint: "POST /api/v1/me/delete" });

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

describe("classifyError", () => {
  it("treats the network, aborts and the statuses of normal use as expected", () => {
    for (const status of [0, 401, 403, 404, 408, 410, 429]) expect(classifyError(apiError(status)), String(status)).toBe("expected");
    expect(classifyError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("expected");
    expect(classifyError(new RefusedError("chat_pending_op_refused"))).toBe("expected");
  });

  it("reads any other 4xx as contract drift, unless the caller handles its code", () => {
    for (const status of [400, 405, 409, 413, 415, 422]) expect(classifyError(apiError(status)), String(status)).toBe("contract");
    expect(classifyError(coded(409, "owner_must_transfer"), ["owner_must_transfer"])).toBe("expected");
    expect(classifyError(coded(409, "owner_must_transfer"), ["password_incorrect"])).toBe("contract");
    expect(classifyError(coded(400, 7), ["7"])).toBe("contract");
    expect(classifyError(apiError(400, { body: { error: "flat" } }), ["flat"])).toBe("contract");
    expect(classifyError(apiError(400, { body: null }))).toBe("contract");
  });

  it("reads the auth transport's error by its code and status", () => {
    const transport = (code: unknown, status?: unknown) => Object.assign(new Error("uniwork request failed"), { name: "TransportError", code, status });
    expect(classifyError(transport("network"))).toBe("expected");
    expect(classifyError(transport("timeout"))).toBe("expected");
    expect(classifyError(transport("sign_in_expired"), ["sign_in_expired"])).toBe("expected");
    expect(classifyError(transport("rate_limited", 429))).toBe("expected");
    expect(classifyError(transport("invalid_request", 400))).toBe("contract");
    expect(classifyError(transport("conflict", 409), ["conflict"])).toBe("expected");
    expect(classifyError(transport("server_error", 503))).toBe("bug");
    expect(classifyError(transport("malformed_response"))).toBe("bug");
    expect(classifyError(transport(7, "400"))).toBe("bug");
  });

  it("reads a provider's sheet failing as the person's device or network, unless this build is at fault", () => {
    expect(classifyError(new ProviderSheetError("google", "ERR_GOOGLE_SIGN_IN", "Network error"))).toBe("expected");
    expect(classifyError(new ProviderSheetError("apple", "ERR_REQUEST_FAILED", ""))).toBe("expected");
    expect(classifyError(new ProviderSheetError("google", "ERR_GOOGLE_NOT_CONFIGURED", ""))).toBe("bug");
    expect(classifyError(new ProviderSheetError("google", "ERR_GOOGLE_SIGN_IN", "[28444] Developer console is not set up correctly."))).toBe("bug");
  });

  it("reads a 5xx and every other error as a bug", () => {
    expect(classifyError(apiError(500))).toBe("bug");
    expect(classifyError(Object.assign(new Error("x"), { name: "ApiError", status: "500" }))).toBe("bug");
    expect(classifyError(new TypeError("undefined is not a function"))).toBe("bug");
    expect(classifyError("a string")).toBe("bug");
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
      level: "error",
    });
  });

  it("tags an auth transport's error with its code, and its status when the server answered", () => {
    const sink = fakeSink();
    installReportSink(sink);
    const drift = Object.assign(new Error("uniwork request failed"), { name: "TransportError", code: "invalid_request", status: 400 });
    reportError(drift, { source: "mutation" });
    expect(sink.captureException).toHaveBeenLastCalledWith(drift, expect.objectContaining({
      tags: { source: "mutation", error_code: "invalid_request", http_status: "400" },
      level: "warning",
    }));
    const unread = Object.assign(new Error("uniwork request failed"), { name: "TransportError", code: "malformed_response" });
    reportError(unread, { source: "mutation" });
    expect(sink.captureException).toHaveBeenLastCalledWith(unread, expect.objectContaining({
      tags: { source: "mutation", error_code: "malformed_response" },
      level: "error",
    }));
  });

  it("reports contract drift at warning level, grouped by endpoint, status and code", () => {
    const sink = fakeSink();
    installReportSink(sink);
    const drift = coded(422, "validation_failed");
    reportError(drift, { source: "mutation" });
    expect(sink.captureException).toHaveBeenCalledWith(drift, {
      tags: { source: "mutation", http_status: "422", error_code: "validation_failed", endpoint: "POST /api/v1/me/delete" },
      extra: undefined,
      level: "warning",
      fingerprint: ["api-error", "POST /api/v1/me/delete", "422", "validation_failed"],
    });
    reportError(coded(409, "owner_must_transfer"), { source: "mutation", handledCodes: ["owner_must_transfer"] });
    expect(sink.captureException).toHaveBeenCalledTimes(1);
    const bare = apiError(400, { endpoint: "GET /api/v1/x" });
    reportError(bare, { source: "boundary:root", force: true });
    expect(sink.captureException).toHaveBeenLastCalledWith(bare, expect.objectContaining({ level: "error", fingerprint: ["api-error", "GET /api/v1/x", "400", ""] }));
  });

  it("groups by the caller's fingerprint when the error names no endpoint", () => {
    const sink = fakeSink();
    installReportSink(sink);
    const failure = new Error("an OTA update failed to launch");
    reportError(failure, { source: "updates", fingerprint: ["ota-launch-failure", "android", "u1"] });
    expect(sink.captureException).toHaveBeenCalledWith(failure, expect.objectContaining({ fingerprint: ["ota-launch-failure", "android", "u1"] }));
    const routed = apiError(500, { endpoint: "GET /api/v1/x" });
    reportError(routed, { source: "query", fingerprint: ["ignored"] });
    expect(sink.captureException).toHaveBeenLastCalledWith(routed, expect.objectContaining({ fingerprint: ["api-error", "GET /api/v1/x", "500", ""] }));
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

describe("bestEffort", () => {
  it("leaves a breadcrumb for every failure, and reports only when asked and not expected", () => {
    const sink = fakeSink();
    installReportSink(sink);
    expect(bestEffort("calls", "hangup not sent", "report")(apiError(503))).toBeUndefined();
    expect(sink.addBreadcrumb).toHaveBeenLastCalledWith({ category: "calls", message: "hangup not sent", level: "warning", data: { error: "ApiError", status: 503 } });
    expect(sink.captureException).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }), expect.objectContaining({ tags: { source: "calls", http_status: "503" }, extra: { what: "hangup not sent" } }));
    bestEffort("calls", "hangup not sent", "report")(apiError(0));
    bestEffort("haptics", "haptic not played", "breadcrumb")(new Error("unsupported"));
    bestEffort("haptics", "haptic not played", "breadcrumb")("odd");
    expect(sink.captureException).toHaveBeenCalledTimes(1);
    expect(sink.addBreadcrumb.mock.calls.map(([crumb]) => crumb.data)).toEqual([
      { error: "ApiError", status: 503 },
      { error: "ApiError", status: 0 },
      { error: "Error" },
      { error: "string" },
    ]);
  });
});

// A response the app could not read is drift between the build and the server: crash reporting hears of it by
// endpoint and paths, never with the body (workspace names, messages and people are tenant data).
describe("schema drift", () => {
  it("reports a SchemaMismatchError as an error, tagged and grouped by its endpoint, without the body", () => {
    const sink = fakeSink();
    installReportSink(sink);
    const error = new SchemaMismatchError("GET /api/v1/workspaces", [{ path: "workspaces", code: "invalid_type" }]);
    expect(classifyError(error)).toBe("bug");
    reportError(error, { source: "query", tags: { query: "workspaces" } });
    expect(sink.captureException).toHaveBeenCalledWith(error, {
      tags: { source: "query", query: "workspaces", endpoint: "GET /api/v1/workspaces" },
      extra: { issues: "workspaces invalid_type" },
      level: "error",
      fingerprint: ["schema-mismatch", "GET /api/v1/workspaces"],
    });
  });

  it("reports what parseWithFallback fell back on at warning level, dropping the received body", () => {
    const sink = fakeSink();
    installReportSink(sink);
    schemaDriftLogger.warn("API response failed schema validation: GET /api/v1/me", {
      endpoint: "GET /api/v1/me",
      issues: [{ path: ["user", "id"], code: "invalid_type", message: "Expected string, received number" }],
      received: { user: { id: 7, email: "an@example.com" } },
    });
    const [error, context] = sink.captureException.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(SchemaMismatchError);
    expect(context).toEqual({
      tags: { source: "schema", endpoint: "GET /api/v1/me" },
      extra: { issues: "user.id invalid_type" },
      level: "warning",
      fingerprint: ["schema-mismatch", "GET /api/v1/me"],
    });
    expect(JSON.stringify(sink.captureException.mock.calls)).not.toContain("an@example.com");
  });

  it("reports each endpoint once per run, then leaves breadcrumbs; a line without an endpoint is \"unknown\"", () => {
    const sink = fakeSink();
    installReportSink(sink);
    schemaDriftLogger.debug("x");
    schemaDriftLogger.info("x", null);
    schemaDriftLogger.error("x", { endpoint: 7 });
    schemaDriftLogger.warn("y", { endpoint: "GET /api/v1/rooms", issues: [] });
    schemaDriftLogger.warn("y", { endpoint: "GET /api/v1/rooms", issues: [] });
    expect(sink.captureException.mock.calls.map(([, context]) => context.tags.endpoint)).toEqual(["unknown", "GET /api/v1/rooms"]);
    expect(sink.addBreadcrumb.mock.calls.map(([crumb]) => crumb.data)).toEqual([{ endpoint: "unknown" }, { endpoint: "unknown" }, { endpoint: "GET /api/v1/rooms" }]);
  });
});
