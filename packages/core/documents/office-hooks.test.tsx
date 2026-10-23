import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { documentKeys } from "./keys";
import { officeKeys, useCopyDocument } from "./office-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = {
  id: "d2",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Bản sao",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-28T09:00:00Z",
  updated_at: "2026-09-28T09:00:00Z",
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("office hooks", () => {
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

  it("keys a document's office state by workspace and document", () => {
    expect(officeKeys.document("w1", "d1")).toEqual(["office", "w1", "d1"]);
    expect(officeKeys.document("w1", "d1")).not.toEqual(officeKeys.document("w2", "d1"));
  });

  it("a verified copy lands in the detail cache with the consent sent", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody }));
    const { result } = renderHook(() => useCopyDocument("w1", "d1"), { wrapper });
    result.current.mutate({ title: "Bản sao", idempotencyKey: "k" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ consent: "copy", title: "Bản sao" });
    expect(qc.getQueryData(documentKeys.detail("w1", "d2"))).toMatchObject({ id: "d2" });
  });

  it("refuses an unverifiable copy and never writes a fake document", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { result } = renderHook(() => useCopyDocument("w1", "d1"), { wrapper });
    result.current.mutate({});
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("verifiable");
  });
});
