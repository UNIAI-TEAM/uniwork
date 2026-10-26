import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMutationError, reportQueryError } from "./query-errors";
import { installReportSink, type ReportSink } from "./report";

const captureException = vi.fn<ReportSink["captureException"]>();
installReportSink({ captureException, addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
afterEach(() => captureException.mockReset());

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { name: "ApiError", status });

describe("query and mutation error reporters", () => {
  it("report a failed query by the root of its key, never its ids", () => {
    const error = apiError(502);
    reportQueryError(error, { queryKey: ["chat", "ws1", "rooms"] });
    expect(captureException).toHaveBeenCalledWith(error, { tags: { source: "query", query: "chat", http_status: "502" }, extra: undefined, level: "error" });
    reportQueryError(new TypeError("x"), { queryKey: [{ scope: "x" }] });
    expect(captureException.mock.calls[1]?.[1].tags.query).toBe("unkeyed");
  });

  it("report a failed mutation by its key, or as unkeyed", () => {
    const error = new SyntaxError("Unexpected token");
    reportMutationError(error, {}, undefined, { options: { mutationKey: ["devices", "revoke"] } });
    reportMutationError(error, {}, undefined, { options: {} });
    expect(captureException.mock.calls.map((call) => call[1].tags)).toEqual([
      { source: "mutation", mutation: "devices" },
      { source: "mutation", mutation: "unkeyed" },
    ]);
  });

  // Offline is status 0: data/api.ts turns React Native's network TypeError and
  // its own timeout into one (data/api.test.ts drives the real fetch failure).
  it("stay quiet for the expected: offline, a refusal, and a code the command handles", () => {
    reportQueryError(apiError(0), { queryKey: ["me"] });
    reportMutationError(apiError(403), {}, undefined, { options: {} });
    const owner = Object.assign(apiError(409), { body: { error: { code: "owner_must_transfer" } } });
    reportMutationError(owner, {}, undefined, { options: { mutationKey: ["account.delete"], meta: { handledCodes: ["owner_must_transfer", 7] } } });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("report a 4xx nobody handles as contract drift, at warning level", () => {
    reportMutationError(apiError(422), {}, undefined, { options: { mutationKey: ["chat.edit_message"], meta: { handledCodes: "owner_must_transfer" } } });
    expect(captureException.mock.calls[0]?.[1].level).toBe("warning");
  });
});
