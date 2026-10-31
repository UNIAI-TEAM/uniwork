import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { getAiCapabilities } from "./ai";
import {
  applyAiMessageProposals,
  applyAiProposal,
  editAiProposal,
  getAskWritePolicy,
  proposalRowsOfError,
  rejectAiProposal,
  saveAiAnswerAsDocument,
  setAskUniMode,
  setAskWritePolicy,
  undoAiProposal,
} from "./ai-proposals";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  message_id: "m1",
  position: 1,
  tool: "update_task",
  level: "l2",
  mode: "ask",
  status: "pending",
  decision: "",
  preview: {
    target: { kind: "task", id: "t1", title: "Viết spec" },
    fields: [{ field: "status", type: "enum", from: "Cần làm", to: "Hoàn thành", options: ["Cần làm", "Hoàn thành"] }],
    body: "",
    audience: { visibility: "task", notifies: [], notifies_more: false },
    refs: [],
  },
  result: { object_id: "", href: "", revision: 0, changes: [], note: "" },
  can_undo: false,
  error_code: "",
  tainted: false,
  expires_at: "2026-09-07T08:00:00Z",
  ...over,
});

const call = (i = 0) => {
  const [url, init] = vi.mocked(fetch).mock.calls[i]!;
  return { url: url as string, method: (init as RequestInit).method, body: (init as RequestInit).body as string | undefined };
};

