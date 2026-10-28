import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { isDocumentNotVerifiable } from "../types/document";
import { documentKeys } from "./keys";
import { useMarkDocumentTemplate, useTemplateDocuments, useUnmarkDocumentTemplate } from "./hooks-templates";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: "o1",
  workspace_id: "w1",
  kind: "file",
  title: `Mẫu ${id}`,
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-10-27T09:00:00Z",
  updated_at: "2026-10-27T09:00:00Z",
  ...over,
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("document template hooks", () => {
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

  it("useTemplateDocuments pages the templates route under the workspace root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ documents: [summary("d1", { template_marked_at: "2026-10-27T10:00:00Z" })], next_cursor: null }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useTemplateDocuments("w1", { types: ["docx"] }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/workspaces/w1/documents/templates");
    expect(url.searchParams.getAll("type")).toEqual(["docx"]);
    expect(result.current.data?.pages[0]?.documents[0]?.id).toBe("d1");
    const entry = qc.getQueryCache().getAll()[0]!;
    expect(entry.queryKey.slice(0, 2)).toEqual(documentKeys.workspace("w1"));
    expect(entry.queryKey).toContain("templates");
  });

  it("useMarkDocumentTemplate sets the detail and invalidates the workspace root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: summary("d1", { template_marked_at: "2026-10-27T10:00:00Z" }) }),
    );
    const { qc, wrapper } = setup();
    const templatesKey = documentKeys.templates("w1");
    const otherWs = documentKeys.templates("w2");
    qc.setQueryData(templatesKey, { pages: [], pageParams: [""] });
    qc.setQueryData(otherWs, { pages: [], pageParams: [""] });

    const { result } = renderHook(() => useMarkDocumentTemplate("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", widenToWorkspace: true });
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/template");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ widen_to_workspace: true });
    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toMatchObject({
      id: "d1",
      template_marked_at: "2026-10-27T10:00:00Z",
    });
    expect(qc.getQueryState(templatesKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(otherWs)?.isInvalidated).toBe(false);
  });

  it("useUnmarkDocumentTemplate sets the detail and invalidates the workspace root", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: summary("d1") }));
    const { qc, wrapper } = setup();
    const templatesKey = documentKeys.templates("w1");
    qc.setQueryData(templatesKey, { pages: [], pageParams: [""] });

    const { result } = renderHook(() => useUnmarkDocumentTemplate("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("d1");
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/template");
    expect(init?.method).toBe("DELETE");
    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toMatchObject({ id: "d1" });
    expect(qc.getQueryState(templatesKey)?.isInvalidated).toBe(true);
  });

  it("a refused or unverifiable answer leaves the cache alone", async () => {
    const { qc, wrapper } = setup();
    const templatesKey = documentKeys.templates("w1");
    qc.setQueryData(templatesKey, { pages: [], pageParams: [""] });
    const mark = renderHook(() => useMarkDocumentTemplate("w1"), { wrapper });
    const unmark = renderHook(() => useUnmarkDocumentTemplate("w1"), { wrapper });

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "template_widens_visibility", message: "widens" } }, 409),
    );
    await act(async () => {
      await expect(mark.result.current.mutateAsync({ documentId: "d1" })).rejects.toBeInstanceOf(ApiError);
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "d1" } }));
    await act(async () => {
      const err = await mark.result.current.mutateAsync({ documentId: "d1" }).catch((e: unknown) => e);
      expect(isDocumentNotVerifiable(err)).toBe(true);
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await act(async () => {
      const err = await unmark.result.current.mutateAsync("d1").catch((e: unknown) => e);
      expect(isDocumentNotVerifiable(err)).toBe(true);
    });

    expect(qc.getQueryData(documentKeys.detail("w1", "d1"))).toBeUndefined();
    expect(qc.getQueryState(templatesKey)?.isInvalidated).toBe(false);
  });
});
