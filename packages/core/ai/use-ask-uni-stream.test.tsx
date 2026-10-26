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
  model: "",
  attachments: [],
  file_notes: [],
  proposals: [],
  memory_ids: [],
  memory_proposals: [],
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
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, workspaceId: null });
  localStorage.clear();
});

describe("useAskUniStream", () => {
  it("accumulates deltas and clears the draft on step", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    expect(result.current.state).toMatchObject({ status: "streaming", question: "q" });
    emit({ type: "delta", text: "hel" });
    emit({ type: "delta", text: "lo" });
    expect(result.current.state.draft).toBe("hello");
    emit({ type: "step", round: 1, phase: "tool", tool: "search", label: "late", counts: { tasks: 2 }, note: "" });
    emit({ type: "step", round: 2, phase: "retry", tool: "", label: "", counts: {}, note: "" });
    expect(result.current.state.draft).toBe("");
    expect(result.current.state.steps).toEqual([
      { tool: "search", label: "late", counts: { tasks: 2 }, note: "", thought: "", kind: "" },
      { tool: "", label: "", counts: {}, note: "", thought: "", kind: "" },
    ]);
  });

  it("gathers each call's thinking and hands it, with the note, to the step it leads to", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    emit({ type: "reasoning", text: "Cần xem " });
    emit({ type: "reasoning", text: "việc mở." });
    expect(result.current.state.thinking).toBe("Cần xem việc mở.");
    emit({ type: "delta", text: "Mình tìm." });
    emit({ type: "step", round: 1, phase: "tool", tool: "search", label: "mở", counts: {}, note: "Mình tìm." });
    emit({ type: "step", round: 1, phase: "tool", tool: "get_task", label: "A", counts: {}, note: "" });
    expect(result.current.state.steps.map((s) => [s.tool, s.note, s.thought])).toEqual([
      ["search", "Mình tìm.", "Cần xem việc mở."],
      ["get_task", "", ""],
    ]);
    expect(result.current.state.thinking).toBe("");
    // The answer call's thinking stays live until done brings the stored think step.
    emit({ type: "reasoning", text: "Đủ rồi." });
    expect(result.current.state.thinking).toBe("Đủ rồi.");
    const stored = [
      ...result.current.state.steps,
      { tool: "", label: "", counts: {}, note: "", thought: "Đủ rồi.", kind: "think" },
    ];
    emit({ type: "done", message: msg({ steps: stored }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.steps).toEqual(stored);
    expect(result.current.state.thinking).toBe("");
  });

  it("sources merge by source_id and followups land in state", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
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
    act(() => void result.current.ask({ question: "q", conversation_id: "c1", regenerate_message_id: "old" }));
    expect(result.current.state.regenerateOf).toBe("old");
    emit({ type: "done", message: msg({ id: "new" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(qc.getQueryData<{ id: string }[]>(aiKeys.messages("c1"))?.map((m) => m.id)).toEqual(["u1", "new"]);
  });

  it("a regenerate that ends in error keeps the old answer in the cache", () => {
    const { result, qc } = setup();
    qc.setQueryData(aiKeys.messages("c1"), [msg({ id: "u1", role: "user", content: "q" }), msg({ id: "old", content: "cũ" })]);
    act(() => void result.current.ask({ question: "q", conversation_id: "c1", regenerate_message_id: "old" }));
    emit({ type: "run", runId: "r", conversationId: "c1" });
    emit({ type: "error", code: "ai_provider_error" });
    expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_provider_error", regenerateOf: "old" });
    expect(qc.getQueryData<{ id: string; content: string }[]>(aiKeys.messages("c1"))?.map((m) => [m.id, m.content])).toEqual([["u1", "q"], ["old", "cũ"]]);
  });

  it("a network error after done keeps the finished turn and its follow-ups", async () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "followups", followups: ["Tiếp?"] });
    emit({ type: "done", message: msg(), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    // The stream stays open for the title frame; the connection drops instead.
    act(() => fail(new TypeError("network error")));
    await act(async () => {});
    expect(result.current.state).toMatchObject({ status: "done", errorCode: null, followups: ["Tiếp?"] });
  });

  it("a title after done invalidates every conversation list and the turn stays finished", () => {
    const { result, qc } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
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
    act(() => void result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r", conversationId: "c9" });
    expect(useAiPanelStore.getState().conversationId).toBe("c9");
  });

  it("state names the conversation the turn was asked in", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    expect(result.current.state.conversationId).toBeNull();
    emit({ type: "run", runId: "r", conversationId: "c9" });
    expect(result.current.state.conversationId).toBe("c9");
    act(() => void result.current.ask({ question: "again", conversation_id: "c3" }));
    expect(result.current.state.conversationId).toBe("c3");
  });

  it("done writes the turn into the messages cache and refreshes the rest", () => {
    const { result, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => void result.current.ask({ question: "q" }));
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

  it("shows the files of the question on the running bubble and on the echoed question, and the server's notes on the answer", () => {
    const { result, qc } = setup();
    const display = { attachments: [{ id: "f1", name: "q3.pdf", mime: "application/pdf", size: 8, kind: "pdf" }] };
    expect(result.current.state.attachments).toEqual([]);
    act(() => void result.current.ask({ question: "q", conversation_id: "c1", attachment_ids: ["f1"] }, display));
    expect(askUniStream).toHaveBeenCalledWith("ws1", expect.objectContaining({ attachment_ids: ["f1"] }), expect.anything());
    expect(result.current.state.attachments).toEqual(display.attachments);
    const note = { name: "q3.pdf", unit: "page", read: 15, total: 80 };
    emit({ type: "done", message: msg({ file_notes: [note] }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    // The state keeps them for the finished turn until the next ask.
    expect(result.current.state.attachments).toEqual(display.attachments);
    const cached = qc.getQueryData<{ role: string; attachments: unknown[]; file_notes: unknown[] }[]>(aiKeys.messages("c1"));
    expect(cached?.map((m) => [m.role, m.attachments, m.file_notes])).toEqual([
      ["user", display.attachments, []],
      ["assistant", [], [note]],
    ]);
    // A question without files shows none, and the next ask forgets the last turn's.
    act(() => void result.current.ask({ question: "next", conversation_id: "c1" }));
    expect(result.current.state.attachments).toEqual([]);
    emit({ type: "done", message: msg({ id: "m2" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(qc.getQueryData<{ attachments: unknown[] }[]>(aiKeys.messages("c1"))?.at(-2)?.attachments).toEqual([]);
  });

  it("a done with notice stopped ends as stopped", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "done", message: msg({ notice: "stopped" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe("stopped");
  });

  it("stop aborts and refetches messages", () => {
    const { result, qc } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    act(() => void result.current.ask({ question: "q" }));
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
    act(() => void result.current.ask({ question: "q", conversation_id: "c1", regenerate_message_id: "old" }));
    act(() => result.current.stop());
    expect(result.current.state.status).toBe("stopped");
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.messages("c1")));
  });

  it("stop after run refreshes the history list and quota, and refetches messages again after 1500 ms", () => {
    vi.useFakeTimers();
    try {
      const { result, qc } = setup();
      const invalidate = vi.spyOn(qc, "invalidateQueries");
      act(() => void result.current.ask({ question: "q" }));
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
      act(() => void result.current.ask({ question: "q" }));
      emit({ type: "run", runId: "r", conversationId: "c1" });
      act(() => result.current.stop());
      act(() => void result.current.ask({ question: "next", conversation_id: "c2" }));
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
    act(() => void result.current.ask({ question: "q" }));
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
    act(() => void result.current.ask({ question: "q" }));
    unmount();
    expect(opts.signal.aborted).toBe(true);
  });

  it("a new ask aborts the one in flight", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "one" }));
    const first = opts;
    act(() => void result.current.ask({ question: "two" }));
    expect(first.signal.aborted).toBe(true);
    act(() => first.onEvent({ type: "delta", text: "stale" }));
    expect(result.current.state).toMatchObject({ question: "two", draft: "" });
  });

  it("error event sets errorCode", () => {
    const { result, qc } = setup();
    act(() => void result.current.ask({ question: "q" }));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    emit({ type: "error", code: "ai_quota_exceeded" });
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(aiKeys.conversations("ws1")));
    expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_quota_exceeded" });
  });

  describe("whether the server took the question", () => {
    // ask() is what the composer awaits: it keeps the question and its files until the server runs the turn.
    const asked = (r: { current: ReturnType<typeof useAskUniStream> }) => {
      let outcome!: Promise<unknown>;
      act(() => {
        outcome = r.current.ask({ question: "q" });
      });
      return outcome;
    };

    it("takes it once the server runs the turn", async () => {
      const { result } = setup();
      const outcome = asked(result);
      emit({ type: "run", runId: "r", conversationId: "c1" });
      emit({ type: "error", code: "ai_provider_error" }); // a failure after the run does not undo it
      await expect(outcome).resolves.toEqual({ accepted: true });
    });

    it("is refused, with the server's code and sentence, when the request is turned down", async () => {
      const { result } = setup();
      const outcome = asked(result);
      act(() => fail(new ApiError('không đọc được file đính kèm: "a.pdf"', "ai_attachment_unreadable", 422)));
      await expect(outcome).resolves.toEqual({ accepted: false, code: "ai_attachment_unreadable", message: 'không đọc được file đính kèm: "a.pdf"' });
    });

    it("is refused when the stream fails or ends before the run", async () => {
      const first = setup();
      const failed = asked(first.result);
      emit({ type: "error", code: "ai_rate_limited" });
      await expect(failed).resolves.toEqual({ accepted: false, code: "ai_rate_limited", message: "" });
      first.unmount();
      const second = setup();
      const ended = asked(second.result);
      await act(async () => finish());
      await expect(ended).resolves.toEqual({ accepted: false, code: "stream_ended", message: "" });
    });

    it("reports nothing when the turn is stopped or replaced before the run", async () => {
      const { result } = setup();
      const stopped = asked(result);
      act(() => result.current.stop());
      await expect(stopped).resolves.toEqual({ accepted: false, code: null, message: "" });
      const replaced = asked(result);
      void asked(result);
      await expect(replaced).resolves.toEqual({ accepted: false, code: null, message: "" });
    });
  });

  it("a thrown mapped error sets errorCode", async () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    act(() => fail(new ApiError("x", "ai_unavailable", 503)));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "ai_unavailable" }));
  });

  it.each(["done", "stopped", "error"] as const)("a new conversation after a %s first turn is idle again", (end) => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r1", conversationId: "c1" });
    if (end === "error") emit({ type: "error", code: "internal" });
    else emit({ type: "done", message: msg({ notice: end === "stopped" ? "stopped" : "" }), usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 } });
    expect(result.current.state.status).toBe(end);
    act(() => useAiPanelStore.getState().select(null));
    expect(result.current.state).toMatchObject({ status: "idle", conversationId: null });
  });

  it("a new conversation mid-turn aborts it", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    emit({ type: "run", runId: "r1", conversationId: "c1" });
    act(() => useAiPanelStore.getState().select(null));
    expect(opts.signal.aborted).toBe(true);
    expect(result.current.state.status).toBe("idle");
  });

  it("a stream that ends without done or error is an error", async () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q" }));
    act(() => finish());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "error", errorCode: "stream_ended" }));
  });
});

