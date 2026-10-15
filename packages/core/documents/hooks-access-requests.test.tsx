import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import {
  accessRequestOutcome,
  clearDocumentAccessRequestSent,
  readDocumentAccessRequestSent,
  useRequestDocumentAccess,
} from "./hooks-access-requests";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const errorJson = (status: number, code?: string, fields?: Record<string, unknown>) =>
  json({ error: { message: "x", ...(code ? { code } : {}), ...(fields ? { fields } : {}) } }, status);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("documentKeys.accessRequests", () => {
  it("hangs off the detail key like shares", () => {
    expect(documentKeys.accessRequests("ws1", "d1")).toEqual([...documentKeys.detail("ws1", "d1"), "access-requests"]);
  });
});

describe("accessRequestOutcome", () => {
  it("reads 409 access_request_pending as already pending, not an error", () => {
    expect(accessRequestOutcome(new ApiError("x", "access_request_pending", 409))).toEqual({ state: "already_pending" });
  });

  it("reads 429 access_request_cooldown with the seconds left", () => {
    const err = new ApiError("x", "access_request_cooldown", 429, undefined, { retry_after_seconds: 1500 });
    expect(accessRequestOutcome(err)).toEqual({ state: "cooldown", retryAfterSeconds: 1500 });
  });

  it("falls back to the Retry-After header, then to one second, for a cooldown", () => {
    const header = new ApiError("x", "access_request_cooldown", 429, undefined, undefined, undefined, 90);
    expect(accessRequestOutcome(header)).toEqual({ state: "cooldown", retryAfterSeconds: 90 });
    const bare = new ApiError("x", "access_request_cooldown", 429, undefined, { retry_after_seconds: "soon" });
    expect(accessRequestOutcome(bare)).toEqual({ state: "cooldown", retryAfterSeconds: 1 });
  });

  it("reads a 429 without the cooldown code as the limiter", () => {
    expect(accessRequestOutcome(new ApiError("x", "", 429))).toEqual({ state: "rate_limited" });
    expect(accessRequestOutcome(new ApiError("x", "rate_limited", 429))).toEqual({ state: "rate_limited" });
  });

  it("reads anything else as a failed send", () => {
    expect(accessRequestOutcome(new ApiError("x", "internal", 500))).toEqual({ state: "send_failed" });
    expect(accessRequestOutcome(new TypeError("fetch failed"))).toEqual({ state: "send_failed" });
  });
});

describe("useRequestDocumentAccess", () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetRuntimeConfig();
    setAccessToken(null);
    localStorage.clear();
  });

  it("awaits the 202, marks the request sent on this device and invalidates the requests key", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "sent" }, 202));
    const { result } = renderHook(() => useRequestDocumentAccess("ws1", "d1"), { wrapper });
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ requested_level: "view" });
    });
    expect(out).toEqual({ state: "sent" });
    expect(readDocumentAccessRequestSent("d1")).toBe(true);
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(documentKeys.accessRequests("ws1", "d1"));
  });

  it("resolves already_pending on 409 and sets the flag even when it was lost", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(errorJson(409, "access_request_pending"));
    const { result } = renderHook(() => useRequestDocumentAccess("ws1", "d1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ requested_level: "edit" });
    });
    expect(out).toEqual({ state: "already_pending" });
    expect(readDocumentAccessRequestSent("d1")).toBe(true);
  });

  it("rejects a cooldown with the outcome attached and leaves no flag", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(errorJson(429, "access_request_cooldown", { retry_after_seconds: 61 }));
    const { result } = renderHook(() => useRequestDocumentAccess("ws1", "d1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({}).catch((e: unknown) => accessRequestOutcome(e));
    });
    expect(out).toEqual({ state: "cooldown", retryAfterSeconds: 61 });
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
  });

  it("treats an unverifiable 202 body as a failed send", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }, 202));
    const { result } = renderHook(() => useRequestDocumentAccess("ws1", "d1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({}).catch((e: unknown) => accessRequestOutcome(e));
    });
    expect(out).toEqual({ state: "send_failed" });
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
  });
});

describe("the sent flag", () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("lasts 24 hours per document and clears on demand", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
    localStorage.setItem("uniwork_document_access_request_sent:d1", String(Date.now() + 24 * 3600_000));
    expect(readDocumentAccessRequestSent("d1")).toBe(true);
    expect(readDocumentAccessRequestSent("d2")).toBe(false);
    vi.setSystemTime(new Date("2026-10-16T00:00:01Z"));
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
    localStorage.setItem("uniwork_document_access_request_sent:d1", String(Date.now() + 1000));
    clearDocumentAccessRequestSent("d1");
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
  });

  it("ignores a garbled value", () => {
    localStorage.setItem("uniwork_document_access_request_sent:d1", "yes");
    expect(readDocumentAccessRequestSent("d1")).toBe(false);
  });
});
