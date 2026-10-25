"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/ai-proposals";
import { errorCode } from "../api/http";
import type { AiCapabilities, AiMessage, AiProposal } from "../types/ai";
import { aiKeys } from "./hooks";

/** Rows the server just answered replace the cached ones by id; nothing else in the conversation moves. */
function putRows(qc: QueryClient, conversationId: string, rows: AiProposal[]) {
  if (rows.length === 0) return;
  // An unreadable answer (a row with no id) cannot be spliced in: read the answers again instead.
  if (rows.some((r) => r.id === "")) {
    void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    return;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) =>
    old?.map((m) => (m.proposals.some((p) => byId.has(p.id)) ? { ...m, proposals: m.proposals.map((p) => byId.get(p.id) ?? p) } : m)),
  );
}

// A refused call may still carry rows (a failed row, a stopped apply-all): those are the truth, so no refetch,
// unless one is new to the cache (a "Tạo tài liệu" row that failed on its first try) and cannot be spliced in.
// Any other refusal (a row already decided, expired) leaves the card stale, so the answers are read again.
function putRowsOfError(qc: QueryClient, conversationId: string, err: unknown) {
  const rows = api.proposalRowsOfError(err);
  const cached = new Set(qc.getQueryData<AiMessage[]>(aiKeys.messages(conversationId))?.flatMap((m) => m.proposals.map((p) => p.id)));
  if (rows.length > 0 && rows.every((r) => cached.has(r.id))) return putRows(qc, conversationId, rows);
  if (rows.length > 0) return void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
  if (errorCode(err)?.startsWith("proposal_")) void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
}

/** Not optimistic: the server decides whether a row applies, so every hook here awaits it and then repaints from its answer. */
function useRowMutation<V>(conversationId: string, call: (v: V) => Promise<AiProposal | AiProposal[]>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (res) => putRows(qc, conversationId, Array.isArray(res) ? res : [res]),
    onError: (err) => putRowsOfError(qc, conversationId, err),
  });
}

export const useApplyAiProposal = (conversationId: string) => useRowMutation(conversationId, (id: string) => api.applyAiProposal(id));
export const useRejectAiProposal = (conversationId: string) => useRowMutation(conversationId, (id: string) => api.rejectAiProposal(id));
export const useUndoAiProposal = (conversationId: string) => useRowMutation(conversationId, (id: string) => api.undoAiProposal(id));

export const useEditAiProposal = (conversationId: string) =>
  useRowMutation(conversationId, (v: { id: string; changes: Record<string, unknown> }) => api.editAiProposal(v.id, v.changes));

export const useApplyAiMessageProposals = (conversationId: string) =>
  useRowMutation(conversationId, (v: { messageId: string; ids: string[] }) => api.applyAiMessageProposals(conversationId, v.messageId, v.ids));

/** The row it creates (position 0) is new to the cache, so the messages are read again for it. */
export function useSaveAiAnswerAsDocument(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.saveAiAnswerAsDocument(conversationId, messageId),
    onSuccess: (row) => {
      const known = qc.getQueryData<AiMessage[]>(aiKeys.messages(conversationId))?.some((m) => m.id === row.message_id && m.proposals.some((p) => p.id === row.id));
      if (known) putRows(qc, conversationId, [row]);
      else void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
    },
    onError: (err) => putRowsOfError(qc, conversationId, err),
  });
}

export function useSetAskUniMode(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: string) => api.setAskUniMode(mode),
    onSuccess: (mode) =>
      qc.setQueryData<AiCapabilities>(aiKeys.capabilities(wsId), (old) => (old ? { ...old, actions: { ...old.actions, mode } } : old)),
  });
}

export function useAskWritePolicy(orgId: string) {
  return useQuery({ queryKey: aiKeys.askWritePolicy(orgId), queryFn: () => api.getAskWritePolicy(orgId), enabled: !!orgId });
}

export function useSetAskWritePolicy(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ceiling: string) => api.setAskWritePolicy(orgId, ceiling),
    onSuccess: (ceiling) => {
      qc.setQueryData(aiKeys.askWritePolicy(orgId), ceiling);
      // The ceiling clamps every member's mode, so each workspace's capabilities are read again.
      void qc.invalidateQueries({ queryKey: ["ai", "capabilities"] });
    },
  });
}
