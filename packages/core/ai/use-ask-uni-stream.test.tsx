import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { askUniStream, type AskUniStreamEvent } from "../api/endpoints/ai-stream";
import { aiKeys } from "./hooks";
import { useAskModelChoice } from "./model-choice-store";
import { useAiPanelStore } from "./store";
import { useAskUniStream } from "./use-ask-uni-stream";

vi.mock("../api/endpoints/ai-stream", () => ({ askUniStream: vi.fn() }));

type Opts = { signal: AbortSignal; onEvent: (e: AskUniStreamEvent) => void };
let opts: Opts;
let finish: () => void;
let fail: (e: unknown) => void;

const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  role: "assistant" as const,
  content: "answer",
  citations: [],
  notice: "",
  steps: [],
  followups: [],
  focus: null,
  mentions: [],
  created_at: "t",
  ...over,
});

function setup(wsId = "ws1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook((p: { ws: string }) => useAskUniStream(p.ws), { wrapper, initialProps: { ws: wsId } });
  return { qc, ...hook };
}
const emit = (e: AskUniStreamEvent) => act(() => opts.onEvent(e));

beforeEach(() => {
  vi.mocked(askUniStream).mockImplementation((_ws, _body, o) => {
    opts = o as Opts;
    return new Promise<void>((res, rej) => {
      finish = res;
      fail = rej;
    });
  });
});
afterEach(() => {
  vi.clearAllMocks();
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, workspaceId: null, fullPage: false });
  localStorage.clear();
});

