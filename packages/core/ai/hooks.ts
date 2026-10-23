"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/ai";
import { ApiError } from "../api/http";
import type { AiMessage, AskUniInput, ChatCatchUpInput } from "../types/ai";
import { useAiPanelStore } from "./store";

export { useAiPanelStore };

/** Workspace-scoped keys carry the workspace id; usage carries its window. */
export const aiKeys = {
  all: ["ai"] as const,
  capabilities: (wsId: string) => ["ai", "capabilities", wsId] as const,
  // No q keeps the bare key, so list-prefix invalidations match every q variant.
  conversations: (wsId: string, q?: string) =>
    (q ? ["ai", "conversations", wsId, q] : ["ai", "conversations", wsId]) as readonly string[],
  messages: (conversationId: string) => ["ai", "messages", conversationId] as const,
  attachmentContent: (wsId: string, attachmentId: string) => ["ai", "attachment-content", wsId, attachmentId] as const,
  askModels: (orgId: string) => ["ai", "ask-models", orgId] as const,
  usages: () => ["ai", "usage"] as const,
  usage: (wsId: string, from?: string, to?: string) => ["ai", "usage", "workspace", wsId, from ?? "", to ?? ""] as const,
  orgUsage: (orgId: string, from?: string, to?: string) => ["ai", "usage", "org", orgId, from ?? "", to ?? ""] as const,
};

/** Cheap and rarely changing: the topbar button reads it on every screen. */
export function useAiCapabilities(wsId: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.capabilities(wsId),
    queryFn: () => api.getAiCapabilities(wsId),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useAiConversations(wsId: string, enabled = true, q?: string) {
  return useQuery({
    queryKey: aiKeys.conversations(wsId, q),
    queryFn: () => api.listAiConversations(wsId, q),
    // Keep rows through a search, but never another workspace's (key slot 2 is wsId).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === wsId ? prev : undefined),
    enabled,
  });
}

export function useAiMessages(conversationId: string | null) {
  return useQuery({
    queryKey: aiKeys.messages(conversationId ?? ""),
    queryFn: () => api.listAiMessages(conversationId ?? ""),
    enabled: !!conversationId,
  });
}

/**
 * Not optimistic: the answer is the whole point and cannot be predicted.
 * The caller waits; on success the conversation's messages, the list and
 * the quota line are refetched.
 */
export function useAskUni(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AskUniInput) => api.askUni(wsId, body),
    onSuccess: (res, vars) => {
      // The conversation keeps the focus it was asked with (the server does not
      // store it) even when the screen that asked is gone: a hook callback runs
      // after an unmount, one passed to mutate() does not.
      if (vars.focus) useAiPanelStore.getState().rememberFocus(res.conversation_id, vars.focus);
      // Keep the turn on screen while the refetch below runs.
      const userEcho: AiMessage = {
        id: `pending-${res.message.id}`,
        role: "user",
        content: vars.question,
        citations: [],
        notice: "",
        steps: [],
        followups: [],
        focus: null,
        mentions: [],
        model: "",
        attachments: [],
        file_notes: [],
        created_at: res.message.created_at,
      };
      qc.setQueryData<AiMessage[]>(aiKeys.messages(res.conversation_id), (old) => [...(old ?? []), userEcho, res.message]);
      void qc.invalidateQueries({ queryKey: aiKeys.messages(res.conversation_id) });
      void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
      void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
      void qc.invalidateQueries({ queryKey: aiKeys.usages() });
    },
    onError: (err, vars) => {
      // A conversation the server no longer knows (deleted in another tab) is
      // forgotten, so the next question starts a new one instead of failing again.
      if (vars.conversation_id && err instanceof ApiError && err.status === 404) {
        useAiPanelStore.getState().forgetConversation(vars.conversation_id);
      }
    },
  });
}

export function useChatCatchUp(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChatCatchUpInput) => api.chatCatchUp(wsId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.capabilities(wsId) });
      void qc.invalidateQueries({ queryKey: aiKeys.usages() });
    },
  });
}

export function useDeleteAiConversation(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api.deleteAiConversation(conversationId),
    onSuccess: (_r, conversationId) => {
      qc.removeQueries({ queryKey: aiKeys.messages(conversationId) });
      void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
    },
  });
}

export function useAiUsage(wsId: string, from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.usage(wsId, from, to),
    queryFn: () => api.getAiUsage(wsId, from, to),
    enabled,
  });
}

export function useAskModels(orgId: string) {
  return useQuery({ queryKey: aiKeys.askModels(orgId), queryFn: () => api.getAskModels(orgId), enabled: !!orgId });
}

export function useSetAskModels(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (models: string[]) => api.putAskModels(orgId, models),
    onSuccess: (models) => {
      // The answer is the enabled list: write it now so a quick second toggle builds on it, not on the stale read.
      qc.setQueryData(aiKeys.askModels(orgId), models);
      void qc.invalidateQueries({ queryKey: ["ai", "capabilities"] });
    },
  });
}

export function useSetAiFeedback() {
  return useMutation({
    mutationFn: (v: { conversationId: string; messageId: string; body: api.AiFeedbackInput }) =>
      api.putAiFeedback(v.conversationId, v.messageId, v.body),
  });
}

export function useClearAiFeedback() {
  return useMutation({
    mutationFn: (v: { conversationId: string; messageId: string }) => api.deleteAiFeedback(v.conversationId, v.messageId),
  });
}

export function useRenameAiConversation(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { conversationId: string; title: string }) => api.renameAiConversation(v.conversationId, v.title),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) }),
  });
}
