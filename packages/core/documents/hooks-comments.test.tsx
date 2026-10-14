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
  useDocumentCommentRevisions,
  useDocumentComments,
  useDocumentCommentThread,
  useDocumentMentionCandidates,
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
    expect(qc.getQueryData<{ comments: unknown[] }>(documentKeys.comments("w1", "d1"))?.comments).toHaveLength(1);
  });

  it("caches the mention name table with the rows it came with", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        comments: [commentBody()],
        mentions: [{ user_id: "u9", display_name: "Bình", state: "ok" }],
        list_token: "lt1:a",
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const thread = renderHook(() => useDocumentCommentThread("w1", "d1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(thread.result.current.isSuccess).toBe(true));
    expect(thread.result.current.data?.comments.map((c) => c.id)).toEqual(["c1"]);
    expect(thread.result.current.data?.mentions).toEqual([
      { user_id: "u9", display_name: "Bình", avatar_url: "", state: "ok" },
    ]);
  });

  it("loads one comment's edit history under the comments key and fails loudly on a malformed answer", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ revisions: [{ id: "r1", revision: 1, body: "cũ", created_by_id: "u1", created_at: "2026-09-28T08:00:00Z" }] }))
      .mockResolvedValueOnce(json({ nope: true }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const idle = renderHook(() => useDocumentCommentRevisions("w1", "d1", "c1", { enabled: false }), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const history = renderHook(() => useDocumentCommentRevisions("w1", "d1", "c1"), { wrapper });
    await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
    expect(history.result.current.data?.[0]?.body).toBe("cũ");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/documents/d1/comments/c1/revisions");
    expect(qc.getQueryData([...documentKeys.comments("w1", "d1"), "revisions", "c1"])).toHaveLength(1);

    const broken = renderHook(() => useDocumentCommentRevisions("w1", "d1", "c2"), { wrapper });
    await waitFor(() => expect(broken.result.current.isError).toBe(true));
    expect(broken.result.current.error).toBeInstanceOf(DocumentNotVerifiableError);
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

  it("loads the mention picker per term and page, and stays idle without ids", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ candidates: [{ user_id: "u1", display_name: "An" }] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);

    const idle = renderHook(() => useDocumentMentionCandidates("", "", ""), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const closed = renderHook(
      () => useDocumentMentionCandidates("w1", "d1", "an", { enabled: false }),
      { wrapper },
    );
    expect(closed.result.current.fetchStatus).toBe("idle");

    const picker = renderHook(
      () => useDocumentMentionCandidates("w1", "d1", "  an  ", { limit: 10 }),
      { wrapper },
    );
    await waitFor(() => expect(picker.result.current.isSuccess).toBe(true));
    expect(picker.result.current.data?.[0]?.user_id).toBe("u1");
    // The trimmed term and the page size are in the key, so two pages never
    // share one cache entry.
    expect(qc.getQueryData(documentKeys.mentionCandidates("w1", "d1", "an", 10))).toHaveLength(1);
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/mention-candidates?q=an&limit=10");
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

describe("document comment list read (G8-03 two shapes)", () => {
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

  it("keeps the cached list on an unchanged answer instead of writing an empty one", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ comments: [commentBody()], list_token: "lt1:a" }))
      .mockResolvedValueOnce(json({ unchanged: true, list_token: "lt1:a", comments: [] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const thread = renderHook(() => useDocumentComments("w1", "d1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(thread.result.current.isSuccess).toBe(true));

    await act(async () => {
      await thread.result.current.refetch();
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    // The cache, not result.current: the hook only re-renders for the
    // properties a test has read, and the point is what the query stored.
    const cached = qc.getQueryData<{ comments: { id: string }[] }>(documentKeys.comments("w1", "d1"));
    expect(cached?.comments.map((c) => c.id)).toEqual(["c1"]);
    expect(qc.getQueryState(documentKeys.comments("w1", "d1"))?.status).toBe("success");
  });

  it("throws on an unprovable answer and leaves the last list in the cache", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ comments: [commentBody()], list_token: "lt1:a" }))
      .mockResolvedValueOnce(json({ comments: "nope" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const thread = renderHook(() => useDocumentComments("w1", "d1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(thread.result.current.isSuccess).toBe(true));

    await act(async () => {
      await thread.result.current.refetch();
    });
    await waitFor(() => expect(thread.result.current.isError).toBe(true));
    expect(thread.result.current.error).toBeInstanceOf(DocumentNotVerifiableError);
    const cached = qc.getQueryData<{ comments: { id: string }[] }>(documentKeys.comments("w1", "d1"));
    expect(cached?.comments.map((c) => c.id)).toEqual(["c1"]);
  });
});
