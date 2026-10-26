"use client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/ai-memory";
import { errorCode } from "../api/http";
import type { AiMemoryProposal, AiMessage } from "../types/ai";
import { aiKeys } from "./hooks";

export const aiMemoryKeys = { all: (orgSlug: string) => ["ai-memory", orgSlug] as const };

/** Rows the server just answered replace the cached ones by id; nothing else in the conversation moves. */
function putRow(qc: QueryClient, conversationId: string, row: AiMemoryProposal) {
  // An unreadable answer (a row with no id) cannot be spliced in: read the answers again instead.
  if (row.id === "") return void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
  qc.setQueryData<AiMessage[]>(aiKeys.messages(conversationId), (old) =>
    old?.map((m) =>
      m.memory_proposals.some((p) => p.id === row.id) ? { ...m, memory_proposals: m.memory_proposals.map((p) => (p.id === row.id ? row : p)) } : m,
    ),
  );
}

// A refusal that carries the row (a row already decided) is the truth. Any other proposal_* refusal leaves the
// card stale, so the answers are read again; a refusal about the entry itself (full, duplicate, off) changes no row.
function putRowOfError(qc: QueryClient, conversationId: string, err: unknown) {
  const [row] = api.memoryProposalRowsOfError(err);
  if (row) return putRow(qc, conversationId, row);
  if (errorCode(err)?.startsWith("proposal_")) void qc.invalidateQueries({ queryKey: aiKeys.messages(conversationId) });
}

/** Not optimistic: the server decides, so every hook awaits it and repaints from its answer. `touchesList` rows add or remove an entry. */
function useRowMutation<V>(conversationId: string, orgSlug: string, touchesList: boolean, call: (v: V) => Promise<AiMemoryProposal>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (row) => {
      putRow(qc, conversationId, row);
      if (touchesList) void qc.invalidateQueries({ queryKey: aiMemoryKeys.all(orgSlug) });
    },
    onError: (err) => putRowOfError(qc, conversationId, err),
  });
}

export const useApplyAiMemoryProposal = (conversationId: string, orgSlug: string) =>
  useRowMutation(conversationId, orgSlug, true, (id: string) => api.applyAiMemoryProposal(id));
export const useRejectAiMemoryProposal = (conversationId: string, orgSlug: string) =>
  useRowMutation(conversationId, orgSlug, false, (id: string) => api.rejectAiMemoryProposal(id));
export const useUndoAiMemoryProposal = (conversationId: string, orgSlug: string) =>
  useRowMutation(conversationId, orgSlug, true, (id: string) => api.undoAiMemoryProposal(id));
export const useEditAiMemoryProposal = (conversationId: string, orgSlug: string) =>
  useRowMutation(conversationId, orgSlug, false, (v: { id: string; body: { kind?: string; text?: string } }) => api.editAiMemoryProposal(v.id, v.body));

export function useAiMemory(orgSlug: string) {
  return useQuery({ queryKey: aiMemoryKeys.all(orgSlug), queryFn: () => api.listAiMemory(orgSlug), enabled: !!orgSlug });
}

/** The list is small and server-ordered, so every write reads it again rather than patching it. */
function useListMutation<V, R>(orgSlug: string, call: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: () => void qc.invalidateQueries({ queryKey: aiMemoryKeys.all(orgSlug) }) });
}

export const useCreateAiMemory = (orgSlug: string) =>
  useListMutation(orgSlug, (body: { kind: string; text: string }) => api.createAiMemory(orgSlug, body));
export const useUpdateAiMemory = (orgSlug: string) =>
  useListMutation(orgSlug, (v: { id: string; body: { kind?: string; text?: string } }) => api.updateAiMemory(orgSlug, v.id, v.body));
export const useDeleteAiMemory = (orgSlug: string) => useListMutation(orgSlug, (id: string) => api.deleteAiMemory(orgSlug, id));
export const useClearAiMemory = (orgSlug: string) => useListMutation(orgSlug, () => api.clearAiMemory(orgSlug));
export const useImportAiMemory = (orgSlug: string) =>
  useListMutation(orgSlug, (entries: { kind: string; text: string }[]) => api.importAiMemory(orgSlug, entries));

/** Splitting saves nothing, so the list stays as it is. */
export function useSplitAiMemoryImport(orgSlug: string) {
  return useMutation({ mutationFn: (text: string) => api.splitAiMemoryImport(orgSlug, text) });
}

/** The switch lives on the person, so capabilities and every organization's list (`on`) are read again. */
export function useSetAskUniMemory(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.setAskUniMemory(enabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
      void qc.invalidateQueries({ queryKey: ["ai-memory"] });
    },
  });
}
