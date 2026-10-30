// The phone's own lenient schemas for the chat endpoints data/chat-api.ts
// calls: mobile-only answers (outgoing calls, thread read), and the subsets
// of the web's follow-up, link and task records the phone reads. The ones the
// web reads too (unread summary, shared media, catch-up) are core's
// (@uniwork/core/api/endpoints/chat-schemas, @uniwork/core/types/ai). A module
// of their own, free of the transport, so the query cache read back from disk
// (data/persisted-cache.ts) re-reads each kept list through the schema that
// shaped it from the network.
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

export const ActiveRecordingSchema = z.object({ recording: z.object({ id: z.string().optional() }).nullish().catch(undefined) });

/** A workspace member as the contacts tab, the new-DM picker and the mention list need one. */
export interface WorkspaceMemberRecord {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
}

export const WorkspaceMemberSchema = z.object({
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

const MessageLinkSchema = z.object({
  id: z.string(),
  message_id: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  relation: z.string().catch(""),
});
export type ChatMessageLink = z.infer<typeof MessageLinkSchema>;
export const LinkListSchema = z.object({ links: z.array(MessageLinkSchema).optional().default([]) });
export const LinkEnvelopeSchema = z.object({ link: MessageLinkSchema.optional() });

export const DocumentPickSchema = z.object({ id: z.string(), title: z.string().catch("") });
export type DocumentPick = z.infer<typeof DocumentPickSchema>;
/** One unreadable row is dropped; the rest of the page stays. */
export const DocumentPickListSchema = z.object({
  documents: z
    .array(z.unknown())
    .nullish()
    .transform((items) =>
      (items ?? []).flatMap((item) => {
        const parsed = DocumentPickSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export const TaskPickSchema = z.object({ id: z.string(), title: z.string().catch(""), identifier: z.string().catch("") });
export type TaskPick = z.infer<typeof TaskPickSchema>;
export const TaskPickListSchema = z.object({
  tasks: z
    .array(z.unknown())
    .nullish()
    .transform((items) =>
      (items ?? []).flatMap((item) => {
        const parsed = TaskPickSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

const TaskAssigneeSchema = z.object({ display_name: z.string().catch("") });
const TaskSchema = z.object({
  id: z.string(),
  title: z.string().catch(""),
  identifier: z.string().catch(""),
  status: z.string().catch(""),
  priority: z.string().catch(""),
  assignee: TaskAssigneeSchema.nullish(),
});
export type ChatTask = z.infer<typeof TaskSchema>;
export const TaskEnvelopeSchema = z.object({ task: TaskSchema.optional() });

/** The follow-up and link deletes answer `{ok}` or `{status}` (chat-follow-ups.ts › isOk). */
export const OkSchema = z.object({ ok: z.boolean().optional(), status: z.string().optional() });
