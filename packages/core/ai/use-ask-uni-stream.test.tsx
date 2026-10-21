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
    emit({ type: "step", round: 1, phase: "tool", tool: "search", counts: { tasks: 2 } });
    emit({ type: "step", round: 2, phase: "tool", tool: "search", counts: { tasks: 1, docs: 1 } });
    expect(result.current.state.draft).toBe("");
    expect(result.current.state.counts).toEqual({ tasks: 3, docs: 1 });
  });

  it("run selects the conversation of a new thread", () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r", conversationId: "c9" });
    expect(useAiPanelStore.getState().conversationId).toBe("c9");
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
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    emit({ type: "error", code: "ai_quota_exceeded" });
    expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_quota_exceeded" });
  });

  it("a thrown mapped error sets errorCode", async () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    act(() => fail(new ApiError("x", "ai_unavailable", 503)));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_unavailable" }));
  });

  it("a stream that ends without done or error is an error", async () => {
    const { result } = setup();
    act(() => result.current.ask({ question: "q" }));
    act(() => finish());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "stream_ended" }));
  });
});

describe("useAskModelChoice", () => {
  it("persists model and effort only", () => {
    useAskModelChoice.getState().setModel("claude-opus");
    useAskModelChoice.getState().setEffort("high");
    const stored = JSON.parse(localStorage.getItem("uniwork_ask_uni_model") ?? "{}") as { state: Record<string, unknown> };
    expect(stored.state).toEqual({ model: "claude-opus", effort: "high" });
  });
});