describe("ai proposal endpoints", () => {
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

  it("apply, reject and undo POST to the row and return it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(row({ status: "applied", can_undo: true })))
      .mockResolvedValueOnce(json(row({ status: "rejected" })))
      .mockResolvedValueOnce(json(row({ status: "undone" })));
    expect((await applyAiProposal("p1")).status).toBe("applied");
    expect((await rejectAiProposal("p1")).status).toBe("rejected");
    expect((await undoAiProposal("p1")).status).toBe("undone");
    expect([0, 1, 2].map((i) => [call(i).method, call(i).url])).toEqual([
      ["POST", "http://api.test/api/v1/ai/proposals/p1/apply"],
      ["POST", "http://api.test/api/v1/ai/proposals/p1/reject"],
      ["POST", "http://api.test/api/v1/ai/proposals/p1/undo"],
    ]);
  });

  it("reads result.handoff_id as a string and degrades a number or a missing one to empty", async () => {
    const withResult = (r: Record<string, unknown>) => row({ status: "applied", result: { object_id: "d1", ...r } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(withResult({ handoff_id: "h1" })))
      .mockResolvedValueOnce(json(withResult({ handoff_id: 7 })))
      .mockResolvedValueOnce(json(withResult({})));
    expect((await applyAiProposal("p1")).result.handoff_id).toBe("h1");
    expect((await applyAiProposal("p1")).result.handoff_id).toBe("");
    expect((await applyAiProposal("p1")).result.handoff_id).toBe("");
  });

  it("edit PATCHes the changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(row()));
    await editAiProposal("p1", { title: "v2" });
    expect(call()).toMatchObject({ method: "PATCH", url: "http://api.test/api/v1/ai/proposals/p1" });
    expect(JSON.parse(call().body!)).toEqual({ changes: { title: "v2" } });
  });

  it("apply-all POSTs the ids and returns every row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ proposals: [row(), row({ id: "p2", position: 2 })] }));
    const rows = await applyAiMessageProposals("c1", "m1", ["p1", "p2"]);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(call()).toMatchObject({ method: "POST", url: "http://api.test/api/v1/ai/conversations/c1/messages/m1/proposals/apply" });
    expect(JSON.parse(call().body!)).toEqual({ proposal_ids: ["p1", "p2"] });
  });

  it("save-as-document POSTs and returns the row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(row({ position: 0, status: "applied" })));
    expect((await saveAiAnswerAsDocument("c1", "m1")).position).toBe(0);
    expect(call()).toMatchObject({ method: "POST", url: "http://api.test/api/v1/ai/conversations/c1/messages/m1/document" });
  });

  it("a malformed row degrades to fallback values instead of throwing", async () => {
    const { preview: _drop, ...noPreview } = row({ status: 7 });
    void _drop;
    vi.mocked(fetch).mockResolvedValueOnce(json(noPreview));
    const r = await applyAiProposal("p1");
    expect(r).toMatchObject({ id: "p1", status: "unknown", preview: { body: "", fields: [], refs: [] } });
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    expect(await rejectAiProposal("p1")).toMatchObject({ id: "", status: "unknown" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ proposals: "nope" }));
    expect(await applyAiMessageProposals("c1", "m1", ["p1"])).toEqual([]);
  });

  it("reads body_truncated, and anything but a boolean as false", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(row({ preview: { ...row().preview, body: "Đầu trang", body_truncated: true } })))
      .mockResolvedValueOnce(json(row({ preview: { ...row().preview, body_truncated: "yes" } })))
      .mockResolvedValueOnce(json(row()));
    expect((await applyAiProposal("p1")).preview.body_truncated).toBe(true);
    expect((await applyAiProposal("p1")).preview.body_truncated).toBe(false);
    expect((await applyAiProposal("p1")).preview.body_truncated).toBe(false);
  });

  it("keeps readable from/to values of any shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(row({ preview: { fields: [{ field: "labels", type: "labels", from: ["a"], to: null }] } })));
    const r = await applyAiProposal("p1");
    expect(r.preview.fields[0]).toMatchObject({ from: ["a"], to: null });
  });

  it("mode PUT returns the saved mode and falls back to the sent one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ mode: "plan" })).mockResolvedValueOnce(json({ mode: 3 }));
    expect(await setAskUniMode("auto")).toBe("plan");
    expect(call()).toMatchObject({ method: "PUT", url: "http://api.test/api/v1/me/ask-uni-mode" });
    expect(JSON.parse(call().body!)).toEqual({ mode: "auto" });
    expect(await setAskUniMode("ask")).toBe("ask");
  });

  it("write policy GET and PUT; malformed reads degrade", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ ceiling: "auto" }))
      .mockResolvedValueOnce(json({ ceiling: "ask" }))
      .mockResolvedValueOnce(json({ nope: 1 }))
      .mockResolvedValueOnce(json("x"));
    expect(await getAskWritePolicy("o1")).toBe("auto");
    expect(call(0)).toMatchObject({ method: "GET", url: "http://api.test/api/v1/orgs/o1/ai/ask-write-policy" });
    expect(await setAskWritePolicy("o1", "ask")).toBe("ask");
    expect(call(1)).toMatchObject({ method: "PUT", url: "http://api.test/api/v1/orgs/o1/ai/ask-write-policy" });
    expect(JSON.parse(call(1).body!)).toEqual({ ceiling: "ask" });
    expect(await getAskWritePolicy("o1")).toBe("plan");
    expect(await setAskWritePolicy("o1", "off")).toBe("off");
  });

  it("proposalRowsOfError reads error.fields.proposal and .proposals, and nothing else", () => {
    const one = new ApiError("x", "revision_conflict", 409, undefined, { proposal: row({ status: "failed" }) });
    expect(proposalRowsOfError(one).map((r) => r.status)).toEqual(["failed"]);
    const many = new ApiError("x", "apply_failed", 409, undefined, { proposals: [row(), row({ id: "p2" })] });
    expect(proposalRowsOfError(many).map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(proposalRowsOfError(new ApiError("x", "proposal_not_pending", 409))).toEqual([]);
    expect(proposalRowsOfError(new ApiError("x", "a", 409, undefined, { proposals: "bad" }))).toEqual([]);
    expect(proposalRowsOfError(new Error("boom"))).toEqual([]);
  });

  it("capabilities actions degrade to writes off", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ enabled: true, actions: { enabled: true, ceiling: "plan", mode: "ask" } }))
      .mockResolvedValueOnce(json({ enabled: true, actions: "x" }))
      .mockResolvedValueOnce(json({ enabled: true }));
    expect((await getAiCapabilities("ws1")).actions).toEqual({ enabled: true, ceiling: "plan", mode: "ask" });
    expect((await getAiCapabilities("ws1")).actions).toEqual({ enabled: false, ceiling: "off", mode: "" });
    expect((await getAiCapabilities("ws1")).actions).toEqual({ enabled: false, ceiling: "off", mode: "" });
  });
});
