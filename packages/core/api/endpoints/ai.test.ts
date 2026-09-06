import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  askUni,
  deleteAiConversation,
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

  it("usage builds the window query and degrades to no rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ from: "a", to: "b", rows: [{ day: "2026-09-06", capability: "copilot_answer", calls: 2, input_tokens: 10, output_tokens: 3, cost_micros: 40 }] }));
    const usage = await getAiUsage("ws1", "2026-08-01", "2026-09-06");
    expect(usage.rows[0]!.actor_kind).toBe("human");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/ai/usage?from=2026-08-01&to=2026-09-06");
    vi.mocked(fetch).mockResolvedValueOnce(json({ rows: "many" }));
    expect((await getOrgAiUsage("o1")).rows).toEqual([]);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("http://api.test/api/v1/orgs/o1/ai/usage");
  });
});