describe("useAskUniStream", () => {
  it("accumulates deltas and clears the draft on step", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    expect(result.current.state).toMatchObject({ status: "streaming", question: "q" });
    emit({ type: "delta", text: "hel" });
    emit({ type: "delta", text: "lo" });
    expect(result.current.state.draft).toBe("hello");
    emit({ type: "step", round: 1, phase: "tool", tool: "search", label: "late", counts: { tasks: 2 } });
    emit({ type: "step", round: 2, phase: "retry", tool: "", label: "", counts: {} });
    expect(result.current.state.draft).toBe("");
    expect(result.current.state.steps).toEqual([
      { tool: "search", label: "late", counts: { tasks: 2 } },
      { tool: "", label: "", counts: {} },
    ]);
  });

  it("sources merge by source_id and followups land in state", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "sources", sources: [{ source_id: "S1", quote: "", kind: "task", title: "a", href: "" }] });
    emit({ type: "sources", sources: [{ source_id: "S2", quote: "", kind: "task", title: "b", href: "" }, { source_id: "S1", quote: "", kind: "task", title: "a2", href: "" }] });
    expect(Object.keys(result.current.state.sources)).toEqual(["S1", "S2"]);
    expect(result.current.state.sources.S1?.title).toBe("a2");
    emit({ type: "followups", followups: ["next?"] });
    expect(result.current.state.followups).toEqual(["next?"]);
  });

  it("regenerate replaces the old answer and echoes no question", () => {
    const { result, qc } = setup();
    qc.setQueryData(aiKeys.messages("c1"), [msg({ id: "u1", role: "user", content: "q" }), msg({ id: "old" })]);
    act(() => result.current.ask({ question: "q", conversation_id: "c1", regenerate_message_id: "old" }));
    expect(result.current.state.regenerateOf).toBe("old");
    emit({ type: "done", message: msg({ id: "new" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(qc.getQueryData<{ id: string }[]>(aiKeys.messages("c1"))?.map((m) => m.id)).toEqual(["u1", "new"]);
  });

  it("a title after done invalidates every conversation list and the turn stays finished", () => {
    const { result, qc } = setup();
    act(() => result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "done", message: msg(), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe("done");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    emit({ type: "title", conversationId: "c1", title: "T" });
    expect(result.current.state.status).toBe("done");
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual([JSON.stringify(aiKeys.conversations("ws1"))]);
    act(() => finish());
    expect(result.current.state.status).toBe("done");
  });

  it("run selects the conversation of a new thread", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r", conversationId: "c9" });
    expect(useAiPanelStore.getState().conversationId).toBe("c9");
  });

  it("state names the conversation the turn was asked in", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    expect(result.current.state.conversationId).toBeNull();
    emit({ type: "run", runId: "r", conversationId: "c9" });
    expect(result.current.state.conversationId).toBe("c9");
    act(() => result.current.ask({ question: "again", conversation_id: "c3" }));
    expect(result.current.state.conversationId).toBe("c3");
  });

  it("done writes the turn into the messages cache and refreshes the rest", () => {
    const { result, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r", conversationId: "c1" });
    emit({ type: "citations", citations: [] });
    emit({ type: "done", message: msg(), usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe("done");
    expect(result.current.state.message?.id).toBe("m1");
    const cached = qc.getQueryData<{ role: string; content: string }[]>(aiKeys.messages("c1"));
    expect(cached?.map((m) => [m.role, m.content])).toEqual([
      ["user", "q"],
      ["assistant", "answer"],
    ]);
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

  it("a done with notice stopped ends as stopped", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "done", message: msg({ notice: "stopped" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe("stopped");
  });

  it("stop aborts and refetches messages", () => {
    const { result, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r", conversationId: "c1" });
    act(() => result.current.stop());
    expect(opts.signal.aborted).toBe(true);
    expect(result.current.state.status).toBe("stopped");
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.messages("c1")));
    act(() => fail(new DOMException("Aborted", "AbortError")));
    expect(result.current.state.status).toBe("stopped");
  });

  it("stopping a regenerate refetches the conversation's messages, with no run frame needed", () => {
    const { result, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => result.current.ask({ question: "q", conversation_id: "c1", regenerate_message_id: "old" }));
    act(() => result.current.stop());
    expect(result.current.state.status).toBe("stopped");
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.messages("c1")));
  });

  it("stop after run refreshes the history list and quota, and refetches messages again after 1500 ms", () => {
    vi.useFakeTimers();
    try {
      const { result, qc } = setup();
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      act(() => result.current.ask({ question: "q" }));
      emit({ type: "run", runId: "r", conversationId: "c1" });
      act(() => result.current.stop());
      const keys = () => invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys()).toEqual(
        expect.arrayContaining([
          JSON.stringify(aiKeys.conversations("ws1")),
          JSON.stringify(aiKeys.capabilities("ws1")),
          JSON.stringify(aiKeys.usages()),
        ]),
      );
      const msgKey = JSON.stringify(aiKeys.messages("c1"));
      expect(keys().filter((k) => k === msgKey)).toHaveLength(1);
      act(() => void vi.advanceTimersByTime(1500));
      expect(keys().filter((k) => k === msgKey)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the delayed refetch is cancelled by unmount and by a newer ask", () => {
    vi.useFakeTimers();
    try {
      const { result, qc, unmount } = setup();
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      const count = () => invalidate.mock.calls.filter((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(aiKeys.messages("c1"))).length;
      act(() => result.current.ask({ question: "q" }));
      emit({ type: "run", runId: "r", conversationId: "c1" });
      act(() => result.current.stop());
      act(() => result.current.ask({ question: "next", conversation_id: "c2" }));
      act(() => void vi.advanceTimersByTime(2000));
      expect(count()).toBe(1);
      act(() => result.current.stop());
      unmount();
      act(() => void vi.advanceTimersByTime(2000));
      expect(invalidate.mock.calls.filter((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(aiKeys.messages("c2")))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts on workspace change and ignores late events", async () => {
    const { result, qc, rerender } = setup();
    act(() => result.current.ask({ question: "q" }));
    const first = opts;
    emit({ type: "run", runId: "r", conversationId: "c1" });
    act(() => rerender({ ws: "ws2" }));
    expect(first.signal.aborted).toBe(true);
    expect(result.current.state.status).toBe("idle");
    act(() => first.onEvent({ type: "delta", text: "late" }));
    act(() =>
      first.onEvent({ type: "done", message: msg(), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } }),
    );
    expect(result.current.state.draft).toBe("");
    expect(qc.getQueryData(aiKeys.messages("c1"))).toBeUndefined();
  });

  it("aborts on unmount", () => {
    const { result, unmount } = setup();
    act(() => result.current.ask({ question: "q" }));
    unmount();
    expect(opts.signal.aborted).toBe(true);
  });

  it("a new ask aborts the one in flight", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "one" }));
    const first = opts;
    act(() => result.current.ask({ question: "two" }));
    expect(first.signal.aborted).toBe(true);
    act(() => first.onEvent({ type: "delta", text: "stale" }));
    expect(result.current.state).toMatchObject({ question: "two", draft: "" });
  });

  it("error event sets errorCode", () => {
    const { result, qc } = setup();
    act(() => result.current.ask({ question: "q" }));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    emit({ type: "error", code: "ai_quota_exceeded" });
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.conversations("ws1")));
    expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_quota_exceeded" });
  });

  it("a thrown mapped error sets errorCode", async () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    act(() => fail(new ApiError("x", "ai_unavailable", 503)));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_unavailable" }));
  });

  it.each(["done", "stopped", "error"] as const)("a new conversation after a %s first turn is idle again", (end) => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r1", conversationId: "c1" });
    if (end === "error") emit({ type: "error", code: "internal" });
    else emit({ type: "done", message: msg({ notice: end === "stopped" ? "stopped" : "" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe(end);
    act(() => useAiPanelStore.getState().select(null));
    expect(result.current.state).toMatchObject({ status: "idle", conversationId: null });
  });

  it("a new conversation mid-turn aborts it", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r1", conversationId: "c1" });
    act(() => useAiPanelStore.getState().select(null));
    expect(opts.signal.aborted).toBe(true);
    expect(result.current.state.status).toBe("idle");
  });

  it("a stream that ends without done or error is an error", async () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    act(() => finish());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "stream_ended" }));
  });
});

describe("useAskModelChoice", () => {
  it("persists model and effort only, and rehydrates them from storage", async () => {
    useAskModelChoice.getState().setModel("claude-opus");
    useAskModelChoice.getState().setEffort("high");
    const stored = JSON.parse(localStorage.getItem("uniwork_ask_uni_model") ?? "{}") as { state: Record<string, unknown> };
    expect(stored.state).toEqual({ model: "claude-opus", effort: "high" });
    useAskModelChoice.setState({ model: "", effort: "" });
    expect(useAskModelChoice.getState().model).toBe("");
    localStorage.setItem("uniwork_ask_uni_model", JSON.stringify({ ...stored, version: 1 }));
    await useAskModelChoice.persist.rehydrate();
    expect(useAskModelChoice.getState()).toMatchObject({ model: "claude-opus", effort: "high" });
  });
});
