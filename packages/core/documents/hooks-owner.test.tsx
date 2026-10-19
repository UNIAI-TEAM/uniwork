import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import { useTransferDocumentOwner } from "./hooks-owner";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useTransferDocumentOwner", () => {
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

  it("awaits the server, then invalidates the document and the workspace lists", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document_id: "d1", acl_owner_id: "u3", previous_owner_id: "u1", previous_owner_share_id: "s9" }),
    );
    const { result } = renderHook(() => useTransferDocumentOwner("ws1", "d1"), { wrapper });
    // Nothing is written to the cache before the answer: no optimistic owner.
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ user_id: "u3", previous_owner_level: "edit" });
    });
    expect(out).toMatchObject({ acl_owner_id: "u3" });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(documentKeys.detail("ws1", "d1"));
    expect(keys).toContainEqual(documentKeys.workspace("ws1"));
  });

  it("refuses an answer that does not name the requested owner", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ document_id: "d1", acl_owner_id: "u9" }));
    const { result } = renderHook(() => useTransferDocumentOwner("ws1", "d1"), { wrapper });
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync({ user_id: "u3" }).catch((e: unknown) => e);
    });
    expect(isDocumentNotVerifiable(caught)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
