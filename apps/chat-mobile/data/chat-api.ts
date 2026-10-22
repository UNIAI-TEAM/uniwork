// The chat endpoints the mobile chat tab calls. Rooms, messages, threads,
// channels, media, forward, call signalling, users and presence are core's
// own factories (@uniwork/core/api/endpoints/chat-*-api) bound to the app's
// transport, so the web and the phone share one implementation of each path,
// schema and fallback. What is left here is the phone's own: the multipart
// sends (a React Native `{uri}` file part, not a browser Blob), the answers
// only the phone reads (outgoing calls, recording-active as a boolean), and
// the smaller readers of follow-ups, message links, tasks and workspace
// members, copied from packages/core/api/endpoints/{chat-follow-ups,
// chat-links,tasks,workspaces}.ts (ADR 0011: those reach the web transport and
// read the web's full task record). chat-api.test.ts holds a malformed-response
// case for every method.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { createChatChannelsApi } from "@uniwork/core/api/endpoints/chat-channels-api";
import { createChatForwardApi } from "@uniwork/core/api/endpoints/chat-forward-api";
import { createChatMediaApi } from "@uniwork/core/api/endpoints/chat-media-api";
import { createChatMessagesApi } from "@uniwork/core/api/endpoints/chat-messages-api";
import { createChatPresenceApi } from "@uniwork/core/api/endpoints/chat-presence-api";
import { createChatRoomsApi } from "@uniwork/core/api/endpoints/chat-rooms-api";
import { createChatThreadsApi } from "@uniwork/core/api/endpoints/chat-threads-api";
import { createChatUsersApi } from "@uniwork/core/api/endpoints/chat-users-api";
import { createChatVoiceApi } from "@uniwork/core/api/endpoints/chat-voice-api";
import {
  ChatMessageEnvelopeSchema,
  enc,
  type ChatGifRecord,
  type ChatMessageRecord,
  type ChatRequest,
  type ChatRoomMemberRecord,
  type ChatRoomRecord,
  type ChatRoomSharedSummary,
  type ChatUnreadSummary,
  type ChatVoiceToken,
  type PendingChatVoiceInvite,
} from "@uniwork/core/api/endpoints/chat-schemas";
import { ChatCatchUpResponseSchema, type ChatCatchUpResponse } from "@uniwork/core/types/ai";
import type { z } from "zod";
import { api } from "./api";
import {
  ActiveRecordingSchema,
  FollowUpEnvelopeSchema,
  FollowUpListSchema,
  LinkListSchema,
  OkSchema,
  OutgoingVoiceCallsSchema,
  StatusSchema,
  TaskEnvelopeSchema,
  WorkspaceMembersSchema,
  type ChatFollowUp,
  type ChatMessageLink,
  type ChatTask,
  type OutgoingVoiceCall,
  type WorkspaceMemberRecord,
} from "./chat-api-schemas";
import type { PendingFile } from "@/lib/send-pipeline";
import { relabelErasedAccounts } from "@/lib/erased-account";
import { i18n } from "@/lib/i18n/singleton";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const ROOM_MESSAGE_LINKS_BATCH = 200;

