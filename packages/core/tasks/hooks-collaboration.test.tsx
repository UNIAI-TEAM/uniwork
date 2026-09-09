import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { taskKeys } from "./keys";
import {
  useAddCommentReaction,
  useCreateCommentSuite,
  useDeleteComment,
  useRemoveCommentReaction,
  useResolveComment,
  useSubscribeTask,
  useTaskSubscribers,
  useUnresolveComment,
  useUnsubscribeTask,
  useUpdateComment,
} from "./hooks-collaboration";
import {
  useDeleteAttachment,
  useTaskAttachments,
  useUploadTaskAttachment,
} from "./hooks-attachments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("task collaboration + attachment hooks", () => {
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

  it("skips subscribers and attachments queries when ids are empty", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const subs = renderHook(() => useTaskSubscribers(""), { wrapper });
    const atts = renderHook(() => useTaskAttachments("", ""), { wrapper });
    expect(subs.result.current.fetchStatus).toBe("idle");
    expect(atts.result.current.fetchStatus).toBe("idle");
  });

  it("loads subscribers and attachments when ids are set", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          subscribers: [
            {
              task_id: "t1",
              actor_type: "user",
              actor_id: "u1",
              reason: "watcher",
              created_at: "2026-09-09T10:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          attachments: [
            {
              id: "a1",
              workspace_id: "ws1",
              task_id: "t1",
              filename: "note.md",
              url: "/api/v1/attachments/a1/content",
              download_url: "/api/v1/attachments/a1/download",
              content_type: "text/markdown",
              size_bytes: 4,
              created_at: "2026-09-09T10:00:00Z",
            },
          ],
        }),
      );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const subs = renderHook(() => useTaskSubscribers("t1"), { wrapper });
    const atts = renderHook(() => useTaskAttachments("ws1", "t1"), { wrapper });
    await waitFor(() => expect(subs.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(atts.result.current.isSuccess).toBe(true));
    expect(subs.result.current.data?.[0]?.actor_id).toBe("u1");
    expect(atts.result.current.data?.[0]?.id).toBe("a1");
  });

  it("comment suite mutations invalidate comments after success", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wrapper = wrapperFor(qc);

    const run = async (mutate: () => Promise<unknown>) => {
      invalidate.mockClear();
      await act(async () => {
        await mutate();
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.comments("t1") });
    };

    const update = renderHook(() => useUpdateComment("t1"), { wrapper });
    await run(() => update.result.current.mutateAsync({ commentId: "c1", body: { body: "x" } }));

    const del = renderHook(() => useDeleteComment("t1"), { wrapper });
    await run(() => del.result.current.mutateAsync("c1"));

    const resolve = renderHook(() => useResolveComment("t1"), { wrapper });
    await run(() => resolve.result.current.mutateAsync("c1"));

    const unresolve = renderHook(() => useUnresolveComment("t1"), { wrapper });
    await run(() => unresolve.result.current.mutateAsync("c1"));

    const addReaction = renderHook(() => useAddCommentReaction("t1"), { wrapper });
    await run(() => addReaction.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }));

    const removeReaction = renderHook(() => useRemoveCommentReaction("t1"), { wrapper });
    await run(() => removeReaction.result.current.mutateAsync({ commentId: "c1", emoji: "👍" }));

    const create = renderHook(() => useCreateCommentSuite("t1"), { wrapper });
    await run(() => create.result.current.mutateAsync({ body: { body: "hello" } }));
  });

  it("subscribe/unsubscribe and attachment mutations invalidate their keys", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wrapper = wrapperFor(qc);

    const sub = renderHook(() => useSubscribeTask("t1"), { wrapper });
    await act(async () => {
      await sub.result.current.mutateAsync(undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.subscribers("t1") });

    invalidate.mockClear();
    const unsub = renderHook(() => useUnsubscribeTask("t1"), { wrapper });
    await act(async () => {
      await unsub.result.current.mutateAsync({ user_id: "u2" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.subscribers("t1") });

    invalidate.mockClear();
    const upload = renderHook(() => useUploadTaskAttachment("ws1", "t1"), { wrapper });
    await act(async () => {
      await upload.result.current.mutateAsync(new File(["hi"], "a.txt", { type: "text/plain" }));
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.attachments("ws1", "t1"),
    });

    invalidate.mockClear();
    const del = renderHook(() => useDeleteAttachment("ws1", "t1"), { wrapper });
    await act(async () => {
      await del.result.current.mutateAsync("a1");
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.attachments("ws1", "t1"),
    });
  });
});
