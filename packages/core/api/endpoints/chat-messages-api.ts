import { queryString, readMessage, readMessages, readStatusOk } from "./chat-endpoint-kit";
import { enc } from "./chat-schemas";
import type { ChatMessageRecord, ChatRequest } from "./chat-schemas";

/**
 * The chat message endpoints that carry JSON, over any transport:
 * chat-messages.ts binds them to the web's, the phone (apps/chat-mobile,
 * ADR 0011) to its own. The file, voice and document sends stay with each
 * host: their body is a multipart form of a platform file (a browser Blob, a
 * React Native `{uri}` part), which a JSON transport does not carry.
 */

/** Which of the sidebar's lists a search covers: Tin nhắn (DMs and groups) or a workspace's room and channels. */
export type ChatSearchScope = "messages" | "workspace";

/**
 * The levels a document send may grant the room (never `manage`: the sender
 * is already the document's ACL owner). The composer opens on "comment".
 */
export type ChatDocumentShareLevel = "view" | "comment" | "edit";

export interface ChatListMessagesOptions {
  cursor?: string;
  /** A message's cursor: the messages newer than it, oldest first (catch-up). */
  after?: string;
  before?: string;
  limit?: number;
  /** Default true on the server; false keeps the read pointer where it was. */
  mark_read?: boolean;
}

export interface ChatSendMessageInput {
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
  reminder?: { body: string; remind_at: string; repeat?: string };
  note?: { body: string; pin_to_top?: boolean };
  post?: { title: string; body: string; pin_to_top?: boolean };
  priority?: "important" | "urgent";
}

export function createChatMessagesApi(request: ChatRequest) {
  const ws = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}`;
  const room = (workspaceId: string, roomId: string) => `${ws(workspaceId)}/chat/rooms/${enc(roomId)}`;
  const msg = (workspaceId: string, roomId: string, messageId: string) =>
    `${room(workspaceId, roomId)}/messages/${enc(messageId)}`;
  // A read with no signal keeps the one-argument call the web transport has always had.
  const get = (path: string, signal?: AbortSignal) => (signal ? request(path, { signal }) : request(path));

  return {
    listChatRoomMessages(
      workspaceId: string,
      roomId: string,
      options: ChatListMessagesOptions = {},
      signal?: AbortSignal,
    ): Promise<ChatMessageRecord[]> {
      const qs = queryString({
        cursor: options.cursor,
        after: options.after,
        before: options.before,
        limit: options.limit || undefined,
        mark_read: options.mark_read === false ? "0" : undefined,
      });
      return readMessages(get(`${room(workspaceId, roomId)}/messages${qs}`, signal), "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages");
    },

    markChatRoomRead(workspaceId: string, roomId: string): Promise<boolean> {
      return readStatusOk(request(`${room(workspaceId, roomId)}/read`, { method: "POST", body: {} }), "POST .../chat/rooms/{roomID}/read");
    },

    /** Mutes (or unmutes) the room's notifications and push for the caller only. */
    setChatRoomMuted(workspaceId: string, roomId: string, muted: boolean): Promise<boolean> {
      return readStatusOk(
        request(`${room(workspaceId, roomId)}/mute`, { method: muted ? "POST" : "DELETE" }),
        "POST|DELETE .../chat/rooms/{roomID}/mute",
      );
    },

    getChatRoomMessage(workspaceId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> {
      return readMessage(request(msg(workspaceId, roomId, messageId)), "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}");
    },

    searchChatRoomMessages(
      workspaceId: string,
      roomId: string,
      options: { q: string; before?: string; limit?: number },
    ): Promise<ChatMessageRecord[]> {
      const qs = new URLSearchParams({ q: options.q });
      if (options.before) qs.set("before", options.before);
      if (options.limit) qs.set("limit", String(options.limit));
      return readMessages(
        request(`${room(workspaceId, roomId)}/messages/search?${qs.toString()}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/search",
      );
    },

    /** Text messages across every room of mine in one scope, newest first (the sidebar's search). */
    searchChatMessages(
      workspaceId: string,
      options: { q: string; scope: ChatSearchScope; before?: string; limit?: number },
    ): Promise<ChatMessageRecord[]> {
      const qs = new URLSearchParams({ q: options.q, scope: options.scope });
      if (options.before) qs.set("before", options.before);
      if (options.limit) qs.set("limit", String(options.limit));
      return readMessages(request(`${ws(workspaceId)}/chat/messages/search?${qs.toString()}`), "GET /api/v1/workspaces/{ws}/chat/messages/search");
    },

    listChatRoomMessagesAround(workspaceId: string, roomId: string, messageId: string, limit = 50): Promise<ChatMessageRecord[]> {
      return readMessages(
        request(`${room(workspaceId, roomId)}/messages/around/${enc(messageId)}${queryString({ limit: limit || undefined })}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/around/{messageID}",
      );
    },

    sendChatRoomMessage(workspaceId: string, roomId: string, input: ChatSendMessageInput): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(`${room(workspaceId, roomId)}/messages`, { method: "POST", body: input }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages",
      );
    },

    /** Converts the caller's own file attachment into a shared document in place: the same id comes back as kind "document". */
    shareChatMessageAsDocument(
      workspaceId: string,
      roomId: string,
      messageId: string,
      input: { share_level: ChatDocumentShareLevel; client_msg_id: string },
    ): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(`${msg(workspaceId, roomId, messageId)}/share-as-document`, { method: "POST", body: input }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/share-as-document",
      );
    },

    voteChatPollMessage(workspaceId: string, roomId: string, messageId: string, optionId: string): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(`${msg(workspaceId, roomId, messageId)}/poll/vote`, { method: "POST", body: { option_id: optionId } }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/poll/vote",
      );
    },

    toggleChatMessageReaction(workspaceId: string, roomId: string, messageId: string, emoji: string): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(`${msg(workspaceId, roomId, messageId)}/reactions`, { method: "POST", body: { emoji } }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/reactions",
      );
    },

    editChatRoomMessage(workspaceId: string, roomId: string, messageId: string, body: string): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(msg(workspaceId, roomId, messageId), { method: "PATCH", body: { body } }),
        "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },

    deleteChatRoomMessage(workspaceId: string, roomId: string, messageId: string): Promise<boolean> {
      return readStatusOk(
        request(msg(workspaceId, roomId, messageId), { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },

    /** Toggles the pin; the server answers with the message. */
    toggleChatMessagePin(workspaceId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> {
      return readMessage(
        request(`${msg(workspaceId, roomId, messageId)}/pin`, { method: "POST", body: {} }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/pin",
      );
    },

    listWorkspaceChatMessages(workspaceId: string, options: { before?: string; limit?: number } = {}): Promise<ChatMessageRecord[]> {
      const qs = queryString({ before: options.before, limit: options.limit || undefined });
      return readMessages(request(`${ws(workspaceId)}/chat/messages${qs}`), "GET /api/v1/workspaces/{ws}/chat/messages");
    },

    sendWorkspaceChatMessage(
      workspaceId: string,
      input: { body: string; client_msg_id?: string; reply_to_message_id?: string },
    ): Promise<ChatMessageRecord | null> {
      return readMessage(request(`${ws(workspaceId)}/chat/messages`, { method: "POST", body: input }), "POST /api/v1/workspaces/{ws}/chat/messages");
    },
  };
}
