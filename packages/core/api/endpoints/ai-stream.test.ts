import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { getAccessToken, setAccessToken } from "../session";
import { askUniStream, type AskUniStreamEvent } from "./ai-stream";

const enc = new TextEncoder();
const SSE = { "Content-Type": "text/event-stream; charset=utf-8" };

function sse(chunks: string[], init: { status?: number; keepOpen?: boolean } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!init.keepOpen) c.close();
    },
  });
  return new Response(stream, { status: init.status ?? 200, headers: SSE });
}
const frame = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const message = { id: "m1", role: "assistant", content: "ok", notice: "", citations: [], created_at: "" };

async function collect(res: Response | Response[]): Promise<AskUniStreamEvent[]> {
  for (const r of Array.isArray(res) ? res : [res]) vi.mocked(fetch).mockResolvedValueOnce(r);
  const events: AskUniStreamEvent[] = [];
  await askUniStream("ws1", { question: "q" }, { onEvent: (e) => events.push(e) });
  return events;
}

describe("askUniStream", () => {
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

  it("parses frames split across chunks", async () => {
    const a = frame("run", { run_id: "r1", conversation_id: "c1" });
    const b = frame("delta", { text: "Xin chào" });
    const whole = a + b;
    const cut = a.length + 20;
    const events = await collect(sse([whole.slice(0, cut), whole.slice(cut)]));
    expect(events).toEqual([
      { type: "run", runId: "r1", conversationId: "c1" },
      { type: "delta", text: "Xin chào" },
    ]);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/ask/stream");
    expect(init.method).toBe("POST");
  });

  it("handles CRLF, multi-line data and multi-byte text split mid-character", async () => {
    const bytes = enc.encode('event: delta\r\ndata: {"text":\r\ndata: "ệ"}\r\n\r\n');
    const split = bytes.indexOf(0xe1) + 1; // inside the 3-byte "ệ"
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, split));
        c.enqueue(bytes.slice(split));
        c.close();
      },
    });
    const events = await collect(new Response(stream, { headers: SSE }));
    expect(events).toEqual([{ type: "delta", text: "ệ" }]);
  });

  it("skips malformed and unknown events", async () => {
    const events = await collect(
      sse([
        "event: delta\ndata: {not json\n\n",
        frame("proposal", { id: "p" }),
        frame("step", { phase: "tool", tool: "x", counts: {} }),
        frame("delta", { text: "a" }),
        frame("citations", { citations: [{ source_id: "S1" }] }),
        frame("done", { message, usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4 } }),
        frame("error", { code: "ai_provider_error" }),
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(["delta", "citations", "done", "error"]);
    expect(events[1]).toMatchObject({ citations: [{ source_id: "S1", href: "" }] });
    expect(events[2]).toMatchObject({ usage: { cache_write_tokens: 4 } });
  });

  it("skips malformed sources, followups and title frames and reads on", async () => {
    const events = await collect(
      sse([
        frame("sources", { sources: [{ source_id: "S1", title: 3 }] }),
        frame("followups", { followups: "nope" }),
        frame("title", { title: "x" }),
        frame("step", { round: 1, phase: "tool", tool: "search", label: "viec tre", counts: { task: 1 } }),
        frame("sources", { sources: [{ source_id: "S1", kind: "task", title: "A", href: "/a", object_id: "t1" }] }),
        frame("followups", { followups: ["a?"] }),
        frame("done", { message, usage: {} }),
        frame("title", { conversation_id: "c1", title: "Việc trễ" }),
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(["step", "sources", "followups", "done", "title"]);
    expect(events[0]).toMatchObject({ label: "viec tre" });
    expect(events[1]).toMatchObject({ sources: [{ source_id: "S1", object_id: "t1" }] });
    expect(events[4]).toEqual({ type: "title", conversationId: "c1", title: "Việc trễ" });
    expect(events[3]).toMatchObject({ message: { steps: [], followups: [], focus: null, mentions: [] } });
  });

  it("reads reasoning frames and a step's note, an absent note as empty, and skips a malformed reasoning frame", async () => {
    const events = await collect(
      sse([
        frame("reasoning", { text: 5 }),
        frame("reasoning", { text: "Cần xem." }),
        frame("step", { round: 1, phase: "tool", tool: "search", label: "x", counts: {}, note: "Mình tìm." }),
        frame("step", { round: 1, phase: "tool", tool: "get_task", label: "A", counts: {} }),
      ]),
    );
    expect(events).toEqual([
      { type: "reasoning", text: "Cần xem." },
      { type: "step", round: 1, phase: "tool", tool: "search", label: "x", counts: {}, note: "Mình tìm." },
      { type: "step", round: 1, phase: "tool", tool: "get_task", label: "A", counts: {}, note: "" },
    ]);
  });

  it("ignores comment lines", async () => {
    const events = await collect(sse([": ping\n\n", frame("delta", { text: "a" }), ": ping\n\n"]));
    expect(events).toEqual([{ type: "delta", text: "a" }]);
  });

  it("resolves without events when the stream ends early", async () => {
    expect(await collect(sse([]))).toEqual([]);
  });

  it("refreshes once on 401", async () => {
    const user = { id: "u", email: "a@b.c", display_name: "A" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new", user }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(sse([frame("delta", { text: "ok" })]));
    const events: AskUniStreamEvent[] = [];
    await askUniStream("ws1", { question: "q" }, { onEvent: (e) => events.push(e) });
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => String(u).endsWith("/auth/refresh"))).toHaveLength(1);
    expect(events).toEqual([{ type: "delta", text: "ok" }]);
    expect(getAccessToken()).toBe("new");
  });

  it("throws the mapped error before streaming", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "ai_rate_limited", message: "slow" } }), {
        status: 429,
        headers: { "Retry-After": "7", "Content-Type": "application/json" },
      }),
    );
    await expect(askUniStream("ws1", { question: "q" }, { onEvent: () => undefined })).rejects.toMatchObject({
      code: "ai_rate_limited",
      status: 429,
      retryAfterSeconds: 7,
    });
  });

  it("rejects a success response that is not an event stream", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(askUniStream("ws1", { question: "q" }, { onEvent: () => undefined })).rejects.toMatchObject({ code: "internal" });
  });

  it("stops on abort and delivers nothing afterwards", async () => {
    const ctrl = new AbortController();
    let push!: (s: string) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => {
          try {
            c.enqueue(enc.encode(s));
          } catch {
            /* the reader already cancelled the stream */
          }
        };
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: SSE }));
    const events: AskUniStreamEvent[] = [];
    const p = askUniStream("ws1", { question: "q" }, { signal: ctrl.signal, onEvent: (e) => events.push(e) });
    const settled = p.catch((e: unknown) => e);
    push(frame("delta", { text: "a" }));
    await vi.waitFor(() => expect(events).toHaveLength(1));
    ctrl.abort();
    push(frame("delta", { text: "late" }));
    const err = await settled;
    expect((err as DOMException).name).toBe("AbortError");
    expect(events).toHaveLength(1);
  });

  it("a valid proposal frame becomes an event; a malformed one is dropped and the stream goes on", async () => {
    const row = { id: "p1", message_id: "m1", position: 1, tool: "update_task", status: "applied" };
    const events = await collect(
      sse([
        frame("proposal", { proposals: [row] }),
        frame("proposal", { proposals: "nope" }),
        "event: proposal\ndata: {oops\n\n",
        frame("delta", { text: "x" }),
      ]),
    );
    expect(events).toHaveLength(2);
    const noId = await collect(sse([frame("proposal", { proposals: [row, { tool: "x" }] })]));
    expect(noId).toMatchObject([{ type: "proposal", proposals: [{ id: "p1" }] }]);
    expect(events[0]).toMatchObject({ type: "proposal", proposals: [{ id: "p1", status: "applied", preview: { body: "", fields: [] } }] });
    expect(events[1]).toEqual({ type: "delta", text: "x" });
  });

  it("memory_proposals and memory_used frames become events; malformed ones are dropped", async () => {
    const row = { id: "mp1", message_id: "m1", position: 1, action: "remember", kind: "fact", text: "x", status: "pending" };
    const events = await collect(
      sse([
        frame("memory_proposals", { memory_proposals: [row, { text: "no id" }] }),
        frame("memory_proposals", { memory_proposals: "nope" }),
        frame("memory_used", { memory_ids: ["e1", "e2"] }),
        frame("memory_used", { memory_ids: 5 }),
        "event: memory_used\ndata: {oops\n\n",
        frame("delta", { text: "x" }),
      ]),
    );
    expect(events).toMatchObject([
      { type: "memory_proposals", proposals: [{ id: "mp1", action: "remember", status: "pending" }] },
      { type: "memory_used", memoryIds: ["e1", "e2"] },
      { type: "delta", text: "x" },
    ]);
    expect(events).toHaveLength(3);
  });

  it("sends mode only when set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(sse([])).mockResolvedValueOnce(sse([]));
    await askUniStream("ws1", { question: "q", mode: "plan" }, { onEvent: () => undefined });
    await askUniStream("ws1", { question: "q" }, { onEvent: () => undefined });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)).toEqual({ question: "q", mode: "plan" });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string)).toEqual({ question: "q" });
  });

  it("defaults conversation_id on run frame to empty string when missing or malformed (transient mode)", async () => {
    const events = await collect(
      sse([
        frame("run", { run_id: "r1", conversation_id: "" }),
        frame("run", { run_id: "r2", conversation_id: 42 }),
        frame("run", { run_id: "r3" }),
        frame("delta", { text: "ok" }),
      ]),
    );
    expect(events).toEqual([
      { type: "run", runId: "r1", conversationId: "" },
      { type: "run", runId: "r2", conversationId: "" },
      { type: "run", runId: "r3", conversationId: "" },
      { type: "delta", text: "ok" },
    ]);
  });
});