describe("useAskModelChoice", () => {
  it("persists model, effort and the notes' fold only, and rehydrates them from storage", async () => {
    useAskModelChoice.getState().setModel("claude-opus");
    useAskModelChoice.getState().setEffort("high");
    useAskModelChoice.getState().hideNotes(1234);
    const stored = JSON.parse(localStorage.getItem("uniwork_ask_uni_model") ?? "{}") as { state: Record<string, unknown> };
    expect(stored.state).toEqual({ model: "claude-opus", effort: "high", notesHiddenUntil: 1234 });
    useAskModelChoice.setState({ model: "", effort: "", notesHiddenUntil: 0 });
    expect(useAskModelChoice.getState().model).toBe("");
    localStorage.setItem("uniwork_ask_uni_model", JSON.stringify({ ...stored, version: 1 }));
    await useAskModelChoice.persist.rehydrate();
    expect(useAskModelChoice.getState()).toMatchObject({ model: "claude-opus", effort: "high", notesHiddenUntil: 1234 });
    useAskModelChoice.getState().showNotes();
    expect(useAskModelChoice.getState().notesHiddenUntil).toBe(0);
  });

  const proposal = { id: "p1", message_id: "m1", position: 1, tool: "update_task", status: "pending" } as never;
  const usage0 = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };

  it("a proposal event attaches to the running turn and done keeps the rows in the stored answer", () => {
    const { result, qc } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "proposal", proposals: [proposal] });
    expect(result.current.state.proposals).toEqual([proposal]);
    emit({ type: "done", message: msg(), usage: usage0 });
    expect(result.current.state.proposals).toEqual([proposal]);
    const stored = qc.getQueryData<{ id: string; proposals: unknown[] }[]>(aiKeys.messages("c1"));
    expect(stored?.find((m) => m.id === "m1")?.proposals).toEqual([proposal]);
  });

  const memRow = { id: "mp1", message_id: "m1", position: 1, action: "remember", status: "pending" } as never;

  it("memory_proposals and memory_used land in the stored answer on done", () => {
    const { result, qc } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "memory_proposals", proposals: [memRow] });
    emit({ type: "memory_used", memoryIds: ["e1"] });
    expect(result.current.state).toMatchObject({ memoryProposals: [memRow], memoryIds: ["e1"] });
    emit({ type: "done", message: msg(), usage: usage0 });
    const stored = qc.getQueryData<{ id: string; memory_proposals: unknown[]; memory_ids: string[] }[]>(aiKeys.messages("c1"));
    expect(stored?.find((m) => m.id === "m1")).toMatchObject({ memory_proposals: [memRow], memory_ids: ["e1"] });
  });

  it("a stopped turn keeps no memory proposals", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "memory_proposals", proposals: [memRow] });
    emit({ type: "memory_used", memoryIds: ["e1"] });
    emit({ type: "done", message: msg({ notice: "stopped" }), usage: usage0 });
    expect(result.current.state.memoryIds).toEqual([]);
    expect(result.current.state.message?.memory_proposals).toEqual([]);
    expect(result.current.state.memoryProposals).toEqual([]);
  });

  it("a later proposal event replaces the rows (they carry their own state)", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "proposal", proposals: [proposal] });
    const applied = { ...(proposal as object), status: "applied" } as never;
    emit({ type: "proposal", proposals: [applied] });
    expect(result.current.state.proposals).toEqual([applied]);
  });

  it("a stopped turn keeps no proposals: the server stored none", () => {
    const { result, qc } = setup();
    act(() => void result.current.ask({ question: "q", conversation_id: "c1" }));
    emit({ type: "proposal", proposals: [proposal] });
    emit({ type: "done", message: msg({ notice: "stopped" }), usage: usage0 });
    expect(result.current.state.message?.proposals).toEqual([]);
    expect(result.current.state.proposals).toEqual([]);
    const stored = qc.getQueryData<{ id: string; proposals: unknown[] }[]>(aiKeys.messages("c1"));
    expect(stored?.find((m) => m.id === "m1")?.proposals).toEqual([]);
  });
});