function query(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    p.set(key, String(value));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const json = (method: string, body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

/** The app's transport as core's endpoint factories take it: a JSON body is serialised here. */
export function toChatRequest(request: Request): ChatRequest {
  return (path, opts = {}) =>
    request(path, {
      ...(opts.method ? { method: opts.method } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
}

/** The parts of a multipart send; React Native's FormData uploads a `{ uri, name, type }` part from disk. */
function multipart(file: { uri: string; name: string; type: string }, fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  // RN's FormData takes the file part as a plain object; the DOM typing only knows Blob.
  form.append("file", file as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
  return form;
}

export function createChatApi(send: Request) {
  // An erased account's name reads in the app's language on every screen (lib/erased-account.ts).
  const request: Request = async (path, init) => relabelErasedAccounts(await send(path, init), i18n.t("mobile.account.erased_name"));
  const core = toChatRequest(request);
  const rooms = createChatRoomsApi(core);
  const messages = createChatMessagesApi(core);
  const threads = createChatThreadsApi(core);
  const channels = createChatChannelsApi(core);
  const media = createChatMediaApi(core);
  const forward = createChatForwardApi(core);
  const voice = createChatVoiceApi(core);
  const users = createChatUsersApi(core);
  const presence = createChatPresenceApi(core);
  const ws = (wsId: string) => `/api/v1/workspaces/${enc(wsId)}`;
  const room = (wsId: string, roomId: string) => `${ws(wsId)}/chat/rooms/${enc(roomId)}`;

  async function message(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord | null> {
    return parseWithFallback(await raw, ChatMessageEnvelopeSchema, { message: undefined }, { endpoint }).message ?? null;
  }
  async function task(raw: Promise<unknown>, endpoint: string): Promise<ChatTask | null> {
    return parseWithFallback<z.infer<typeof TaskEnvelopeSchema>>(await raw, TaskEnvelopeSchema, {}, { endpoint }).task ?? null;
  }
  async function followUp(raw: Promise<unknown>, endpoint: string): Promise<ChatFollowUp | null> {
    const parsed = parseWithFallback<z.infer<typeof FollowUpEnvelopeSchema>>(await raw, FollowUpEnvelopeSchema, {}, { endpoint });
    return parsed.follow_up ?? null;
  }

  return {
    listRooms: (wsId: string, signal?: AbortSignal): Promise<ChatRoomRecord[]> => rooms.listChatRooms(wsId, signal),
    /** Unread counts per workspace, for the workspace switch and the pill's badge. */
    unreadSummary: (signal?: AbortSignal): Promise<ChatUnreadSummary> => rooms.getChatUnreadSummary(signal),
    /** UNI's brief of one room's unread messages ("Bắt kịp nhanh"); null when the answer is not a brief. */
    async catchUp(wsId: string, body: { room_id: string; locale?: string; since?: string }): Promise<ChatCatchUpResponse | null> {
      const raw = await request(`${ws(wsId)}/ai/chat/catch-up`, json("POST", body));
      return parseWithFallback<ChatCatchUpResponse | null>(raw, ChatCatchUpResponseSchema, null, {
        endpoint: "POST /api/v1/workspaces/{ws}/ai/chat/catch-up",
      });
    },
    resolveDMRoom: (wsId: string, userId: string) => rooms.resolveDMRoom(wsId, userId),
    leaveRoom: (wsId: string, roomId: string) => rooms.leaveChatRoom(wsId, roomId),
    listRoomMembers: (wsId: string, roomId: string): Promise<ChatRoomMemberRecord[]> => rooms.listChatRoomMembers(wsId, roomId),
    createGroup: (wsId: string, input: { name: string; member_user_ids: string[] }) => rooms.createChatGroup(wsId, input),
    /** The group after the invite, or null. */
    inviteGroupMembers: (wsId: string, roomId: string, memberUserIds: string[]) =>
      rooms.inviteChatGroupMembers(wsId, roomId, memberUserIds),
    setRoomMuted: (wsId: string, roomId: string, muted: boolean) => messages.setChatRoomMuted(wsId, roomId, muted),
    markRoomRead: (wsId: string, roomId: string) => messages.markChatRoomRead(wsId, roomId),
    listMessages(
      wsId: string,
      roomId: string,
      options: { cursor?: string; before?: string; after?: string; limit?: number; markRead?: boolean } = {},
      signal?: AbortSignal,
    ) {
      const { markRead, ...page } = options;
      return messages.listChatRoomMessages(wsId, roomId, { ...page, mark_read: markRead }, signal);
    },
    listMessagesAround: (wsId: string, roomId: string, messageId: string, limit = 50) =>
      messages.listChatRoomMessagesAround(wsId, roomId, messageId, limit),
    getMessage: (wsId: string, roomId: string, messageId: string) => messages.getChatRoomMessage(wsId, roomId, messageId),
    searchMessages: (wsId: string, roomId: string, q: string, limit = 30) => messages.searchChatRoomMessages(wsId, roomId, { q, limit }),
    /** Text, or a reminder (`reminder` and no body, as the web's reminder dialog sends it). */
    sendMessage(
      wsId: string,
      roomId: string,
      input: {
        body?: string;
        client_msg_id: string;
        reply_to_message_id?: string;
        reminder?: { body: string; remind_at: string; repeat?: string };
      },
    ) {
      return messages.sendChatRoomMessage(wsId, roomId, input);
    },
    sendFileMessage(wsId: string, roomId: string, input: { file: PendingFile; client_msg_id: string; reply_to_message_id?: string }) {
      const file = { uri: input.file.uri, name: input.file.name, type: input.file.mimeType ?? "application/octet-stream" };
      const form = multipart(file, { client_msg_id: input.client_msg_id, reply_to_message_id: input.reply_to_message_id });
      return message(
        request(`${room(wsId, roomId)}/messages/file`, { method: "POST", body: form }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/file",
      );
    },
    toggleReaction: (wsId: string, roomId: string, messageId: string, emoji: string) =>
      messages.toggleChatMessageReaction(wsId, roomId, messageId, emoji),
    editMessage: (wsId: string, roomId: string, messageId: string, body: string) =>
      messages.editChatRoomMessage(wsId, roomId, messageId, body),
    deleteMessage: (wsId: string, roomId: string, messageId: string) => messages.deleteChatRoomMessage(wsId, roomId, messageId),
    listThreadMessages: (wsId: string, roomId: string, rootId: string, options: { cursor?: string; before?: string; limit?: number } = {}) =>
      threads.listChatThreadMessages(wsId, roomId, rootId, options),
    sendThreadMessage: (wsId: string, roomId: string, rootId: string, input: { body: string; client_msg_id: string }) =>
      threads.sendChatThreadMessage(wsId, roomId, rootId, input),
    markThreadRead: (wsId: string, rootId: string): Promise<string | null> => threads.markChatThreadRead(wsId, rootId),
    listChannels: (wsId: string, scope: "mine" | "discoverable"): Promise<ChatRoomRecord[]> => channels.listChatChannels(wsId, { scope }),
    joinChannel: (wsId: string, roomId: string) => channels.joinChatChannel(wsId, roomId),
    /** Nicknames keyed by the upper-cased user id; one drifted entry is dropped alone. */
    listNicknames: (wsId: string): Promise<Record<string, string>> => users.listChatNicknames(wsId),
    async listWorkspaceMembers(wsId: string): Promise<WorkspaceMemberRecord[]> {
      const raw = await request(`${ws(wsId)}/members`);
      return parseWithFallback(raw, WorkspaceMembersSchema, { members: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/members" }).members;
    },
    /** One online heartbeat; the workspace's online user ids, or null when the answer carries none. */
    beatPresence: (wsId: string, visible: boolean): Promise<string[] | null> => presence.beatChatPresence(wsId, visible),
    async leavePresence(wsId: string): Promise<boolean> {
      const raw = await request(`${ws(wsId)}/chat/presence`, json("POST", { state: "offline" }));
      return parseWithFallback(raw, StatusSchema, { status: "" }, { endpoint: "POST /api/v1/workspaces/{ws}/chat/presence" }).status === "ok";
    },
    /** What the room has shared, for the info screen. */
    sharedSummary: (wsId: string, roomId: string, signal?: AbortSignal): Promise<ChatRoomSharedSummary> =>
      media.getChatRoomSharedSummary(wsId, roomId, signal),
    /** Whether this call is being recorded (the web reads the whole recording; the phone only shows the badge). */
    async callRecordingActive(wsId: string, roomId: string, callId: string): Promise<boolean> {
      const raw = await request(`${room(wsId, roomId)}/voice/recording/active${query({ call_id: callId })}`);
      const parsed = parseWithFallback<z.infer<typeof ActiveRecordingSchema>>(raw, ActiveRecordingSchema, {}, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recording/active",
      });
      return Boolean(parsed.recording?.id);
    },
    /** Toggles the pin; the server answers with the message. */
    togglePin: (wsId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> =>
      messages.toggleChatMessagePin(wsId, roomId, messageId),
    /** Writes a copy in each target room; how many copies were written. */
    async forwardMessage(wsId: string, messageId: string, targetRoomIds: string[]): Promise<number> {
      return (await forward.forwardChatMessage(wsId, messageId, { target_room_ids: targetRoomIds })).length;
    },
    signalTyping: (wsId: string, roomId: string) => voice.signalChatTyping(wsId, roomId),
    listPendingVoiceInvites: (wsId: string): Promise<PendingChatVoiceInvite[]> => voice.listPendingChatVoiceInvites(wsId),
    /** The calls this person started that are still live, answered or not (call-engine.ts › reconcile). */
    async listOutgoingVoiceCalls(wsId: string): Promise<OutgoingVoiceCall[]> {
      const raw = await request(`${ws(wsId)}/chat/voice/pending`);
      return parseWithFallback(raw, OutgoingVoiceCallsSchema, { outgoing: [] }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/voice/pending",
      }).outgoing;
    },
    /** The LiveKit url and token of a call; null when the answer carries none. */
    mintVoiceToken: (roomId: string, callId: string): Promise<ChatVoiceToken | null> => voice.mintChatVoiceToken(roomId, callId),
    signalVoiceInvite: (wsId: string, roomId: string, callId: string, video: boolean) => voice.signalChatVoiceInvite(wsId, roomId, callId, video),
    signalVoiceAccept: (wsId: string, roomId: string, callId: string) => voice.signalChatVoiceAccept(wsId, roomId, callId),
    signalVoiceHangup: (wsId: string, roomId: string, callId: string, durationSeconds?: number) =>
      voice.signalChatVoiceHangup(wsId, roomId, callId, durationSeconds),
    votePoll: (wsId: string, roomId: string, messageId: string, optionId: string) =>
      messages.voteChatPollMessage(wsId, roomId, messageId, optionId),
    /** A recorded clip from disk: expo-audio writes AAC in MPEG-4, which the server takes as audio/mp4. */
    sendVoiceMessage(wsId: string, roomId: string, input: { uri: string; duration_ms: number; client_msg_id: string; reply_to_message_id?: string }) {
      const form = multipart(
        { uri: input.uri, name: "voice.m4a", type: "audio/mp4" },
        { duration_ms: String(input.duration_ms), client_msg_id: input.client_msg_id, reply_to_message_id: input.reply_to_message_id },
      );
      return message(
        request(`${room(wsId, roomId)}/messages/voice`, { method: "POST", body: form }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/voice",
      );
    },
    /** Stickers or GIFs: trending, or a search when there is a query. */
    listExpressions(wsId: string, kind: "stickers" | "gifs", q: string, limit = 48): Promise<ChatGifRecord[]> {
      const term = q.trim();
      if (kind === "gifs") return term ? media.searchChatGifs(wsId, term, limit) : media.listTrendingChatGifs(wsId, limit);
      return term ? media.searchChatStickers(wsId, term, limit) : media.listTrendingChatStickers(wsId, limit);
    },
    async listFollowUps(wsId: string, includeCompleted = false): Promise<ChatFollowUp[]> {
      const raw = await request(`${ws(wsId)}/chat/follow-ups${query({ include_completed: includeCompleted ? "true" : undefined })}`);
      return parseWithFallback(raw, FollowUpListSchema, { follow_ups: [] }, { endpoint: "GET .../chat/follow-ups" }).follow_ups;
    },
    createFollowUp(wsId: string, messageId: string, input: { note?: string; due_at?: string | null } = {}) {
      return followUp(
        request(`${ws(wsId)}/chat/messages/${enc(messageId)}/follow-ups`, json("POST", input)),
        "POST .../chat/messages/{id}/follow-ups",
      );
    },
    patchFollowUp(wsId: string, followUpId: string, input: { note?: string; due_at?: string | null; completed?: boolean }) {
      return followUp(request(`${ws(wsId)}/chat/follow-ups/${enc(followUpId)}`, json("PATCH", input)), "PATCH .../chat/follow-ups/{id}");
    },
    async deleteFollowUp(wsId: string, followUpId: string): Promise<boolean> {
      const raw = await request(`${ws(wsId)}/chat/follow-ups/${enc(followUpId)}`, { method: "DELETE" });
      const parsed = parseWithFallback<z.infer<typeof OkSchema>>(raw, OkSchema, {}, { endpoint: "DELETE .../chat/follow-ups/{id}" });
      return parsed.ok === true || parsed.status === "ok";
    },
    convertFollowUpToTask(wsId: string, followUpId: string) {
      return task(request(`${ws(wsId)}/chat/follow-ups/${enc(followUpId)}/task`, json("POST")), "POST .../chat/follow-ups/{id}/task");
    },
    createTaskFromMessage(wsId: string, messageId: string, input: { title?: string } = {}) {
      return task(request(`${ws(wsId)}/chat/messages/${enc(messageId)}/tasks`, json("POST", input)), "POST .../chat/messages/{id}/tasks");
    },
    /**
     * The links of the messages a timeline shows: one request per 200 ids, the
     * server's cap (chat_links.go › maxRoomMessageLinkIDs, the web's ROOM_MESSAGE_LINKS_BATCH).
     */
    async listRoomMessageLinks(wsId: string, roomId: string, messageIds: string[]): Promise<ChatMessageLink[]> {
      const batches: string[][] = [];
      for (let i = 0; i < messageIds.length; i += ROOM_MESSAGE_LINKS_BATCH) batches.push(messageIds.slice(i, i + ROOM_MESSAGE_LINKS_BATCH));
      const pages = await Promise.all(
        batches.map(async (ids) => {
          const raw = await request(`${room(wsId, roomId)}/message-links${query({ message_ids: ids.join(",") })}`);
          return parseWithFallback(raw, LinkListSchema, { links: [] }, { endpoint: "GET .../chat/rooms/{roomID}/message-links" }).links;
        }),
      );
      return pages.flat();
    },
    getTask(taskId: string) {
      return task(request(`/api/v1/tasks/${enc(taskId)}`), "GET /api/v1/tasks/{id}");
    },
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;

export const chatApi: ChatApi = createChatApi((path, init) => api.request(path, init));
