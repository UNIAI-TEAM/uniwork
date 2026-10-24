import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { AiCapabilities, AiMessage, AiProposal } from "../types/ai";
import { aiKeys } from "./hooks";
import {
  useApplyAiMessageProposals,
  useApplyAiProposal,
  useAskWritePolicy,
  useEditAiProposal,
  useRejectAiProposal,
  useSaveAiAnswerAsDocument,
  useSetAskUniMode,
  useSetAskWritePolicy,
  useUndoAiProposal,
} from "./proposal-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const err = (code: string, fields?: Record<string, unknown>, status = 409) =>
  json({ error: { code, message: code, fields } }, status);

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, message_id: "m1", position: 1, tool: "update_task", level: "l2", mode: "ask", status: "pending", decision: "",
  can_undo: false, error_code: "", tainted: false, expires_at: "t", ...over,
});
const msg = (id: string, proposals: unknown[]): AiMessage =>
  ({ id, role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals, created_at: "" }) as unknown as AiMessage;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  qc.setQueryData(aiKeys.messages("c1"), [msg("m0", []), msg("m1", [{ ...row("p1"), status: "pending" }, row("p2", { position: 2 })])]);
  return { qc, wrapper };
}
const rowsOf = (qc: QueryClient) =>
  qc.getQueryData<AiMessage[]>(aiKeys.messages("c1"))!.find((m) => m.id === "m1")!.proposals as AiProposal[];

describe("proposal hooks", () => {
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

  it("apply puts the returned row into the right message without refetching", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json(row("p1", { status: "applied", can_undo: true })));
    const { result } = renderHook(() => useApplyAiProposal("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("p1")));
    expect(rowsOf(qc).map((r) => [r.id, r.status])).toEqual([["p1", "applied"], ["p2", "pending"]]);
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiKeys.messages("c1") }));
  });

  it("reject, undo, edit and save-as-document each replace their row", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(row("p1", { status: "rejected" })))
      .mockResolvedValueOnce(json(row("p2", { status: "undone" })))
      .mockResolvedValueOnce(json(row("p2", { status: "pending", mode: "plan" })))
      .mockResolvedValueOnce(json(row("pd", { position: 0, status: "applied" })));
    const rej = renderHook(() => useRejectAiProposal("c1"), { wrapper });
    const und = renderHook(() => useUndoAiProposal("c1"), { wrapper });
    const edit = renderHook(() => useEditAiProposal("c1"), { wrapper });
    const save = renderHook(() => useSaveAiAnswerAsDocument("c1"), { wrapper });
    await act(async () => void (await rej.result.current.mutateAsync("p1")));
    await act(async () => void (await und.result.current.mutateAsync("p2")));
    expect(rowsOf(qc).map((r) => r.status)).toEqual(["rejected", "undone"]);
    await act(async () => void (await edit.result.current.mutateAsync({ id: "p2", changes: { title: "x" } })));
    expect(rowsOf(qc)[1]!.mode).toBe("plan");
    await act(async () => void (await save.result.current.mutateAsync("m1")));
    expect(vi.mocked(fetch).mock.calls[3]![0]).toBe("http://api.test/api/v1/ai/conversations/c1/messages/m1/document");
  });

  it("apply-all replaces every returned row", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ proposals: [row("p1", { status: "applied" }), row("p2", { status: "rejected", position: 2 })] }));
    const { result } = renderHook(() => useApplyAiMessageProposals("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync({ messageId: "m1", ids: ["p1"] })));
    expect(rowsOf(qc).map((r) => r.status)).toEqual(["applied", "rejected"]);
  });

  it("a failed apply (409 with the row) lands the failed row, no refetch", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(err("revision_conflict", { proposal: row("p1", { status: "failed", error_code: "revision_conflict" }) }));
    const { result } = renderHook(() => useApplyAiProposal("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("p1").catch(() => undefined)));
    expect(rowsOf(qc)[0]).toMatchObject({ status: "failed", error_code: "revision_conflict" });
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiKeys.messages("c1") }));
  });

  it("a stopped apply-all (409 with fields.proposals) lands every row", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      err("apply_failed", { proposals: [row("p1", { status: "applied" }), row("p2", { status: "failed", position: 2, error_code: "apply_failed" })] }),
    );
    const { result } = renderHook(() => useApplyAiMessageProposals("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync({ messageId: "m1", ids: ["p1", "p2"] }).catch(() => undefined)));
    expect(rowsOf(qc).map((r) => r.status)).toEqual(["applied", "failed"]);
  });

  it("proposal_not_pending without rows refetches the messages", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(err("proposal_not_pending"));
    const { result } = renderHook(() => useApplyAiProposal("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("p1").catch(() => undefined)));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKeys.messages("c1") }));
    expect(rowsOf(qc).map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  it("a malformed success answer refetches instead of splicing an empty-id row", async () => {
    const { qc, wrapper } = setup();
    const before = qc.getQueryData(aiKeys.messages("c1"));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json("garbage"));
    const { result } = renderHook(() => useApplyAiProposal("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("p1")));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKeys.messages("c1") });
    expect(qc.getQueryData(aiKeys.messages("c1"))).toBe(before);
  });

  it("a row whose message is not cached changes nothing and does not crash", async () => {
    const { qc, wrapper } = setup();
    const before = qc.getQueryData(aiKeys.messages("c1"));
    vi.mocked(fetch).mockResolvedValueOnce(json(row("zz", { status: "applied" })));
    const { result } = renderHook(() => useApplyAiProposal("c1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("zz")));
    expect(qc.getQueryData(aiKeys.messages("c1"))).toEqual(before);
    qc.removeQueries({ queryKey: aiKeys.messages("c1") });
    vi.mocked(fetch).mockResolvedValueOnce(json(row("p1", { status: "applied" })));
    await act(async () => void (await result.current.mutateAsync("p1")));
    expect(qc.getQueryData(aiKeys.messages("c1"))).toBeUndefined();
  });

  it("set mode writes the server's answer into the capabilities cache", async () => {
    const { qc, wrapper } = setup();
    const caps = { enabled: true, actions: { enabled: true, ceiling: "plan", mode: "ask" } } as unknown as AiCapabilities;
    qc.setQueryData(aiKeys.capabilities("ws1"), caps);
    vi.mocked(fetch).mockResolvedValueOnce(json({ mode: "plan" }));
    const { result } = renderHook(() => useSetAskUniMode("ws1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("auto")));
    expect(qc.getQueryData<AiCapabilities>(aiKeys.capabilities("ws1"))!.actions).toEqual({ enabled: true, ceiling: "plan", mode: "plan" });
  });

  it("write policy reads and writes under an org-keyed query", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ ceiling: "plan" })).mockResolvedValueOnce(json({ ceiling: "auto" }));
    const read = renderHook(() => useAskWritePolicy("o1"), { wrapper });
    await waitFor(() => expect(read.result.current.data).toBe("plan"));
    const write = renderHook(() => useSetAskWritePolicy("o1"), { wrapper });
    await act(async () => void (await write.result.current.mutateAsync("auto")));
    expect(qc.getQueryData(aiKeys.askWritePolicy("o1"))).toBe("auto");
  });
});
