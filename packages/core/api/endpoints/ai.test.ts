import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  askUni,
  chatCatchUp,
  chatTaskDraft,
  deleteAiConversation,
  deleteAiFeedback,
  getAskModels,
  putAiFeedback,
  putAskModels,
  renameAiConversation,
  getAiCapabilities,
  getAiUsage,
  getOrgAiUsage,
  listAiConversations,
  listAiMessages,
} from "./ai";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const message = {
  id: "m1", role: "assistant", content: "Có 1 việc quá hạn: [S1].",
  citations: [{ source_id: "S1", quote: "Hạn: 2026-09-05", kind: "task", title: "Viết spec", href: "/acme/team/tasks/t1" }],
  created_at: "2026-09-06T08:00:00Z",
};

describe("ai endpoints", () => {
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

  it("getAiCapabilities keeps unknown quota fields and degrades to disabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, ask_uni: true, meeting_summary: false, quota: { used_tokens: 10, limit_tokens: null } }));
    const caps = await getAiCapabilities("ws1");
    expect(caps.enabled).toBe(true);
    expect(caps.quota.limit_tokens).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/capabilities");
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: "yes" }));
    expect((await getAiCapabilities("ws1")).enabled).toBe(false);
  });

  it("askUni posts the body, parses citations, and throws on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversation_id: "c1", message, usage: { input_tokens: 5, output_tokens: 2 } }));
    const res = await askUni("ws1", { question: "task nào quá hạn?", focus: { kind: "task", id: "t1" }, locale: "vi" });
    expect(res.conversation_id).toBe("c1");
    expect(res.message.citations[0]!.href).toBe("/acme/team/tasks/t1");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ question: "task nào quá hạn?", focus: { kind: "task", id: "t1" }, locale: "vi" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversation_id: "c1", message: { id: 1 } }));
    await expect(askUni("ws1", { question: "?" })).rejects.toThrow("ai_output_invalid");
  });

  it("askUni passes the abort signal to the request and keeps it out of the body", async () => {
    // fetch rejects the way a browser does once the signal aborts.
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const ctrl = new AbortController();
    const pending = askUni("ws1", { question: "q" }, { signal: ctrl.signal });
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(ctrl.signal);
    expect(JSON.parse(init.body as string)).toEqual({ question: "q" });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("chatCatchUp posts room focus and degrades malformed payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        summary: "Có 2 tin mới.",
        highlights: ["An nhắc hạn"],
        highlight_items: [{ text: "An nhắc hạn", source_message_id: "m2" }, { text: "Không nguồn" }],
        action_items: [{ title: "Gửi bản nháp", owner: "An", source_message_id: "m1" }],
        message_count: 2,
        since: "2026-09-11T08:00:00Z",
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    );
    const res = await chatCatchUp("ws1", { room_id: "r1", locale: "vi" });
    expect(res.summary).toBe("Có 2 tin mới.");
    expect(res.action_items[0]!.source_message_id).toBe("m1");
    expect(res.highlight_items).toEqual([
      { text: "An nhắc hạn", source_message_id: "m2" },
      { text: "Không nguồn", source_message_id: "" },
    ]);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ room_id: "r1", locale: "vi" });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/chat/catch-up");
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: 1 }));
    expect((await chatCatchUp("ws1", { room_id: "r1" })).summary).toBe("");
    // An older server omits highlight_items; a drifted one must not blank the brief.
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: "Cũ", highlights: ["a"] }));
    expect((await chatCatchUp("ws1", { room_id: "r1" })).highlight_items).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: "Lệch", highlights: ["a"], highlight_items: [{ text: 1 }] }));
    const drifted = await chatCatchUp("ws1", { room_id: "r1" });
    expect(drifted.summary).toBe("Lệch");
    expect(drifted.highlights).toEqual(["a"]);
    expect(drifted.highlight_items).toEqual([]);
    // The same for the action items: one drifted list empties alone (the phone reads this schema too).
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: "Lệch", action_items: [{ owner: "An" }] }));
    const noActions = await chatCatchUp("ws1", { room_id: "r1" });
    expect(noActions.summary).toBe("Lệch");
    expect(noActions.action_items).toEqual([]);
  });

  it("chatTaskDraft posts message ids and degrades malformed payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        title: "Gửi bản nháp",
        description: "An nhờ gửi trước thứ Sáu.",
        priority: "high",
        message_count: 2,
        usage: { input_tokens: 8, output_tokens: 3 },
      }),
    );
    const res = await chatTaskDraft("ws1", { message_ids: ["m1", "m2"], locale: "vi" });
    expect(res.title).toBe("Gửi bản nháp");
    expect(res.priority).toBe("high");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ message_ids: ["m1", "m2"], locale: "vi" });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/chat/task-draft");
    vi.mocked(fetch).mockResolvedValueOnce(json({ title: 1 }));
    expect((await chatTaskDraft("ws1", { message_ids: ["m1"] })).title).toBe("");
  });

  it("conversations and messages degrade to empty lists", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversations: [{ id: "c1", title: "t" }] }));
    expect((await listAiConversations("ws1"))[0]!.id).toBe("c1");
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversations: "nope" }));
    expect(await listAiConversations("ws1")).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [message, { ...message, id: "m2", role: "user", citations: undefined }] }));
    const msgs = await listAiMessages("c1");
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.citations).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ id: 1 }] }));
    expect(await listAiMessages("c1")).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await deleteAiConversation("c1");
    expect((vi.mocked(fetch).mock.calls[4]![1] as RequestInit).method).toBe("DELETE");
  });

  it("listAiConversations sends q and degrades on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversations: [{ id: "c1" }] }));
    await listAiConversations("ws1", "viec tre");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/\/ai\/conversations\?q=viec%20tre$/);
    vi.mocked(fetch).mockResolvedValueOnce(json({ conversations: 5 }));
    expect(await listAiConversations("ws1", "x")).toEqual([]);
  });

  it("listAiMessages defaults malformed steps, followups, focus and mentions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ ...message, steps: "x", followups: 3, focus: 1, mentions: {} }] }));
    const [m] = await listAiMessages("c1");
    expect(m).toMatchObject({ steps: [], followups: [], focus: null, mentions: [] });
  });

  it("listAiMessages reads the answering model and defaults a malformed one to Auto", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ ...message, model: "opus" }, { ...message, id: "m2", model: 7 }, { ...message, id: "m3" }] }));
    expect((await listAiMessages("c1")).map((m) => m.model)).toEqual(["opus", "", ""]);
  });

  it("listAiMessages keeps a message whose notice is malformed and defaults it to empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ ...message, notice: 42 }, { ...message, id: "m2", content: "", notice: "no_sources" }] }));
    const msgs = await listAiMessages("c1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.notice).toBe("");
    expect(msgs[1]!.notice).toBe("no_sources");
  });

  it("usage builds the window query and degrades to no rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ from: "a", to: "b", rows: [{ day: "2026-09-06", capability: "copilot_answer", calls: 2, input_tokens: 10, output_tokens: 3, cost_micros: 40 }] }));
    const usage = await getAiUsage("ws1", "2026-08-01", "2026-09-06");
    expect(usage.rows[0]!.actor_kind).toBe("human");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/usage?from=2026-08-01&to=2026-09-06");
    vi.mocked(fetch).mockResolvedValueOnce(json({ rows: "many" }));
    expect((await getOrgAiUsage("o1")).rows).toEqual([]);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("http://api.test/api/v1/orgs/o1/ai/usage");
  });

  it("getAiCapabilities reads models and degrades a malformed model list without disabling AI", async () => {
    const m = { key: "sonnet", provider: "anthropic", speed: 4, intelligence: 4, cost: 3, enabled: true };
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, models: [m, { ...m, key: "opus", provider: 3 }], auto_model: "sonnet" }));
    const caps = await getAiCapabilities("ws1");
    expect(caps.models).toEqual([m, { ...m, key: "opus", provider: "" }]);
    expect(caps.auto_model).toBe("sonnet");
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true }));
    expect((await getAiCapabilities("ws1")).models).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, models: "x", auto_model: 3 }));
    const drifted = await getAiCapabilities("ws1");
    expect(drifted.enabled).toBe(true);
    expect(drifted.models).toEqual([]);
    expect(drifted.auto_model).toBe("");
  });

  it("message parsing keeps attachments and file_notes, and drops junk", async () => {
    const att = { id: "a1", name: "q3.pdf", mime: "application/pdf", size: 184320, kind: "pdf" };
    const note = { name: "q3.pdf", unit: "page", read: 15, total: 80 };
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        messages: [
          { ...message, id: "u1", role: "user", attachments: [att, { ...att, id: "a2", size: "big", kind: 3 }] },
          { ...message, id: "a1x", file_notes: [note, { ...note, read: 0 }] },
          // An older server sends neither; a drifted one must not drop the turn.
          { ...message, id: "old" },
          { ...message, id: "bad", attachments: "x", file_notes: [{ name: 1 }] },
          { ...message, id: "bad2", attachments: [{ name: "no id" }], file_notes: { a: 1 } },
        ],
      }),
    );
    const msgs = await listAiMessages("c1");
    expect(msgs.map((m) => m.id)).toEqual(["u1", "a1x", "old", "bad", "bad2"]);
    expect(msgs[0]!.attachments).toEqual([att, { ...att, id: "a2", size: 0, kind: "" }]);
    expect(msgs[0]!.file_notes).toEqual([]);
    expect(msgs[1]!.file_notes).toEqual([note, { ...note, read: 0 }]);
    expect(msgs[1]!.attachments).toEqual([]);
    for (const m of msgs.slice(2)) expect([m.attachments, m.file_notes]).toEqual([[], []]);
  });

  it("getAiCapabilities degrades a malformed memory block to off without disabling AI", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, ask_uni: true, memory: "nope" }));
    expect(await getAiCapabilities("ws1")).toMatchObject({ enabled: true, memory: { enabled: false, on: false } });
  });

  it("getAiCapabilities reads attachments and a malformed flag hides uploads without disabling AI", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, ask_uni: true, attachments: true }));
    expect((await getAiCapabilities("ws1")).attachments).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, ask_uni: true }));
    expect((await getAiCapabilities("ws1")).attachments).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, ask_uni: true, attachments: "yes" }));
    const drifted = await getAiCapabilities("ws1");
    expect(drifted).toMatchObject({ enabled: true, ask_uni: true, attachments: false });
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: "yes" }));
    expect((await getAiCapabilities("ws1")).attachments).toBe(false);
  });

  it("ask-models read and write degrade to the sent list on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ models: ["haiku"] }));
    expect(await getAskModels("o1")).toEqual(["haiku"]);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/o1/ai/ask-models");
    vi.mocked(fetch).mockResolvedValueOnce(json({ models: 5 }));
    expect(await getAskModels("o1")).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ models: ["opus"] }));
    expect(await putAskModels("o1", ["opus"])).toEqual(["opus"]);
    const init = vi.mocked(fetch).mock.calls[2]![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ models: ["opus"] });
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await putAskModels("o1", ["haiku"])).toEqual(["haiku"]);
  });

  it("feedback puts and deletes on the message, ignoring the empty 204 body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await putAiFeedback("c1", "m1", { rating: "down", reason: "wrong_facts", note: "n" });
    const put = vi.mocked(fetch).mock.calls[0]!;
    expect(put[0]).toBe("http://api.test/api/v1/ai/conversations/c1/messages/m1/feedback");
    expect((put[1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ rating: "down", reason: "wrong_facts", note: "n" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteAiFeedback("c1", "m1");
    expect((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).method).toBe("DELETE");
  });

  it("renameAiConversation patches the title and degrades a malformed answer to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "c1", title: "Mới" }));
    expect((await renameAiConversation("c1", "Mới"))?.title).toBe("Mới");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Mới" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ title: 1 }));
    expect(await renameAiConversation("c1", "x")).toBeNull();
  });
});
