import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";
import {
  useAddDocumentCommentReaction,
  useCreateDocumentComment,
  useDeleteDocumentComment,
  useDocumentComments,
  useRemoveDocumentCommentReaction,
  useReopenDocumentComment,
  useResolveDocumentComment,
  useUpdateDocumentComment,
} from "./hooks-comments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const commentBody = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  document_id: "d1",
  author_id: "u1",
  author_kind: "human",
  body: "Chỗ này cần số liệu Q3.",
  type: "comment",
  revision: 1,
  created_at: "2026-09-28T08:00:00Z",
  updated_at: "2026-09-28T08:00:00Z",
  display_name: "An",
  reactions: [],
  ...over,
});

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("document comment hooks", () => {
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

  it("loads the thread for a document and stays idle without ids", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: [commentBody()] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const idle = renderHook(() => useDocumentComments("", ""), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const thread = renderHook(() => useDocumentComments("w1", "d1"), { wrapper });
    await waitFor(() => expect(thread.result.current.isSuccess).toBe(true));
    expect(thread.result.current.data?.[0]?.id).toBe("c1");
    expect(qc.getQueryData(documentKeys.comments("w1", "d1"))).toHaveLength(1);
  });

  it("every comment mutation invalidates the document's comment key", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(json({ comment: commentBody(), reaction: { id: "r1", comment_id: "c1", actor_type: "member", actor_id: "u1", emoji: "👍", created_at: "2026-09-28T08:01:00Z" }, status: "ok" })),
    );
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wrapper = wrapperFor(qc);
    const key = documentKeys.comments("w1", "d1");

    const run = async (mutate: () => Promise<unknown>) => {
      invalidate.mockClear();
      await act(async () => {
        await mutate();
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    };

    const create = renderHook(() => useCreateDocumentComment("w1", "d1"), { wrapper });
    await run(() => create.result.current.mutateAsync({ body: "hello", idempotencyKey: "k1" }));

    const update = renderHook(() => useUpdateDocumentComment("w1", "d1"), { wrapper });
    await run(() => update.result.current.mutateAsync({ commentId: "c1", body: "sửa" }));

    const resolve = renderHook(() => useResolveDocumentComment("w1", "d1"), { wrapper });
    await run(() => resolve.result.current.mutateAsync("c1"));

    const reopen = renderHook(() => useReopenDocumentComment("w1", "d1"), { wrapper });
    await run(() => reopen.result.current.mutateAsync("c1"));

    const addReaction = renderHook(() => useAddDocumentCommentReaction("w1", "d1"), { wrapper });
    await run(() => addReaction.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }));

    const removeReaction = renderHook(() => useRemoveDocumentCommentReaction("w1", "d1"), {
      wrapper,
    });
    await run(() => removeReaction.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }));

    const del = renderHook(() => useDeleteDocumentComment("w1", "d1"), { wrapper });
    await run(() => del.result.current.mutateAsync("c1"));
  });

  it("a malformed create answer is not verifiable, so the composer keeps its draft", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comment: { id: "c1" } }));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const create = renderHook(() => useCreateDocumentComment("w1", "d1"), { wrapper });
    await act(async () => {
      await expect(
        create.result.current.mutateAsync({ body: "hello", idempotencyKey: "k1" }),
      ).rejects.toBeInstanceOf(DocumentNotVerifiableError);
    });
  });

  it("a malformed delete or reaction answer is not verifiable", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = wrapperFor(qc);

    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const del = renderHook(() => useDeleteDocumentComment("w1", "d1"), { wrapper });
    await act(async () => {
      await expect(del.result.current.mutateAsync("c1")).rejects.toBeInstanceOf(
        DocumentNotVerifiableError,
      );
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ reaction: { nope: true } }));
    const add = renderHook(() => useAddDocumentCommentReaction("w1", "d1"), { wrapper });
    await act(async () => {
      await expect(
        add.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }),
      ).rejects.toBeInstanceOf(DocumentNotVerifiableError);
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const remove = renderHook(() => useRemoveDocumentCommentReaction("w1", "d1"), { wrapper });
    await act(async () => {
      await expect(
        remove.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }),
      ).rejects.toBeInstanceOf(DocumentNotVerifiableError);
    });
  });
});
