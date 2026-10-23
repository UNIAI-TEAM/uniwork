import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import {
  aiKeys,
  useAiPanelStore,
  useAskModels,
  useAskUni,
  useClearAiFeedback,
  useDeleteAiConversation,
  useRenameAiConversation,
  useSetAiFeedback,
  useSetAskModels,
} from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("ai hooks", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
    useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null });
  });

  it("useAskUni waits for the server, then refreshes messages, list, quota and usage", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ conversation_id: "c1", message: { id: "m1", role: "assistant", content: "ok", citations: [] } }),
    );
    const { result } = renderHook(() => useAskUni("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: "?" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(aiKeys.messages("c1")),
        JSON.stringify(aiKeys.conversations("ws1")),
        JSON.stringify(aiKeys.capabilities("ws1")),
        JSON.stringify(aiKeys.usages()),
      ]),
    );
  });

  it("useAskUni shows the question and answer before the messages refetch returns", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        conversation_id: "c1",
        message: { id: "m1", role: "assistant", content: "ok", citations: [], created_at: "t" },
      }),
    );
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined)); // the refetch never returns
    qc.setQueryData(aiKeys.messages("c1"), []);
    const { result } = renderHook(() => useAskUni("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: "hỏi gì" });
    });
    const cached = qc.getQueryData<{ role: string; content: string }[]>(aiKeys.messages("c1"));
    expect(cached?.map((m) => [m.role, m.content])).toEqual([
      ["user", "hỏi gì"],
      ["assistant", "ok"],
    ]);
  });

  it("useAskUni surfaces the server's error code instead of rendering an empty turn", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "ai_quota_exceeded", message: "hết" } }, 402));
    const { result } = renderHook(() => useAskUni("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: "?" }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("useDeleteAiConversation drops the cached messages and refreshes the list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(aiKeys.messages("c1"), []);
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { result } = renderHook(() => useDeleteAiConversation("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("c1");
    });
    expect(qc.getQueryData(aiKeys.messages("c1"))).toBeUndefined();
  });

  it("the panel store toggles and remembers the selected conversation", () => {
    useAiPanelStore.getState().toggle();
    useAiPanelStore.getState().select("c1");
    expect(useAiPanelStore.getState()).toMatchObject({ open: true, conversationId: "c1" });
    useAiPanelStore.getState().setOpen(false);
    expect(useAiPanelStore.getState().open).toBe(false);
  });
  it("useAskModels is keyed by org; useSetAskModels writes the answer into it and refreshes capabilities", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ models: ["a"] }));
    const q = renderHook(() => useAskModels("o1"), { wrapper });
    await waitFor(() => expect(q.result.current.data).toEqual(["a"]));
    expect(qc.getQueryData(aiKeys.askModels("o1"))).toEqual(["a"]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ models: ["a", "b"] }));
    const m = renderHook(() => useSetAskModels("o1"), { wrapper });
    await act(async () => {
      await m.result.current.mutateAsync(["a", "b"]);
    });
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(qc.getQueryData(aiKeys.askModels("o1"))).toEqual(["a", "b"]);
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(["ai", "capabilities"])]));
  });

  it("feedback hooks call the endpoints without touching the cache", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({})));
    const up = renderHook(() => useSetAiFeedback(), { wrapper });
    const clear = renderHook(() => useClearAiFeedback(), { wrapper });
    await act(async () => {
      await up.result.current.mutateAsync({ conversationId: "c1", messageId: "m1", body: { rating: "up" } });
      await clear.result.current.mutateAsync({ conversationId: "c1", messageId: "m1" });
    });
    const calls = vi.mocked(fetch).mock.calls.map((c) => [(c[1] as RequestInit).method, String(c[0])]);
    expect(calls).toEqual([
      ["PUT", "http://api.test/api/v1/ai/conversations/c1/messages/m1/feedback"],
      ["DELETE", "http://api.test/api/v1/ai/conversations/c1/messages/m1/feedback"],
    ]);
  });

  it("useRenameAiConversation refreshes the conversation list", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "c1", title: "new" }));
    const { result } = renderHook(() => useRenameAiConversation("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ conversationId: "c1", title: "new" });
    });
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.conversations("ws1")));
  });
});