describe("useAskUniStream transient mode (drive_file)", () => {
  const usage0 = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };

  afterEach(() => {
    useAiPanelStore.getState().reset();
  });

  it("two questions in a row append to transientMessages, send transient + transcript without conversation_id, and never touch aiKeys.messages or aiKeys.conversations", () => {
    const { result, qc } = setup();
    const setQueryData = vi.spyOn(qc, "setQueryData");
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    act(() => void result.current.ask({ question: "Tóm tắt các mốc", focus: { kind: "drive_file", id: "df1" }, conversation_id: "should-be-dropped" }));
    expect(askUniStream).toHaveBeenLastCalledWith(
      "ws1",
      {
        question: "Tóm tắt các mốc",
        focus: { kind: "drive_file", id: "df1" },
        transient: true,
        transcript: [],
      },
      expect.anything(),
    );

    emit({ type: "run", runId: "r1", conversationId: "" });
    expect(useAiPanelStore.getState().conversationId).toBeNull();
    emit({ type: "done", message: msg({ id: "a1", content: "Hai mốc chính: 10/11 và 01/12." }), usage: usage0 });

    expect(setQueryData).not.toHaveBeenCalled();
    const invalidatedKeys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).not.toContain(JSON.stringify(aiKeys.conversations("ws1")));
    expect(invalidatedKeys.some((k) => k.includes('"messages"'))).toBe(false);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        JSON.stringify(aiKeys.capabilities("ws1")),
        JSON.stringify(aiKeys.usages()),
      ]),
    );

    const storedAfter1 = useAiPanelStore.getState().transientMessages;
    expect(storedAfter1.map((m) => [m.role, m.content])).toEqual([
      ["user", "Tóm tắt các mốc"],
      ["assistant", "Hai mốc chính: 10/11 và 01/12."],
    ]);

    // Second question sends the first turn in transcript
    act(() => void result.current.ask({ question: "Liệt kê ai phụ trách gì", focus: { kind: "drive_file", id: "df1" } }));
    expect(askUniStream).toHaveBeenLastCalledWith(
      "ws1",
      {
        question: "Liệt kê ai phụ trách gì",
        focus: { kind: "drive_file", id: "df1" },
        transient: true,
        transcript: [
          { role: "user", text: "Tóm tắt các mốc" },
          { role: "assistant", text: "Hai mốc chính: 10/11 và 01/12." },
        ],
      },
      expect.anything(),
    );

    emit({ type: "run", runId: "r2", conversationId: "" });
    emit({ type: "done", message: msg({ id: "a2", content: "Minh phụ trách beta." }), usage: usage0 });

    expect(useAiPanelStore.getState().transientMessages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Tóm tắt các mốc"],
      ["assistant", "Hai mốc chính: 10/11 và 01/12."],
      ["user", "Liệt kê ai phụ trách gì"],
      ["assistant", "Minh phụ trách beta."],
    ]);
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("stop mid-stream in transient mode keeps partial text in transientMessages, writes no cache, and schedules no 1500 ms revisit", () => {
    vi.useFakeTimers();
    try {
      const { result, qc } = setup();
      const setQueryData = vi.spyOn(qc, "setQueryData");
      const invalidate = vi.spyOn(qc, "invalidateQueries");

      act(() => void result.current.ask({ question: "Rủi ro là gì?", focus: { kind: "drive_file", id: "df1" } }));
      emit({ type: "run", runId: "r1", conversationId: "" });
      emit({ type: "delta", text: "Rủi ro lớn nhất là " });
      act(() => result.current.stop());

      expect(opts.signal.aborted).toBe(true);
      expect(result.current.state.status).toBe("stopped");
      expect(useAiPanelStore.getState().transientMessages.map((m) => [m.role, m.content, m.notice])).toEqual([
        ["user", "Rủi ro là gì?", ""],
        ["assistant", "Rủi ro lớn nhất là ", "stopped"],
      ]);
      expect(setQueryData).not.toHaveBeenCalled();

      const keysBeforeTimer = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keysBeforeTimer).not.toContain(JSON.stringify(aiKeys.conversations("ws1")));
      expect(keysBeforeTimer.some((k) => k.includes('"messages"'))).toBe(false);

      const callCount = invalidate.mock.calls.length;
      act(() => void vi.advanceTimersByTime(2000));
      expect(invalidate.mock.calls.length).toBe(callCount);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stopping before the first delta keeps the stopped turn for display but omits empty text from the next question's transcript", () => {
    const { result } = setup();
    act(() => void result.current.ask({ question: "Câu 1", focus: { kind: "drive_file", id: "df1" } }));
    emit({ type: "run", runId: "r1", conversationId: "" });
    act(() => result.current.stop());

    expect(useAiPanelStore.getState().transientMessages.map((m) => [m.role, m.content, m.notice])).toEqual([
      ["user", "Câu 1", ""],
      ["assistant", "", "stopped"],
    ]);

    act(() => void result.current.ask({ question: "Câu 2", focus: { kind: "drive_file", id: "df1" } }));
    const sentBody = vi.mocked(askUniStream).mock.calls.at(-1)?.[1];
    expect(sentBody?.transcript).toEqual([{ role: "user", text: "Câu 1" }]);
    expect(sentBody?.transcript?.every((t) => t.text.length > 0 && Object.keys(t).sort().join(",") === "role,text")).toBe(true);
  });

  it("slides the transcript window past 20 turns and marks transientWindowTrimmed", () => {
    const { result } = setup();
    for (let i = 1; i <= 10; i += 1) {
      useAiPanelStore.getState().appendTransientTurn(
        msg({ id: `u${i}`, role: "user", content: `Q${i}` }),
        msg({ id: `a${i}`, role: "assistant", content: `A${i}` }),
      );
    }
    expect(useAiPanelStore.getState().transientMessages).toHaveLength(20);
    expect(useAiPanelStore.getState().transientWindowTrimmed).toBe(false);

    // Turn 21 added -> window trims oldest turn
    useAiPanelStore.getState().appendTransientTurn(
      msg({ id: "u11", role: "user", content: "Q11" }),
      msg({ id: "a11", role: "assistant", content: "A11" }),
    );
    expect(useAiPanelStore.getState().transientWindowTrimmed).toBe(true);

    act(() => void result.current.ask({ question: "Q12", focus: { kind: "drive_file", id: "df1" } }));
    const sentBody = vi.mocked(askUniStream).mock.calls.at(-1)?.[1];
    expect(sentBody?.transcript).toHaveLength(20);
    expect(sentBody?.transcript?.[0]).toEqual({ role: "user", text: "Q2" });
    expect(sentBody?.transcript?.[19]).toEqual({ role: "assistant", text: "A11" });
  });
});
