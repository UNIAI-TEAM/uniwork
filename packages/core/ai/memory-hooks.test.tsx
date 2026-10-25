import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { AiCapabilities, AiMemoryList, AiMemoryProposal, AiMessage } from "../types/ai";
import { aiKeys } from "./hooks";
import {
  aiMemoryKeys,
  useAiMemory,
  useApplyAiMemoryProposal,
  useClearAiMemory,
  useCreateAiMemory,
  useDeleteAiMemory,
  useEditAiMemoryProposal,
  useImportAiMemory,
  useRejectAiMemoryProposal,
  useSetAskUniMemory,
  useSplitAiMemoryImport,
  useUndoAiMemoryProposal,
  useUpdateAiMemory,
} from "./memory-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const err = (code: string, fields?: Record<string, unknown>, status = 409) =>
  json({ error: { code, message: code, fields } }, status);
const entry = { id: "e1", kind: "preference", text: "Trả lời ngắn", source: "manual", created_at: "t", updated_at: "t" };
const list = { entries: [entry], on: true, limit: 50, remaining: 49 };
const prow = (id: string, over: Record<string, unknown> = {}) => ({
  id, message_id: "m1", position: 1, action: "remember", memory_id: "", kind: "fact", text: "Tôi là PM",
  before_kind: "", before_text: "", status: "pending", expires_at: "t", ...over,
});
const msg = (id: string, memory_proposals: unknown[]): AiMessage =>
  ({ id, role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], memory_ids: [], memory_proposals, created_at: "" }) as unknown as AiMessage;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  qc.setQueryData(aiKeys.messages("c1"), [msg("m0", []), msg("m1", [prow("mp1"), prow("mp2", { position: 2 })])]);
  return { qc, wrapper };
}
const rowsOf = (qc: QueryClient) =>
  qc.getQueryData<AiMessage[]>(aiKeys.messages("c1"))!.find((m) => m.id === "m1")!.memory_proposals as AiMemoryProposal[];

describe("memory hooks", () => {
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

  it("apply writes the applied row into the messages and invalidates the memory list", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json(prow("mp1", { status: "applied", memory_id: "e9" })));
    const { result } = renderHook(() => useApplyAiMemoryProposal("c1", "acme"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("mp1")));
    expect(rowsOf(qc).map((r) => [r.id, r.status])).toEqual([["mp1", "applied"], ["mp2", "pending"]]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiMemoryKeys.all("acme") });
  });

  it("reject and edit replace their row; reject does not touch the list", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(prow("mp1", { status: "rejected" })))
      .mockResolvedValueOnce(json(prow("mp2", { text: "đã sửa" })));
    const rej = renderHook(() => useRejectAiMemoryProposal("c1", "acme"), { wrapper });
    const edit = renderHook(() => useEditAiMemoryProposal("c1", "acme"), { wrapper });
    await act(async () => void (await rej.result.current.mutateAsync("mp1")));
    await act(async () => void (await edit.result.current.mutateAsync({ id: "mp2", body: { text: "đã sửa" } })));
    expect(rowsOf(qc).map((r) => [r.status, r.text])).toEqual([["rejected", "Tôi là PM"], ["pending", "đã sửa"]]);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: aiMemoryKeys.all("acme") });
  });

  it("undo writes the undone row and invalidates the memory list", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json(prow("mp1", { status: "undone" })));
    const { result } = renderHook(() => useUndoAiMemoryProposal("c1", "acme"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("mp1")));
    expect(rowsOf(qc)[0]!.status).toBe("undone");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiMemoryKeys.all("acme") });
  });

  it("a 409 that carries the row writes that row; a bare refusal refetches the messages", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(err("proposal_not_pending", { proposal: prow("mp1", { status: "applied" }) }));
    const { result } = renderHook(() => useApplyAiMemoryProposal("c1", "acme"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("mp1").catch(() => undefined)));
    expect(rowsOf(qc)[0]!.status).toBe("applied");
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiKeys.messages("c1") }));
    vi.mocked(fetch).mockResolvedValueOnce(err("ai_memory_full"));
    await act(async () => void (await result.current.mutateAsync("mp2").catch(() => undefined)));
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: aiKeys.messages("c1") }));
    vi.mocked(fetch).mockResolvedValueOnce(err("proposal_expired"));
    await act(async () => void (await result.current.mutateAsync("mp2").catch(() => undefined)));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKeys.messages("c1") });
  });

  it("an unreadable answer refetches the messages instead of splicing", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(json([1]));
    const { result } = renderHook(() => useApplyAiMemoryProposal("c1", "acme"), { wrapper });
    await act(async () => void (await result.current.mutateAsync("mp1")));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKeys.messages("c1") });
    expect(rowsOf(qc)[0]!.status).toBe("pending");
  });

  it("useAiMemory reads the list; entry mutations write it back", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json(list));
    const q = renderHook(() => useAiMemory("acme"), { wrapper });
    await waitFor(() => expect(q.result.current.data?.entries).toHaveLength(1));
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory");

    q.unmount(); // an active list would refetch on invalidation and eat the queued answers
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const create = renderHook(() => useCreateAiMemory("acme"), { wrapper });
    const update = renderHook(() => useUpdateAiMemory("acme"), { wrapper });
    const del = renderHook(() => useDeleteAiMemory("acme"), { wrapper });
    const clear = renderHook(() => useClearAiMemory("acme"), { wrapper });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(entry))
      .mockResolvedValueOnce(json(entry))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ deleted: 1 }));
    await act(async () => void (await create.result.current.mutateAsync({ kind: "fact", text: "x" })));
    await act(async () => void (await update.result.current.mutateAsync({ id: "e1", body: { text: "y" } })));
    await act(async () => void (await del.result.current.mutateAsync("e1")));
    await act(async () => void (await clear.result.current.mutateAsync()));
    expect(invalidate).toHaveBeenCalledTimes(4);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiMemoryKeys.all("acme") });
  });

  it("split does not touch the list; import invalidates it", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ candidates: [], skipped: [] }))
      .mockResolvedValueOnce(json({ ...list, skipped_duplicates: 0 }));
    const split = renderHook(() => useSplitAiMemoryImport("acme"), { wrapper });
    const imp = renderHook(() => useImportAiMemory("acme"), { wrapper });
    await act(async () => void (await split.result.current.mutateAsync("text")));
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => void (await imp.result.current.mutateAsync([{ kind: "fact", text: "x" }])));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiMemoryKeys.all("acme") });
  });

  it("the switch invalidates capabilities and every memory list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<AiMemoryList>(aiMemoryKeys.all("acme"), { entries: [], on: true, limit: 50, remaining: 50 });
    qc.setQueryData<Partial<AiCapabilities>>(aiKeys.capabilities("ws1"), { enabled: true });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { result } = renderHook(() => useSetAskUniMemory("ws1"), { wrapper });
    await act(async () => void (await result.current.mutateAsync(false)));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKeys.capabilities("ws1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ai-memory"] });
  });
});
