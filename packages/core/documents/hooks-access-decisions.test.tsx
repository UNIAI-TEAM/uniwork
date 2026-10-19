import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import {
  useApproveDocumentAccessRequest,
  useDeclineDocumentAccessRequest,
  useDocumentAccessRequests,
} from "./hooks-access-decisions";
import { documentKeys } from "./keys";

// W-DOC07 B, access addendum §3.4: approve and decline are permission changes,
// so they await the server (no optimistic row), then refresh the request list
// and the document's shares; a 409 access_request_closed refreshes the list too.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const row = {
  id: "r1",
  requester_id: "u2",
  requester_name: "Bình",
  requested_level: "view",
  message: "Cần xem",
  source: null,
  created_at: "2026-10-15T01:00:00Z",
  expires_at: "2026-11-14T01:00:00Z",
};

beforeEach(() => {
  setAccessToken("tok");
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
});

describe("useDocumentAccessRequests", () => {
  it("reads the pending rows once enabled", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ requests: [row] }));
    const { result } = renderHook(() => useDocumentAccessRequests("ws1", "d1", { enabled: true }), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]).toMatchObject({ id: "r1", requested_level: "view" });
  });

  it("does not fetch while disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useDocumentAccessRequests("ws1", "d1", { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("useApproveDocumentAccessRequest", () => {
  it("awaits the server with the chosen level, then invalidates the requests, the shares and the shared-by-me root", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "approved", share_id: "s1" }));
    const { result } = renderHook(() => useApproveDocumentAccessRequest("ws1", "d1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ requestId: "r1", level: "edit" });
    });
    expect(out).toMatchObject({ id: "r1", status: "approved", share_id: "s1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access-requests/r1/approve");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ level: "edit" });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(documentKeys.accessRequests("ws1", "d1"));
    expect(keys).toContainEqual(documentKeys.shares("ws1", "d1"));
    // Approve granted access, so the caller's Shared by me list refreshes
    // without waiting for a document.shared frame (UNI-1851 F2).
    expect(keys).toContainEqual(documentKeys.sharedByMe("ws1"));
  });

  it("refuses an answer that is not an approval of this request", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "other", status: "approved" }));
    const { result } = renderHook(() => useApproveDocumentAccessRequest("ws1", "d1"), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ requestId: "r1", level: "view" }).catch((e: unknown) => e);
    });
    expect(isDocumentNotVerifiable(caught)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes the list when the request was already closed, and rethrows", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "access_request_closed", message: "closed" } }, 409),
    );
    const { result } = renderHook(() => useApproveDocumentAccessRequest("ws1", "d1"), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ requestId: "r1", level: "view" }).catch((e: unknown) => e);
    });
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("access_request_closed");
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(documentKeys.accessRequests("ws1", "d1"));
  });
});

describe("useDeclineDocumentAccessRequest", () => {
  it("awaits the server, then invalidates the requests and the shares", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "declined" }));
    const { result } = renderHook(() => useDeclineDocumentAccessRequest("ws1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ requestId: "r1" });
    });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/access-requests/r1/decline");
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(documentKeys.accessRequests("ws1", "d1"));
    expect(keys).toContainEqual(documentKeys.shares("ws1", "d1"));
    // Decline grants nothing: Shared by me stays as it is.
    expect(keys).not.toContainEqual(documentKeys.sharedByMe("ws1"));
  });

  it("refuses an answer that is not a decline of this request", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "approved" }));
    const { result } = renderHook(() => useDeclineDocumentAccessRequest("ws1", "d1"), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ requestId: "r1" }).catch((e: unknown) => e);
    });
    expect(isDocumentNotVerifiable(caught)).toBe(true);
  });
});
