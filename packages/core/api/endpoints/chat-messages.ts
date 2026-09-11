import { z } from "zod";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";
import { ChatMessageEnvelopeSchema, ChatMessagesListSchema, enc } from "./chat-schemas";
import type { ChatMessageRecord } from "./chat-schemas";

export async function listChatRoomMessages(
  workspaceId: string,
  roomId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages${qs ? `?${qs}` : ""}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages",
  });
  return parsed.messages ?? [];
}

export async function getChatRoomMessage(
  workspaceId: string,
  roomId: string,
  messageId: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}`,
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
  });
  return parsed.message ?? null;
}

export async function searchChatRoomMessages(
  workspaceId: string,
  roomId: string,
  options: { q: string; before?: string; limit?: number },
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  params.set("q", options.q);
  if (options.before) params.set("before", options.before);
  if (options.limit) params.set("limit", String(options.limit));
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/search?${params.toString()}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/search",
  });
  return parsed.messages ?? [];
}

export async function listChatRoomMessagesAround(
  workspaceId: string,
  roomId: string,
  messageId: string,
  limit = 50,
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/around/${enc(messageId)}${qs ? `?${qs}` : ""}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/around/{messageID}",
  });
  return parsed.messages ?? [];
}

export async function sendChatRoomMessage(
  workspaceId: string,
  roomId: string,
  input: {
    body?: string;
    client_msg_id?: string;
    reply_to_message_id?: string;
    poll?: {
      question: string;
      options: string[];
      settings?: {
        deadline_at?: string | null;
        pin_to_top?: boolean;
        allow_multiple?: boolean;
        allow_add_options?: boolean;
        hide_results_until_vote?: boolean;
        hide_voters?: boolean;
      };
    };
    reminder?: {
      body: string;
      remind_at: string;
      repeat?: string;
    };
    note?: {
      body: string;
      pin_to_top?: boolean;
    };
    post?: {
      title: string;
      body: string;
      pin_to_top?: boolean;
    };
    priority?: "important" | "urgent";
  },
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages`,
    { method: "POST", body: input },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages",
  });
  return parsed.message ?? null;
}

export async function sendChatVoiceMessage(
  workspaceId: string,
  roomId: string,
  input: {
    file: Blob;
    duration_ms: number;
    client_msg_id: string;
    reply_to_message_id?: string;
  },
): Promise<ChatMessageRecord | null> {
  const form = new FormData();
  form.set("file", input.file, `voice.${input.file.type.includes("ogg") ? "ogg" : input.file.type.includes("mp4") ? "m4a" : "webm"}`);
  form.set("duration_ms", String(input.duration_ms));
  form.set("client_msg_id", input.client_msg_id);
  if (input.reply_to_message_id) {
    form.set("reply_to_message_id", input.reply_to_message_id);
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/voice`,
    { method: "POST", body: form },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/voice",
  });
  return parsed.message ?? null;
}

export function loadChatVoiceBlob(
  workspaceId: string,
  roomId: string,
  messageId: string,
): Promise<Blob> {
  return requestBlob(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/voice`,
  );
}

export async function sendChatFileMessage(
  workspaceId: string,
  roomId: string,
  input: {
    file: Blob;
    filename: string;
    client_msg_id: string;
    reply_to_message_id?: string;
  },
): Promise<ChatMessageRecord | null> {
  const form = new FormData();
  form.set("file", input.file, input.filename);
  form.set("client_msg_id", input.client_msg_id);
  if (input.reply_to_message_id) {
    form.set("reply_to_message_id", input.reply_to_message_id);
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/file`,
    { method: "POST", body: form },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/file",
  });
  return parsed.message ?? null;
}

export function loadChatFileBlob(
  workspaceId: string,
  roomId: string,
  messageId: string,
): Promise<Blob> {
  return requestBlob(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/file`,
  );
}

export async function voteChatPollMessage(
  workspaceId: string,
  roomId: string,
  messageId: string,
  optionId: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/poll/vote`,
    { method: "POST", body: { option_id: optionId } },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/poll/vote",
  });
  return parsed.message ?? null;
}

export async function toggleChatMessageReaction(
  workspaceId: string,
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/reactions`,
    { method: "POST", body: { emoji } },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/reactions",
  });
  return parsed.message ?? null;
}

export async function editChatRoomMessage(
  workspaceId: string,
  roomId: string,
  messageId: string,
  body: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}`,
    { method: "PATCH", body: { body } },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
  });
  return parsed.message ?? null;
}

export async function deleteChatRoomMessage(
  workspaceId: string,
  roomId: string,
  messageId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
  });
  return parsed.status === "ok";
}

export async function toggleChatMessagePin(
  workspaceId: string,
  roomId: string,
  messageId: string,
): Promise<ChatMessageRecord | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages/${enc(messageId)}/pin`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/pin",
  });
  return parsed.message ?? null;
}

export async function listWorkspaceChatMessages(
  workspaceId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessageRecord[]> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages${qs ? `?${qs}` : ""}`,
  );
  const parsed = parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/messages",
  });
  return parsed.messages ?? [];
}

export async function sendWorkspaceChatMessage(
  workspaceId: string,
  input: { body: string; client_msg_id?: string; reply_to_message_id?: string },
): Promise<ChatMessageRecord | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/messages`, {
    method: "POST",
    body: input,
  });
  const parsed = parseWithFallback(raw, ChatMessageEnvelopeSchema, { message: undefined }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/messages",
  });
  return parsed.message ?? null;
}
