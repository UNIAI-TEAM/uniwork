import { z } from "zod";
import { TaskSchema, type Task } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

const ChatMessageLinkSchema = z.object({
  id: z.string(),
  message_id: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  relation: z.string().optional().default(""),
  created_by: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
});

const LinkEnvelopeSchema = z.object({
  link: ChatMessageLinkSchema.optional(),
});

const LinkListSchema = z.object({
  links: z.array(ChatMessageLinkSchema).optional().default([]),
});

const TaskEnvelopeSchema = z.object({
  task: TaskSchema.optional(),
});

const OkSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
});

export type ChatMessageLinkRecord = z.infer<typeof ChatMessageLinkSchema>;

export type CreateTaskFromMessageInput = {
  title?: string;
  project_id?: string;
  assignee_id?: string;
  assignee_kind?: string;
  due_date?: string;
  sync_thread?: boolean;
  priority?: string;
};

export type CreateChatMessageLinkInput = {
  target_type: string;
  target_id: string;
};

export type SyncThreadTaskInput = {
  task_id: string;
  direction?: string;
};

function isOk(parsed: { ok?: boolean; status?: string }): boolean {
  return parsed.ok === true || parsed.status === "ok";
}

export async function createTaskFromChatMessage(
  workspaceId: string,
  messageId: string,
  input: CreateTaskFromMessageInput = {},
): Promise<Task | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/tasks`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, TaskEnvelopeSchema, { task: undefined }, {
    endpoint: "POST .../chat/messages/{id}/tasks",
  });
  return parsed.task ?? null;
}

export async function listChatMessageLinks(
  workspaceId: string,
  messageId: string,
): Promise<ChatMessageLinkRecord[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/links`,
  );
  const parsed = parseWithFallback(raw, LinkListSchema, { links: [] }, {
    endpoint: "GET .../chat/messages/{id}/links",
  });
  return parsed.links ?? [];
}

export async function createChatMessageLink(
  workspaceId: string,
  messageId: string,
  input: CreateChatMessageLinkInput,
): Promise<ChatMessageLinkRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/links`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, LinkEnvelopeSchema, { link: undefined }, {
    endpoint: "POST .../chat/messages/{id}/links",
  });
  return parsed.link ?? null;
}

export async function deleteChatMessageLink(
  workspaceId: string,
  messageId: string,
  linkId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/links/${enc(linkId)}`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, OkSchema, {}, {
    endpoint: "DELETE .../chat/messages/{id}/links/{linkID}",
  });
  return isOk(parsed);
}

export async function syncChatThreadTask(
  workspaceId: string,
  threadRootId: string,
  input: SyncThreadTaskInput,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads/${enc(threadRootId)}/task-sync`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, OkSchema, {}, {
    endpoint: "POST .../chat/threads/{id}/task-sync",
  });
  return isOk(parsed);
}

export async function unsyncChatThreadTask(
  workspaceId: string,
  threadRootId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/threads/${enc(threadRootId)}/task-sync`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, OkSchema, {}, {
    endpoint: "DELETE .../chat/threads/{id}/task-sync",
  });
  return isOk(parsed);
}
