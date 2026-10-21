// The lenient schemas of the chat endpoints data/chat-api.ts calls, copied
// from packages/core/api/endpoints/{chat-rooms,chat-media}.ts and
// packages/core/types/ai.ts, plus lenient subsets of the web's follow-up,
// link and task schemas. A module of their own, free of the transport, so the
// query cache read back from disk (data/persisted-cache.ts) re-reads each kept
// list through the schema that shaped it from the network.
import { ChatRoomMemberSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";

export const StatusSchema = z.object({ status: z.string().optional() });

export const MembersSchema = z.object({ members: z.array(ChatRoomMemberSchema).optional() });

// GET …/chat/voice/pending › outgoing (mobile only; the web reads `invites`): the calls the caller started that
// the server still holds. A drifted answer is no evidence, so it reads as none.
export const OutgoingVoiceCallsSchema = z.object({
  outgoing: z.array(z.object({ room_id: z.string(), call_id: z.string(), accepted: z.boolean() })).optional().default([]),
});
export type OutgoingVoiceCall = z.infer<typeof OutgoingVoiceCallsSchema>["outgoing"][number];

// packages/core/api/endpoints/chat-rooms.ts › ChatUnreadSummarySchema: one drifted row drops alone.
const ChatUnreadTotalsSchema = z.object({ unread: z.number().catch(0), mentions: z.number().catch(0) });
const ChatWorkspaceUnreadSchema = ChatUnreadTotalsSchema.extend({ workspace_id: z.string() });
export const ChatUnreadSummarySchema = z.object({
  direct: ChatUnreadTotalsSchema.catch({ unread: 0, mentions: 0 }),
  workspaces: z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((item) => { const row = ChatWorkspaceUnreadSchema.safeParse(item); return row.success ? [row.data] : []; })),
});
export type ChatUnreadSummary = z.infer<typeof ChatUnreadSummarySchema>;
export const EMPTY_UNREAD_SUMMARY: ChatUnreadSummary = { direct: { unread: 0, mentions: 0 }, workspaces: [] };

// packages/core/types/ai.ts › ChatCatchUpResponseSchema, the fields the phone's brief shows.
const CatchUpHighlightSchema = z.object({ text: z.string(), source_message_id: z.string().optional().default("") });
const CatchUpActionItemSchema = z.object({ title: z.string(), owner: z.string().optional().default(""), due: z.string().optional().default("") });
export const ChatCatchUpSchema = z.object({
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
export const SharedSummarySchema = z.object({
  counts: z.object({ photo: count, gif: count, video: count, file: count, link: count, voice: count }).catch({ photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }),
  recent_photos: z.array(SharedPhotoSchema).catch([]),
});
export type ChatSharedSummary = z.infer<typeof SharedSummarySchema>;
export const ActiveRecordingSchema = z.object({ recording: z.object({ id: z.string().optional() }).nullish().catch(undefined) });
export const EMPTY_SHARED_SUMMARY: ChatSharedSummary = { counts: { photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }, recent_photos: [] };

/** A workspace member as the contacts tab, the new-DM picker and the mention list need one. */
export interface WorkspaceMemberRecord {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
}

const WorkspaceMemberSchema = z.object({
  user_id: z.string(),
  email: z.string().catch(""),
  display_name: z.string().catch(""),
  avatar_url: z.string().optional().catch(undefined),
});

// One drifted member must not empty the picker.
export const WorkspaceMembersSchema = z.object({
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

export const NicknamesSchema = z.object({ nicknames: z.record(z.string(), z.unknown()).catch({}) });

export const PresenceBeatSchema = z.object({ online_user_ids: z.array(z.string()).optional() });

export const ThreadReadSchema = z.object({ previous_read_at: z.string().optional().catch(undefined) });

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
export const FollowUpEnvelopeSchema = z.object({ follow_up: FollowUpSchema.optional() });
export const FollowUpListSchema = z.object({ follow_ups: z.array(FollowUpSchema).optional().default([]) });

const MessageLinkSchema = z.object({ id: z.string(), message_id: z.string(), target_type: z.string(), target_id: z.string() });
export type ChatMessageLink = z.infer<typeof MessageLinkSchema>;
export const LinkListSchema = z.object({ links: z.array(MessageLinkSchema).optional().default([]) });

const TaskSchema = z.object({ id: z.string(), title: z.string().catch(""), identifier: z.string().catch(""), status: z.string().catch("") });
export type ChatTask = z.infer<typeof TaskSchema>;
export const TaskEnvelopeSchema = z.object({ task: TaskSchema.optional() });

/** The follow-up and link deletes answer `{ok}` or `{status}` (chat-follow-ups.ts › isOk). */
export const OkSchema = z.object({ ok: z.boolean().optional(), status: z.string().optional() });
