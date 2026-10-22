import { request } from "../http";
import { readMessage } from "./chat-endpoint-kit";
import { createChatMessagesApi, type ChatDocumentShareLevel } from "./chat-messages-api";
import { enc } from "./chat-schemas";
import type { ChatMessageRecord } from "./chat-schemas";

export type { ChatDocumentShareLevel, ChatSearchScope } from "./chat-messages-api";

// The web's binding of the shared chat message endpoints (chat-messages-api.ts) to its transport.
export const {
  listChatRoomMessages,
  markChatRoomRead,
  setChatRoomMuted,
  getChatRoomMessage,
  searchChatRoomMessages,
  searchChatMessages,
  listChatRoomMessagesAround,
  sendChatRoomMessage,
  shareChatMessageAsDocument,
  voteChatPollMessage,
  toggleChatMessageReaction,
  editChatRoomMessage,
  deleteChatRoomMessage,
  toggleChatMessagePin,
  listWorkspaceChatMessages,
  sendWorkspaceChatMessage,
} = createChatMessagesApi((path, opts) => request(path, opts));

// The multipart sends below carry a browser Blob, so they stay on the web's own transport.
const roomMessages = (workspaceId: string, roomId: string) =>
  `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/messages`;

function voiceExtension(type: string): string {
  if (type.includes("ogg")) return "ogg";
  return type.includes("mp4") ? "m4a" : "webm";
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
  form.set("file", input.file, `voice.${voiceExtension(input.file.type)}`);
  form.set("duration_ms", String(input.duration_ms));
  form.set("client_msg_id", input.client_msg_id);
  if (input.reply_to_message_id) {
    form.set("reply_to_message_id", input.reply_to_message_id);
  }
  return readMessage(
    request(`${roomMessages(workspaceId, roomId)}/voice`, { method: "POST", body: form }),
    "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/voice",
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
  return readMessage(
    request(`${roomMessages(workspaceId, roomId)}/file`, { method: "POST", body: form }),
    "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/file",
  );
}

/**
 * Sending a file as a document shares it with the room's members at
 * `share_level`; a sibling route of /messages/file, never a field on it.
 */
export async function sendChatDocumentMessage(
  workspaceId: string,
  roomId: string,
  input: {
    file: Blob;
    filename: string;
    share_level: ChatDocumentShareLevel;
    client_msg_id: string;
    reply_to_message_id?: string;
  },
): Promise<ChatMessageRecord | null> {
  const form = new FormData();
  form.set("file", input.file, input.filename);
  form.set("share_level", input.share_level);
  form.set("client_msg_id", input.client_msg_id);
  if (input.reply_to_message_id) {
    form.set("reply_to_message_id", input.reply_to_message_id);
  }
  return readMessage(
    request(`${roomMessages(workspaceId, roomId)}/document`, { method: "POST", body: form }),
    "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/document",
  );
}
