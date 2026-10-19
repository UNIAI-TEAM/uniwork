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

/**
 * Links of many messages in one room, in one request: a timeline asks once
 * for the messages it shows instead of once per message.
 */
export async function listChatRoomMessageLinks(
  workspaceId: string,
  roomId: string,
  messageIds: string[],
): Promise<ChatMessageLinkRecord[]> {
  if (messageIds.length === 0) return [];
  const params = new URLSearchParams({ message_ids: messageIds.join(",") });
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/message-links?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, LinkListSchema, { links: [] }, {
    endpoint: "GET .../chat/rooms/{roomID}/message-links",
  });
  return parsed.links ?? [];
}

const ChatRoomLinkedTaskSchema = z.object({
  id: z.string(),
  workspace_id: z.string().catch(""),
  number: z.number().catch(0),
  title: z.string().catch(""),
  status: z.string().catch(""),
  priority: z.string().catch(""),
  assignee_id: z.string().optional().catch(undefined),
  assignee_kind: z.string().optional().catch(undefined),
  assignee_name: z.string().optional().catch(undefined),
  due_date: z.string().optional().catch(undefined),
  linked_at: z.string().catch(""),
});

const ChatRoomLinkedTasksSchema = z.object({
  tasks: z.array(ChatRoomLinkedTaskSchema).catch([]),
  total: z.number().catch(0),
});

/** One task linked from a room's messages; `due_date` is YYYY-MM-DD. */
export type ChatRoomLinkedTask = z.infer<typeof ChatRoomLinkedTaskSchema>;

type ChatRoomLinkedTasks = z.infer<typeof ChatRoomLinkedTasksSchema>;

/** Tasks linked from this room, each once, most recently linked first (max 50). */
export async function listChatRoomLinkedTasks(
  workspaceId: string,
  roomId: string,
  limit?: number,
): Promise<ChatRoomLinkedTasks> {
  const query = limit ? `?limit=${limit}` : "";
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/linked-tasks${query}`,
  );
  return parseWithFallback(raw, ChatRoomLinkedTasksSchema, { tasks: [], total: 0 }, {
    endpoint: "GET .../chat/rooms/{roomID}/linked-tasks",
  });
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
