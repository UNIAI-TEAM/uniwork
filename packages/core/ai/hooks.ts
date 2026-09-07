"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/ai";
import type { AskUniInput } from "../types/ai";

export { useAiPanelStore } from "./store";

/** Workspace-scoped keys carry the workspace id; usage carries its window. */
export const aiKeys = {
  all: ["ai"] as const,
  capabilities: (wsId: string) => ["ai", "capabilities", wsId] as const,
  conversations: (wsId: string) => ["ai", "conversations", wsId] as const,
  messages: (conversationId: string) => ["ai", "messages", conversationId] as const,
  usages: () => ["ai", "usage"] as const,
  usage: (wsId: string, from?: string, to?: string) => ["ai", "usage", "workspace", wsId, from ?? "", to ?? ""] as const,
  orgUsage: (orgId: string, from?: string, to?: string) => ["ai", "usage", "org", orgId, from ?? "", to ?? ""] as const,
};

/** Cheap and rarely changing: the topbar button reads it on every screen. */
export function useAiCapabilities(wsId: string) {
  return useQuery({
    queryKey: aiKeys.capabilities(wsId),
    queryFn: () => api.getAiCapabilities(wsId),
    staleTime: 5 * 60_000,
  });
}

export function useAiConversations(wsId: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.conversations(wsId),
    queryFn: () => api.listAiConversations(wsId),
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
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: aiKeys.messages(res.conversation_id) });
      void qc.invalidateQueries({ queryKey: aiKeys.conversations(wsId) });
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
