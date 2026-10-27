import { z } from "zod";
import {
  AiCapabilitiesSchema,
  AiConversationSchema,
  AiMessageSchema,
  AskModelsSchema,
  AiUsageSummarySchema,
  AskUniResponseSchema,
  ChatCatchUpResponseSchema,
  type AiCapabilities,
  type AiConversation,
  type AiMessage,
  type AiUsageSummary,
  type AskUniInput,
  type AskUniResponse,
  type ChatCatchUpInput,
  type ChatCatchUpResponse,
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
  models: [],
  auto_model: "",
  attachments: false,
  actions: { enabled: false, ceiling: "off", mode: "" },
  memory: { enabled: false, on: false },
};
const EMPTY_USAGE: AiUsageSummary = { from: "", to: "", rows: [] };
const EMPTY_CATCH_UP: ChatCatchUpResponse = {
  summary: "",
  highlights: [],
  highlight_items: [],
  action_items: [],
  message_count: 0,
  mode: "unread",
  since: "",
  usage: { input_tokens: 0, output_tokens: 0 },
};

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
export async function askUni(
  wsId: string,
  body: AskUniInput,
  opts: { signal?: AbortSignal } = {},
): Promise<AskUniResponse> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/ask`, { method: "POST", body, signal: opts.signal });
  const parsed = AskUniResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("ai_output_invalid");
  return parsed.data;
}

/** CatchUp degrades to empty brief on malformed payloads (UI shows empty state). */
export async function chatCatchUp(wsId: string, body: ChatCatchUpInput): Promise<ChatCatchUpResponse> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/chat/catch-up`, { method: "POST", body });
  return parseWithFallback(raw, ChatCatchUpResponseSchema, EMPTY_CATCH_UP, {
    endpoint: "POST /api/v1/workspaces/{id}/ai/chat/catch-up",
  });
}

export async function listAiConversations(wsId: string, q?: string): Promise<AiConversation[]> {
  const raw = await request(`/api/v1/workspaces/${wsId}/ai/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
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

/** The models an organization switched on for Ask UNI; a malformed answer reads as none. */
export async function getAskModels(orgId: string): Promise<string[]> {
  const raw = await request(`/api/v1/orgs/${orgId}/ai/ask-models`);
  return parseWithFallback<{ models: string[] }>(raw, AskModelsSchema, { models: [] }, {
    endpoint: "GET /api/v1/orgs/{id}/ai/ask-models",
  }).models;
}

export async function putAskModels(orgId: string, models: string[]): Promise<string[]> {
  const raw = await request(`/api/v1/orgs/${orgId}/ai/ask-models`, { method: "PUT", body: { models } });
  return parseWithFallback<{ models: string[] }>(raw, AskModelsSchema, { models }, {
    endpoint: "PUT /api/v1/orgs/{id}/ai/ask-models",
  }).models;
}

export interface AiFeedbackInput {
  rating: "up" | "down";
  reason?: string;
  note?: string;
}

export async function putAiFeedback(conversationId: string, messageId: string, body: AiFeedbackInput): Promise<void> {
  await request(`/api/v1/ai/conversations/${conversationId}/messages/${messageId}/feedback`, { method: "PUT", body });
}

export async function deleteAiFeedback(conversationId: string, messageId: string): Promise<void> {
  await request(`/api/v1/ai/conversations/${conversationId}/messages/${messageId}/feedback`, { method: "DELETE" });
}

/** Returns the renamed conversation, or null when the answer is malformed (the rename itself succeeded). */
export async function renameAiConversation(conversationId: string, title: string): Promise<AiConversation | null> {
  const raw = await request(`/api/v1/ai/conversations/${conversationId}`, { method: "PATCH", body: { title } });
  return parseWithFallback<AiConversation | null>(raw, AiConversationSchema, null, {
    endpoint: "PATCH /api/v1/ai/conversations/{id}",
  });
}
