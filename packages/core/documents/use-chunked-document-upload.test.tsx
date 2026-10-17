import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { StorageAdapter } from "../types/storage";
import { findResumableUpload, saveResumableUpload, uploadFileKey } from "./chunked-upload";
import { documentKeys } from "./keys";
import { useChunkedDocumentUpload } from "./use-chunked-document-upload";

const API = "http://api.test";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function createFakeStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function makeFile(sizeBytes = 25, name = "Report.pdf"): File {
  const bytes = new Uint8Array(sizeBytes);
  const header = new TextEncoder().encode("%PDF-1.7\n");
  bytes.set(header.subarray(0, Math.min(header.length, sizeBytes)), 0);
  return new File([bytes], name, { type: "application/pdf", lastModified: 1760700000000 });
}

const makePartUrls = (nums: number[]) =>
  nums.map((n) => ({
    part_number: n,
    method: "PUT",
    url: `https://s3.test/upload/part-${n}`,
    headers: { "x-part": String(n) },
    expires_at: "2099-01-01T00:00:00Z",
  }));

const verifiedDoc = {
  id: "doc-chunked-1",
  organization_id: "org-1",
  workspace_id: "ws-1",
  parent_id: null,
  kind: "file",
  title: "Report.pdf",
  content_text: "",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  file: {
    file_id: "file-chunked-1",
    version_id: "ver-1",
    version: 1,
    filename: "Report.pdf",
    mime_type: "application/pdf",
    size_bytes: 25,
    checksum_sha256: "a".repeat(64),
  },
  created_by: "u-1",
  created_by_kind: "human",
  updated_by: "u-1",
  updated_by_kind: "human",
  created_at: "2026-10-17T12:00:00Z",
  updated_at: "2026-10-17T12:00:00Z",
  breadcrumbs: [],
};

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useChunkedDocumentUpload", () => {
  beforeEach(() => {
    setAccessToken("session-tok");
    configureRuntime({ apiUrl: API });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("tracks progress phases and percentage, sets detail cache, and invalidates workspace key on workspace target completion", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    const file = makeFile(20);
    const seenPhases: string[] = [];

    let resolveComplete!: () => void;
    const completeGate = new Promise<void>((r) => {
      resolveComplete = r;
    });

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url === `${API}/api/v1/workspaces/ws-1/documents/upload-sessions`) {
        return json(
          {
            session_id: "sess-1",
            part_size: 10,
            total_parts: 2,
            completed_parts: [],
            parts: makePartUrls([1, 2]),
            expires_at: "2099-01-02T00:00:00Z",
          },
          201,
        );
      }
      if (method === "PUT" && url.startsWith("https://s3.test/upload/part-")) {
        const partNum = Number(/part-(\d+)/.exec(url)?.[1]);
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }
      if (method === "POST" && url === `${API}/api/v1/upload-sessions/sess-1/complete`) {
        await completeGate;
        return json({ document: verifiedDoc }, 200);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const { result } = renderHook(
      () =>
        useChunkedDocumentUpload(target, {
          storage,
          fetch: fakeFetch,
          onProgress: (p) => seenPhases.push(p.phase),
        }),
      { wrapper: makeWrapper(qc) },
    );

    let startPromise!: Promise<unknown>;
    act(() => {
      startPromise = result.current.start({ file });
    });

    await vi.waitFor(() => {
      expect(result.current.phase).toBe("verifying");
    });
    expect(result.current.percentage).toBe(100);
    expect(result.current.isPending).toBe(true);

    resolveComplete();
    await act(async () => {
      await startPromise;
    });

    expect(seenPhases).toContain("probing");
    expect(seenPhases).toContain("opening");
    expect(seenPhases).toContain("uploading");
    expect(seenPhases).toContain("verifying");
    expect(seenPhases).toContain("done");
    expect(qc.getQueryData(documentKeys.detail("ws-1", "doc-chunked-1"))).toMatchObject({
      id: "doc-chunked-1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("ws-1") });
    expect(findResumableUpload(storage, uploadFileKey(file), target)).toBeNull();
  });

  it("supports pause, resume, and cancel with storage cleanup", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const storage = createFakeStorage();
    const target = { kind: "version" as const, documentId: "doc-1" };
    const file = makeFile(20);

    let part2Attempts = 0;
    const deleteCalls: string[] = [];

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url === `${API}/api/v1/documents/doc-1/upload-sessions`) {
        return json(
          {
            session_id: "sess-v1",
            part_size: 10,
            total_parts: 2,
            completed_parts: [],
            parts: makePartUrls([1, 2]),
            expires_at: "2099-01-02T00:00:00Z",
          },
          201,
        );
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-v1`) {
        return json({
          session_id: "sess-v1",
          status: "open",
          part_size: 10,
          total_parts: 2,
          completed_parts: [{ part_number: 1, etag: '"etag-1"', size: 10 }],
          parts: makePartUrls([2]),
          expires_at: "2099-01-02T00:00:00Z",
        });
      }
      if (method === "PUT" && url.includes("part-1")) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "PUT" && url.includes("part-2")) {
        part2Attempts += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (method === "DELETE" && url === `${API}/api/v1/upload-sessions/sess-v1`) {
        deleteCalls.push(url);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const { result } = renderHook(
      () => useChunkedDocumentUpload(target, { storage, fetch: fakeFetch, concurrency: 1 }),
      { wrapper: makeWrapper(qc) },
    );

    let uploadPromise!: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.start({ file }).catch(() => "canceled");
    });

    await vi.waitFor(() => {
      expect(result.current.percentage).toBe(50);
    });

    act(() => {
      result.current.pause();
    });
    expect(result.current.phase).toBe("paused");
    expect(result.current.hasResumable(file)).toBe(true);

    act(() => {
      result.current.resume();
    });
    await vi.waitFor(() => {
      expect(result.current.phase).toBe("uploading");
      expect(part2Attempts).toBe(2);
    });

    await act(async () => {
      await result.current.cancel();
    });
    await act(async () => {
      await uploadPromise;
    });

    expect(deleteCalls).toEqual([`${API}/api/v1/upload-sessions/sess-v1`]);
    expect(result.current.hasResumable(file)).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it("detects an existing resumable upload record via hasResumable", () => {
    const qc = new QueryClient();
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    const file = makeFile(30);
    saveResumableUpload(storage, uploadFileKey(file), target, {
      session_id: "sess-saved",
      expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: "idem-saved",
    });

    const { result } = renderHook(() => useChunkedDocumentUpload(target, { storage }), {
      wrapper: makeWrapper(qc),
    });

    expect(result.current.hasResumable(file)).toBe(true);
    expect(result.current.findResumable(file)?.session_id).toBe("sess-saved");
  });
});
