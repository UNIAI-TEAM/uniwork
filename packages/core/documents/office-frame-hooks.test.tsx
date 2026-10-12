import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { officeFrameKeys, officeFrameRefetchInterval, useOfficeFrameToken } from "./office-frame-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const token = {
  token: "oft1.payload.sig",
  token_type: "Bearer",
  expires_at: "2026-10-08T10:10:00Z",
  expires_in: 600,
  document_id: "d1",
  workspace_id: "ws1",
  organization_id: "o1",
  can_edit: true,
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useOfficeFrameToken", () => {
  beforeEach(() => {
    setAccessToken("tok");
    configureRuntime({ apiUrl: "http://api.test" });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("keys the token by workspace and document", () => {
    expect(officeFrameKeys.token("ws1", "d1")).toEqual(["office", "ws1", "d1", "frame-token"]);
  });

  it("re-mints a minute before expiry and not without a token", () => {
    expect(officeFrameRefetchInterval(token)).toBe(540_000);
    expect(officeFrameRefetchInterval({ ...token, expires_in: 30 })).toBe(5_000);
    expect(officeFrameRefetchInterval(null)).toBe(false);
  });

  it("mints through the session endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(token, 201));
    const { result } = renderHook(() => useOfficeFrameToken("ws1", "d1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(token));
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("http://api.test/api/v1/documents/d1/office/frame-token");
  });

  it("stays idle when disabled or missing ids", () => {
    renderHook(() => useOfficeFrameToken("ws1", "d1", { enabled: false }), { wrapper: wrapper() });
    renderHook(() => useOfficeFrameToken("", "d1"), { wrapper: wrapper() });
    expect(fetch).not.toHaveBeenCalled();
  });
});
