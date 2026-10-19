// The chat endpoints the mobile chat tab calls, copied from
// packages/core/api/endpoints/{chat-rooms,chat-messages,chat-threads,
// chat-channels,chat-users,chat-presence,chat-voice,chat-media,
// chat-follow-ups,chat-links}.ts, tasks.ts (getTask) and workspaces.ts
// (ADR 0011: those reach the web transport). Same paths, same lenient schemas
// (imported from the allowlisted chat-schemas), same fallbacks; only the
// transport is the app's own. chat-api.test.ts holds a malformed-response
// case for every one of them.
import { parseWithFallback } from "@uniwork/core/api/schema";
import {
  ChatGifListSchema,
  ChatMessageEnvelopeSchema,
  ChatMessagesListSchema,
  ChatNicknameMapSchema,
  ChatRoomEnvelopeSchema,
  ChatRoomMemberSchema,
  ChatRoomsListSchema,
  ChatVoiceTokenSchema,
  PendingChatVoiceInvitesSchema,
  enc,
  type ChatGifRecord,
  type ChatMessageRecord,
  type ChatVoiceToken,
  type PendingChatVoiceInvite,
  type ChatNicknameMap,
  type ChatRoomMemberRecord,
  type ChatRoomRecord,
} from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import { api } from "./api";
import type { PendingFile } from "@/lib/send-pipeline";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const StatusSchema = z.object({ status: z.string().optional() });

const MembersSchema = z.object({ members: z.array(ChatRoomMemberSchema).optional() });

// packages/core/api/endpoints/chat-rooms.ts › ChatUnreadSummarySchema: one drifted row drops alone.
const ChatUnreadTotalsSchema = z.object({ unread: z.number().catch(0), mentions: z.number().catch(0) });
const ChatWorkspaceUnreadSchema = ChatUnreadTotalsSchema.extend({ workspace_id: z.string() });
const ChatUnreadSummarySchema = z.object({
  direct: ChatUnreadTotalsSchema.catch({ unread: 0, mentions: 0 }),
  workspaces: z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((item) => { const row = ChatWorkspaceUnreadSchema.safeParse(item); return row.success ? [row.data] : []; })),
});
export type ChatUnreadSummary = z.infer<typeof ChatUnreadSummarySchema>;
const EMPTY_UNREAD_SUMMARY: ChatUnreadSummary = { direct: { unread: 0, mentions: 0 }, workspaces: [] };

// packages/core/types/ai.ts › ChatCatchUpResponseSchema, the fields the phone's brief shows.
const CatchUpHighlightSchema = z.object({ text: z.string(), source_message_id: z.string().optional().default("") });
const CatchUpActionItemSchema = z.object({ title: z.string(), owner: z.string().optional().default(""), due: z.string().optional().default("") });
const ChatCatchUpSchema = z.object({
  summary: z.string().optional().default(""),
  highlights: z.array(z.string()).optional().default([]),
  highlight_items: z.array(CatchUpHighlightSchema).optional().default([]).catch([]),
  action_items: z.array(CatchUpActionItemSchema).optional().default([]).catch([]),
  message_count: z.number().optional().default(0),
});
export type ChatCatchUp = z.infer<typeof ChatCatchUpSchema>;

// packages/core/api/endpoints/chat-media.ts › ChatRoomSharedSummarySchema: counts and the newest photos.
const count = z.number().int().nonnegative().catch(0);
const SharedPhotoSchema = z.object({
  message_id: z.string(),
  title: z.string().catch(""),
  url: z.string().optional().catch(undefined),
  thumb_url: z.string().optional().catch(undefined),
  created_at: z.string().catch(""),
});
const SharedSummarySchema = z.object({
  counts: z.object({ photo: count, gif: count, video: count, file: count, link: count, voice: count }).catch({ photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }),
  recent_photos: z.array(SharedPhotoSchema).catch([]),
});
export type ChatSharedSummary = z.infer<typeof SharedSummarySchema>;
const ActiveRecordingSchema = z.object({ recording: z.object({ id: z.string().optional() }).nullish().catch(undefined) });
const EMPTY_SHARED_SUMMARY: ChatSharedSummary = { counts: { photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }, recent_photos: [] };

