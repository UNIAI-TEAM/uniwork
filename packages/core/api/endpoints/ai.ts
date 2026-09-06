import { z } from "zod";
import {
  AiCapabilitiesSchema,
  AiConversationSchema,
  AiMessageSchema,
  AiUsageSummarySchema,
  AskUniResponseSchema,
  type AiCapabilities,
  type AiConversation,
  type AiMessage,
  type AiUsageSummary,
  type AskUniInput,
  type AskUniResponse,
} from "../../types/ai";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ConversationsResponse = z.object({ conversations: z.array(AiConversationSchema) });
const MessagesResponse = z.object({ messages: z.array(AiMessageSchema) });

const DISABLED: AiCapabilities = {
  enabled: false,
  ask_uni: false,
  meeting_summary: false,
  quota: { used_tokens: 0, limit_tokens: null },
};
const EMPTY_USAGE: AiUsageSummary = { from: "", to: "", rows: [] };

export async function getAiCapabilities(wsId: string): Promise<AiCapabilities> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/capabilities`);
  return parseWithFallback<AiCapabilities>(raw, AiCapabilitiesSchema, DISABLED, {
    endpoint: "GET /api/v1/workspaces/{id}/ai/capabilities",
  });
}

/**
 * The one endpoint here that does not degrade silently: a malformed answer
 * throws, because rendering an empty assistant turn would read as "UNI said
 * nothing" — the panel shows the error instead.
 */
export async function askUni(wsId: string, body: AskUniInput): Promise<AskUniResponse> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/ask`, { method: "POST", body });
  const parsed = AskUniResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("ai_output_invalid");
  return parsed.data;
}

export async function listAiConversations(wsId: string): Promise<AiConversation[]> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/conversations`);
  return parseWithFallback<{ conversations: AiConversation[] }>(
    raw,
    ConversationsResponse,
    { conversations: [] },
    { endpoint: "GET /api/v1/workspaces/{id}/ai/conversations" },
  ).conversations;
}

export async function listAiMessages(conversationId: string): Promise<AiMessage[]> {
  const raw = await request(`/api/v1/ai/conversations/${conversationId}/messages`);
  return parseWithFallback<{ messages: AiMessage[] }>(raw, MessagesResponse, { messages: [] }, {
    endpoint: "GET /api/v1/ai/conversations/{id}/messages",
  }).messages;
}

export async function deleteAiConversation(conversationId: string): Promise<void> {
  await request(`/api/v1/ai/conversations/${conversationId}`, { method: "DELETE" });
}

function usageQuery(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getAiUsage(wsId: string, from?: string, to?: string): Promise<AiUsageSummary> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/usage${usageQuery(from, to)}`);
  return parseWithFallback<AiUsageSummary>(raw, AiUsageSummarySchema, EMPTY_USAGE, {
    endpoint: "GET /api/v1/workspaces/{id}/ai/usage",
  });
}

export async function getOrgAiUsage(orgId: string, from?: string, to?: string): Promise<AiUsageSummary> {
  const raw = await request(`/api/v1/orgs/${orgId}/ai/usage${usageQuery(from, to)}`);
  return parseWithFallback<AiUsageSummary>(raw, AiUsageSummarySchema, EMPTY_USAGE, {
    endpoint: "GET /api/v1/orgs/{id}/ai/usage",
  });
}
