import { z } from "zod";
import { TaskSchema, type Task } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";
import type { CreateTaskFromMessageInput } from "./chat-links";

const ChatFollowUpSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  room_id: z.string().optional().default(""),
  message_id: z.string(),
  user_id: z.string().optional().default(""),
  note: z.string().optional().default(""),
  due_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  created_by: z.string().optional().default(""),
  created_by_kind: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  room_kind: z.string().optional().default(""),
  room_name: z.string().optional().default(""),
  room_visibility: z.string().optional().default(""),
  peer_display_name: z.string().optional().default(""),
  message_body: z.string().optional().default(""),
  message_kind: z.string().optional().default(""),
  message_sender_id: z.string().optional().default(""),
  message_sender_name: z.string().optional().default(""),
});

const FollowUpEnvelopeSchema = z.object({
  follow_up: ChatFollowUpSchema.optional(),
});

const FollowUpListSchema = z.object({
  follow_ups: z.array(ChatFollowUpSchema).optional().default([]),
});

const TaskEnvelopeSchema = z.object({
  task: TaskSchema.optional(),
});

const OkSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
});

export type ChatFollowUpRecord = z.infer<typeof ChatFollowUpSchema>;

export type CreateChatFollowUpInput = {
  note?: string;
  due_at?: string | null;
};

export type PatchChatFollowUpInput = {
  note?: string;
  /** RFC3339 string to set; `null` clears; omit to leave unchanged. */
  due_at?: string | null;
  completed?: boolean;
};

export type ListChatFollowUpsParams = {
  include_completed?: boolean;
  limit?: number;
};

function isOk(parsed: { ok?: boolean; status?: string }): boolean {
  return parsed.ok === true || parsed.status === "ok";
}

export async function listChatFollowUps(
  workspaceId: string,
  params: ListChatFollowUpsParams = {},
): Promise<ChatFollowUpRecord[]> {
  const qs = new URLSearchParams();
  if (params.include_completed) qs.set("include_completed", "true");
  if (params.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/follow-ups${suffix}`);
  const parsed = parseWithFallback(raw, FollowUpListSchema, { follow_ups: [] }, {
    endpoint: "GET .../chat/follow-ups",
  });
  return parsed.follow_ups ?? [];
}

export async function createChatFollowUp(
  workspaceId: string,
  messageId: string,
  input: CreateChatFollowUpInput = {},
): Promise<ChatFollowUpRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/follow-ups`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, FollowUpEnvelopeSchema, { follow_up: undefined }, {
    endpoint: "POST .../chat/messages/{id}/follow-ups",
  });
  return parsed.follow_up ?? null;
}

export async function patchChatFollowUp(
  workspaceId: string,
  followUpId: string,
  input: PatchChatFollowUpInput,
): Promise<ChatFollowUpRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/follow-ups/${enc(followUpId)}`,
    { method: "PATCH", body: input },
  );
  const parsed = parseWithFallback(raw, FollowUpEnvelopeSchema, { follow_up: undefined }, {
    endpoint: "PATCH .../chat/follow-ups/{id}",
  });
  return parsed.follow_up ?? null;
}

export async function deleteChatFollowUp(
  workspaceId: string,
  followUpId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/follow-ups/${enc(followUpId)}`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, OkSchema, {}, {
    endpoint: "DELETE .../chat/follow-ups/{id}",
  });
  return isOk(parsed);
}

export async function convertChatFollowUpToTask(
  workspaceId: string,
  followUpId: string,
  input: CreateTaskFromMessageInput = {},
): Promise<Task | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/follow-ups/${enc(followUpId)}/task`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, TaskEnvelopeSchema, { task: undefined }, {
    endpoint: "POST .../chat/follow-ups/{id}/task",
  });
  return parsed.task ?? null;
}