/** A workspace member as the new-DM picker and mention list need one. */
export interface WorkspaceMemberRecord {
  user_id: string;
  email: string;
  display_name: string;
}

const WorkspaceMemberSchema = z.object({
  user_id: z.string(),
  email: z.string().catch(""),
  display_name: z.string().catch(""),
});

// One drifted member must not empty the picker.
const WorkspaceMembersSchema = z.object({
  members: z
    .array(z.unknown())
    .nullish()
    .transform((items) =>
      (items ?? []).flatMap((item) => {
        const parsed = WorkspaceMemberSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

const PresenceBeatSchema = z.object({ online_user_ids: z.array(z.string()).optional() });

const ThreadReadSchema = z.object({ previous_read_at: z.string().optional().catch(undefined) });

// The fields the phone reads of a follow-up, a message link and a task; the
// web's schemas live outside the mobile allowlist (chat-follow-ups.ts,
// chat-links.ts, types/task.ts), so these are their lenient subsets.
const FollowUpSchema = z.object({
  id: z.string(),
  message_id: z.string(),
  note: z.string().catch(""),
  due_at: z.string().nullish().catch(null),
  completed_at: z.string().nullish().catch(null),
});
export type ChatFollowUp = z.infer<typeof FollowUpSchema>;
const FollowUpEnvelopeSchema = z.object({ follow_up: FollowUpSchema.optional() });
const FollowUpListSchema = z.object({ follow_ups: z.array(FollowUpSchema).optional().default([]) });

const MessageLinkSchema = z.object({ id: z.string(), message_id: z.string(), target_type: z.string(), target_id: z.string() });
type ChatMessageLink = z.infer<typeof MessageLinkSchema>;
const LinkListSchema = z.object({ links: z.array(MessageLinkSchema).optional().default([]) });

const TaskSchema = z.object({ id: z.string(), title: z.string().catch(""), identifier: z.string().catch(""), status: z.string().catch("") });
export type ChatTask = z.infer<typeof TaskSchema>;
const TaskEnvelopeSchema = z.object({ task: TaskSchema.optional() });

const ROOM_MESSAGE_LINKS_BATCH = 200;

/** The follow-up and link deletes answer `{ok}` or `{status}` (chat-follow-ups.ts › isOk). */
const OkSchema = z.object({ ok: z.boolean().optional(), status: z.string().optional() });

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

export function createChatApi(request: Request) {
  const ws = (wsId: string) => `/api/v1/workspaces/${enc(wsId)}`;
  const room = (wsId: string, roomId: string) => `${ws(wsId)}/chat/rooms/${enc(roomId)}`;

  async function message(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord | null> {
    return parseWithFallback(await raw, ChatMessageEnvelopeSchema, { message: undefined }, { endpoint }).message ?? null;
  }
  async function messages(raw: Promise<unknown>, endpoint: string): Promise<ChatMessageRecord[]> {
    return parseWithFallback(await raw, ChatMessagesListSchema, { messages: [] }, { endpoint }).messages;
  }
  async function roomOf(raw: Promise<unknown>, endpoint: string): Promise<ChatRoomRecord | null> {
    return parseWithFallback(await raw, ChatRoomEnvelopeSchema, { room: undefined }, { endpoint }).room ?? null;
  }
  async function ok(raw: Promise<unknown>, endpoint: string): Promise<boolean> {
    return parseWithFallback(await raw, StatusSchema, { status: "" }, { endpoint }).status === "ok";
  }
  async function task(raw: Promise<unknown>, endpoint: string): Promise<ChatTask | null> {
    return parseWithFallback<z.infer<typeof TaskEnvelopeSchema>>(await raw, TaskEnvelopeSchema, {}, { endpoint }).task ?? null;
  }
  async function followUp(raw: Promise<unknown>, endpoint: string): Promise<ChatFollowUp | null> {
    return parseWithFallback<z.infer<typeof FollowUpEnvelopeSchema>>(await raw, FollowUpEnvelopeSchema, {}, { endpoint }).follow_up ?? null;
  }

  return {
    async listRooms(wsId: string, signal?: AbortSignal): Promise<ChatRoomRecord[]> {
      const raw = await request(`${ws(wsId)}/chat/rooms`, { signal });
      return parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms" }).rooms;
    },
    /** Unread counts per workspace, for the workspace switch and the pill's badge (R4b). */
    async unreadSummary(signal?: AbortSignal): Promise<ChatUnreadSummary> {
      const raw = await request("/api/v1/me/chat/unread-summary", { signal });
      return parseWithFallback(raw, ChatUnreadSummarySchema, EMPTY_UNREAD_SUMMARY, { endpoint: "GET /api/v1/me/chat/unread-summary" });
    },
    /** UNI's brief of one room's unread messages ("Bắt kịp nhanh"); null when the answer is not a brief. */
    async catchUp(wsId: string, body: { room_id: string; locale?: string; since?: string }): Promise<ChatCatchUp | null> {
      const raw = await request(`${ws(wsId)}/ai/chat/catch-up`, json("POST", body));
      const parsed = parseWithFallback<ChatCatchUp | null>(raw, ChatCatchUpSchema, null, { endpoint: "POST /api/v1/workspaces/{ws}/ai/chat/catch-up" });
      return parsed;
    },
    resolveDMRoom(wsId: string, userId: string) {
      return roomOf(request(`${ws(wsId)}/chat/dm`, json("POST", { user_id: userId })), "POST /api/v1/workspaces/{ws}/chat/dm");
    },
    leaveRoom(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/leave`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/leave");
    },
    async listRoomMembers(wsId: string, roomId: string): Promise<ChatRoomMemberRecord[]> {
      const raw = await request(`${room(wsId, roomId)}/members`);
      return parseWithFallback(raw, MembersSchema, { members: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members" })
        .members ?? [];
    },
    setRoomMuted(wsId: string, roomId: string, muted: boolean) {
      return ok(request(`${room(wsId, roomId)}/mute`, { method: muted ? "POST" : "DELETE" }), "POST|DELETE .../chat/rooms/{roomID}/mute");
    },
    markRoomRead(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/read`, json("POST")), "POST .../chat/rooms/{roomID}/read");
    },
    listMessages(
      wsId: string,
      roomId: string,
      options: { cursor?: string; before?: string; after?: string; limit?: number; markRead?: boolean } = {},
      signal?: AbortSignal,
    ) {
      const qs = query({
        cursor: options.cursor,
        after: options.after,
        before: options.before,
        limit: options.limit,
        // Default true on the server; 0 keeps the read pointer where it was.
        mark_read: options.markRead === false ? "0" : undefined,
      });
      return messages(request(`${room(wsId, roomId)}/messages${qs}`, { signal }), "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages");
    },
    listMessagesAround(wsId: string, roomId: string, messageId: string, limit = 50) {
      return messages(
        request(`${room(wsId, roomId)}/messages/around/${enc(messageId)}${query({ limit })}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/around/{messageID}",
      );
    },
    getMessage(wsId: string, roomId: string, messageId: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    searchMessages(wsId: string, roomId: string, q: string, limit = 30) {
      return messages(
        request(`${room(wsId, roomId)}/messages/search${query({ q, limit })}`),
        "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/search",
      );
    },
    /** Text, or a reminder (M3: `reminder` and no body, as chat-create-reminder-dialog.tsx sends it). */
    sendMessage(
      wsId: string,
      roomId: string,
      input: { body?: string; client_msg_id: string; reply_to_message_id?: string; reminder?: { body: string; remind_at: string; repeat?: string } },
    ) {
      return message(request(`${room(wsId, roomId)}/messages`, json("POST", input)), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages");
    },
    sendFileMessage(wsId: string, roomId: string, input: { file: PendingFile; client_msg_id: string; reply_to_message_id?: string }) {
      const form = new FormData();
      // React Native's FormData uploads a { uri, name, type } part from disk.
      form.append("file", { uri: input.file.uri, name: input.file.name, type: input.file.mimeType ?? "application/octet-stream" } as unknown as Blob);
      form.append("client_msg_id", input.client_msg_id);
      if (input.reply_to_message_id) form.append("reply_to_message_id", input.reply_to_message_id);
      return message(
        request(`${room(wsId, roomId)}/messages/file`, { method: "POST", body: form }),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/file",
      );
    },
    toggleReaction(wsId: string, roomId: string, messageId: string, emoji: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}/reactions`, json("POST", { emoji })),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/reactions",
      );
    },
    editMessage(wsId: string, roomId: string, messageId: string, body: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`, json("PATCH", { body })),
        "PATCH /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    deleteMessage(wsId: string, roomId: string, messageId: string) {
      return ok(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}`, { method: "DELETE" }),
        "DELETE /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}",
      );
    },
    listThreadMessages(wsId: string, roomId: string, rootId: string, options: { cursor?: string; before?: string; limit?: number } = {}) {
      return messages(
        request(`${room(wsId, roomId)}/threads/${enc(rootId)}/messages${query({ limit: options.limit, cursor: options.cursor, before: options.before })}`),
        "GET .../threads/{id}/messages",
      );
    },
    sendThreadMessage(wsId: string, roomId: string, rootId: string, input: { body: string; client_msg_id: string }) {
      return message(request(`${room(wsId, roomId)}/threads/${enc(rootId)}/messages`, json("POST", input)), "POST .../threads/{id}/messages");
    },
    async markThreadRead(wsId: string, rootId: string): Promise<string | null> {
      const raw = await request(`${ws(wsId)}/chat/threads/${enc(rootId)}/read`, { method: "POST" });
      return parseWithFallback(raw, ThreadReadSchema, { previous_read_at: undefined }, { endpoint: "POST .../threads/{id}/read" })
        .previous_read_at || null;
    },
    async listChannels(wsId: string, scope: "mine" | "discoverable"): Promise<ChatRoomRecord[]> {
      const raw = await request(`${ws(wsId)}/chat/channels${query({ scope })}`);
      return parseWithFallback(raw, ChatRoomsListSchema, { rooms: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/channels" }).rooms;
    },
    joinChannel(wsId: string, roomId: string) {
      return roomOf(request(`${ws(wsId)}/chat/channels/${enc(roomId)}/join`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/channels/{roomID}/join");
    },
    async listNicknames(wsId: string): Promise<Record<string, string>> {
      const raw = await request(`${ws(wsId)}/chat/nicknames`);
      const parsed = parseWithFallback<ChatNicknameMap>(raw, ChatNicknameMapSchema, { nicknames: {} }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/nicknames" });
      const out: Record<string, string> = {};
      for (const [userId, nickname] of Object.entries(parsed.nicknames)) {
        const key = userId.trim().toUpperCase();
        if (key) out[key] = nickname;
      }
      return out;
    },
    async listWorkspaceMembers(wsId: string): Promise<WorkspaceMemberRecord[]> {
      const raw = await request(`${ws(wsId)}/members`);
      return parseWithFallback(raw, WorkspaceMembersSchema, { members: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/members" }).members;
    },
    /** One online heartbeat; the workspace's online user ids, or null when the answer carries none. */
    async beatPresence(wsId: string, visible: boolean): Promise<string[] | null> {
      const raw = await request(`${ws(wsId)}/chat/presence`, json("POST", { state: "online", visible }));
      return parseWithFallback<z.infer<typeof PresenceBeatSchema>>(raw, PresenceBeatSchema, {}, { endpoint: "POST /api/v1/workspaces/{ws}/chat/presence" }).online_user_ids ?? null;
    },
    leavePresence(wsId: string) {
      return ok(request(`${ws(wsId)}/chat/presence`, json("POST", { state: "offline" })), "POST /api/v1/workspaces/{ws}/chat/presence");
    },
    /** GET …/rooms/{id}/shared-summary: what the room has shared, for the info screen (MobRoomInfo board). */
    async sharedSummary(wsId: string, roomId: string, signal?: AbortSignal): Promise<ChatSharedSummary> {
      const raw = await request(`${room(wsId, roomId)}/shared-summary`, { signal });
      return parseWithFallback(raw, SharedSummarySchema, EMPTY_SHARED_SUMMARY, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/shared-summary" });
    },
    /** POST …/chat/groups (chat-rooms.ts › createChatGroup): the new group, or null. */
    createGroup(wsId: string, input: { name: string; member_user_ids: string[] }): Promise<ChatRoomRecord | null> {
      return roomOf(request(`${ws(wsId)}/chat/groups`, json("POST", input)), "POST /api/v1/workspaces/{ws}/chat/groups");
    },
    /** POST …/rooms/{id}/members (chat-rooms.ts › inviteChatGroupMembers): the group after the invite, or null. */
    inviteGroupMembers(wsId: string, roomId: string, memberUserIds: string[]): Promise<ChatRoomRecord | null> {
      return roomOf(request(`${room(wsId, roomId)}/members`, json("POST", { member_user_ids: memberUserIds })), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/members");
    },
    /** GET …/voice/recording/active (chat-voice.ts › getActiveChatVoiceRecording): whether this call is being recorded. */
    async callRecordingActive(wsId: string, roomId: string, callId: string): Promise<boolean> {
      const raw = await request(`${room(wsId, roomId)}/voice/recording/active${query({ call_id: callId })}`);
      const parsed = parseWithFallback<z.infer<typeof ActiveRecordingSchema>>(raw, ActiveRecordingSchema, {}, { endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recording/active" });
      return Boolean(parsed.recording?.id);
    },
    /** POST …/messages/{id}/pin toggles the pin; the server answers with the message (chat-messages.ts › toggleChatMessagePin). */
    togglePin(wsId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> {
      return message(request(`${room(wsId, roomId)}/messages/${enc(messageId)}/pin`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/pin");
    },
    /** POST …/messages/{id}/forward writes a copy in each target room (chat-forward.ts); how many copies were written. */
    async forwardMessage(wsId: string, messageId: string, targetRoomIds: string[]): Promise<number> {
      const raw = await request(`${ws(wsId)}/chat/messages/${enc(messageId)}/forward`, json("POST", { target_room_ids: targetRoomIds }));
      return parseWithFallback(raw, ChatMessagesListSchema, { messages: [] }, { endpoint: "POST /api/v1/workspaces/{ws}/chat/messages/{messageID}/forward" }).messages.length;
    },
    signalTyping(wsId: string, roomId: string) {
      return ok(request(`${room(wsId, roomId)}/typing`, json("POST")), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/typing");
    },
    // Calls (M3) ← packages/core/api/endpoints/chat-voice.ts.
    async listPendingVoiceInvites(wsId: string): Promise<PendingChatVoiceInvite[]> {
      const raw = await request(`${ws(wsId)}/chat/voice/pending`);
      return parseWithFallback(raw, PendingChatVoiceInvitesSchema, { invites: [] }, { endpoint: "GET /api/v1/workspaces/{ws}/chat/voice/pending" }).invites;
    },
    /** The LiveKit url and token of a call; null when the answer carries none. */
    async mintVoiceToken(roomId: string, callId: string): Promise<ChatVoiceToken | null> {
      const raw = await request("/api/v1/chat/voice/token", json("POST", { room_id: roomId.trim(), call_id: callId.trim() }));
      return parseWithFallback<ChatVoiceToken | null>(raw, ChatVoiceTokenSchema, null, { endpoint: "POST /api/v1/chat/voice/token" });
    },
    signalVoiceInvite(wsId: string, roomId: string, callId: string, video: boolean) {
      return ok(
        request(`${room(wsId, roomId)}/voice/invite`, json("POST", video ? { call_id: callId, video: true } : { call_id: callId })),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/invite",
      );
    },
    signalVoiceAccept(wsId: string, roomId: string, callId: string) {
      return ok(request(`${room(wsId, roomId)}/voice/accept`, json("POST", { call_id: callId })), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/accept");
    },
    signalVoiceHangup(wsId: string, roomId: string, callId: string, durationSeconds?: number) {
      const body = durationSeconds != null && durationSeconds > 0 ? { call_id: callId, duration_seconds: durationSeconds } : { call_id: callId };
      return ok(request(`${room(wsId, roomId)}/voice/hangup`, json("POST", body)), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/hangup");
    },
    // Rich kinds (M3).
    votePoll(wsId: string, roomId: string, messageId: string, optionId: string) {
      return message(
        request(`${room(wsId, roomId)}/messages/${enc(messageId)}/poll/vote`, json("POST", { option_id: optionId })),
        "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/{messageID}/poll/vote",
      );
    },
    /** A recorded clip from disk: expo-audio writes AAC in MPEG-4, which the server takes as audio/mp4. */
    sendVoiceMessage(wsId: string, roomId: string, input: { uri: string; duration_ms: number; client_msg_id: string; reply_to_message_id?: string }) {
      const form = new FormData();
      form.append("file", { uri: input.uri, name: "voice.m4a", type: "audio/mp4" } as unknown as Blob);
      form.append("duration_ms", String(input.duration_ms));
      form.append("client_msg_id", input.client_msg_id);
      if (input.reply_to_message_id) form.append("reply_to_message_id", input.reply_to_message_id);
      return message(request(`${room(wsId, roomId)}/messages/voice`, { method: "POST", body: form }), "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/messages/voice");
    },
    /** Stickers or GIFs: trending, or a search when there is a query (the four chat-media.ts endpoints). */
    async listExpressions(wsId: string, kind: "stickers" | "gifs", q: string, limit = 48): Promise<ChatGifRecord[]> {
      const mode = q.trim() ? "search" : "trending";
      const raw = await request(`${ws(wsId)}/chat/${kind}/${mode}${query({ q: q.trim(), limit })}`);
      return parseWithFallback<z.infer<typeof ChatGifListSchema>>(raw, ChatGifListSchema, { items: [] }, { endpoint: `GET /api/v1/workspaces/{ws}/chat/${kind}/${mode}` }).items.map((item) => ({
        id: item.id,
        label: item.label,
        url: item.url,
        previewUrl: item.preview_url?.trim() || item.url,
      }));
    },
    async listFollowUps(wsId: string, includeCompleted = false): Promise<ChatFollowUp[]> {
      const raw = await request(`${ws(wsId)}/chat/follow-ups${query({ include_completed: includeCompleted ? "true" : undefined })}`);
      return parseWithFallback(raw, FollowUpListSchema, { follow_ups: [] }, { endpoint: "GET .../chat/follow-ups" }).follow_ups;
    },
    createFollowUp(wsId: string, messageId: string, input: { note?: string; due_at?: string | null } = {}) {
      return followUp(request(`${ws(wsId)}/chat/messages/${enc(messageId)}/follow-ups`, json("POST", input)), "POST .../chat/messages/{id}/follow-ups");
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
