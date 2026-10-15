import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useCreateDocument, useCreateDocumentFile } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "page",
  title: "Tài liệu",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

// DOC-02 (UNI-1629): the create hooks carry `visibility` to the wire; none is sent unless the caller asks.
describe("create hooks carry visibility", () => {
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

  it("useCreateDocument sends visibility restricted in the JSON body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ visibility: "restricted" }) }, 201));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateDocument("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: "Trang", visibility: "restricted" });
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ title: "Trang", visibility: "restricted" });
  });

  it("useCreateDocumentFile puts visibility before the file part", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ kind: "file", visibility: "restricted", file: { file_id: "f1", version_id: "v1", version: 1, filename: "a.pdf", mime_type: "application/pdf", size_bytes: 1, checksum_sha256: "a".repeat(64) } }) }, 201),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateDocumentFile("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ file: new File(["x"], "a.pdf"), meta: { parent_id: "p1", visibility: "restricted" } });
    });
    const form = vi.mocked(fetch).mock.calls[0]![1]?.body as FormData;
    expect(Array.from(form.keys())).toEqual(["parent_id", "visibility", "file"]);
    expect(form.get("visibility")).toBe("restricted");
  });
});
