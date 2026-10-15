import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  useDocumentAdminSummary,
  useGrantDocumentBreakGlass,
  useRevokeDocumentBreakGlass,
} from "./break-glass-queries";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const grant = {
  id: "bg1",
  document_id: "d1",
  actor_id: "u1",
  actor_name: "An",
  level: "view",
  reason: "Kiểm tra sự cố bảo mật",
  granted_at: "2026-10-15T02:00:00Z",
  expires_at: "2026-10-16T02:00:00Z",
};

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("break-glass queries (DOC-05)", () => {
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

  it("useDocumentAdminSummary reads under documentKeys.adminSummary and stays idle when disabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document: { id: "d1", workspace_id: "w1", kind: "page", title: "Hồ sơ" },
        acl_owner: { user_id: "u9", level: "manage" },
        my_level: "",
        admin_scope: true,
        my_grant: grant,
      }),
    );
    const { qc, wrapper } = setup();
    const idle = renderHook(() => useDocumentAdminSummary("w1", "d1", false), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();

    const { result } = renderHook(() => useDocumentAdminSummary("w1", "d1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/documents/d1/admin-summary",
    );
    expect(result.current.data?.my_grant?.id).toBe("bg1");
    expect(qc.getQueryData(documentKeys.adminSummary("w1", "d1"))).toBeDefined();
  });

  it("useGrantDocumentBreakGlass posts the reason and invalidates detail, shares and the access log", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ grant }, 201));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.detail("w1", "d1"), { id: "d1" });
    qc.setQueryData(documentKeys.shares("w1", "d1"), {});
    qc.setQueryData(documentKeys.accessLogs("w1", "d1"), {});
    const { result } = renderHook(() => useGrantDocumentBreakGlass("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("Kiểm tra sự cố bảo mật");
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/break-glass");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "Kiểm tra sự cố bảo mật" });
    expect(qc.getQueryState(documentKeys.detail("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.accessLogs("w1", "d1"))?.isInvalidated).toBe(true);
  });

  it("useRevokeDocumentBreakGlass deletes the grant it is given and invalidates the same keys", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.detail("w1", "d1"), { id: "d1" });
    qc.setQueryData(documentKeys.accessLogs("w1", "d1"), {});
    const { result } = renderHook(() => useRevokeDocumentBreakGlass("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("bg1");
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/break-glass/bg1");
    expect(init?.method).toBe("DELETE");
    expect(qc.getQueryState(documentKeys.detail("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.accessLogs("w1", "d1"))?.isInvalidated).toBe(true);
  });
});
