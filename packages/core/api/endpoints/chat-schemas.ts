import { z } from "zod";

export const WorkspaceChatRoomSchema = z.object({
  workspace_id: z.string(),
  room_id: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});
export type WorkspaceChatRoom = z.infer<typeof WorkspaceChatRoomSchema>;

export const ChatUserLookupSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string(),
});
export type ChatUserLookup = z.infer<typeof ChatUserLookupSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  workspace_id: z.string(),
  sender_id: z.string(),
  sender_display_name: z.string(),
  kind: z.string().optional().default("text"),
  body: z.string(),
  reply_to_message_id: z.string().optional(),
  created_at: z.string(),
  edited_at: z.string().optional(),
  pinned: z.boolean().optional().default(false),
  mentioned_user_ids: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  reactions: z
    .record(z.string(), z.number())
    .nullish()
    .transform((value) => value ?? {}),
  voice_call: z
    .object({
      outcome: z.string(),
      duration_seconds: z.number().optional(),
      caller_id: z.string(),
    })
    .optional(),
  voice: z
    .object({
      duration_ms: z.number().optional().default(0),
      content_type: z.string().optional().default(""),
      size_bytes: z.number().optional().default(0),
    })
    .optional(),
  file: z
    .object({
      filename: z.string().optional().default(""),
      content_type: z.string().optional().default(""),
      size_bytes: z.number().optional().default(0),
    })
    .optional(),
  poll: z
    .object({
      question: z.string(),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          votes: z.number().optional().default(0),
        }),
      ),
      settings: z
        .object({
          deadline_at: z.string().nullish(),
          pin_to_top: z.boolean().optional().default(false),
          allow_multiple: z.boolean().optional().default(true),
          allow_add_options: z.boolean().optional().default(true),
          hide_results_until_vote: z.boolean().optional().default(false),
          hide_voters: z.boolean().optional().default(false),
        })
        .optional()
        .default({
          deadline_at: null,
          pin_to_top: false,
          allow_multiple: true,
          allow_add_options: true,
          hide_results_until_vote: false,
          hide_voters: false,
        }),
      viewer_option_ids: z
        .array(z.string())
        .nullish()
        .transform((value) => value ?? []),
      votes_by_user: z
        .record(z.string(), z.array(z.string()))
        .nullish()
        .transform((value) => value ?? undefined),
    })
    .optional(),
  reminder: z
    .object({
      body: z.string(),
      remind_at: z.string(),
      repeat: z.string().optional().default("none"),
    })
    .optional(),
  note: z
    .object({
      body: z.string(),
      pin_to_top: z.boolean().optional().default(false),
    })
    .optional(),
  priority: z.enum(["important", "urgent"]).optional(),
  // Echo of the sender's idempotency key; a client drops its own queued copy
  // when this comes back, instead of guessing from body and timestamp.
  client_msg_id: z.string().optional(),
});
export type ChatMessageRecord = z.infer<typeof ChatMessageSchema>;

export const ChatMessagesListSchema = z.object({
  messages: z.array(ChatMessageSchema).optional().default([]),
});

export const ChatMessageEnvelopeSchema = z.object({
  message: ChatMessageSchema.optional(),
});

export const ChatRoomMemberPermissionsSchema = z.object({
  allow_change_profile: z.boolean().optional().default(true),
  allow_pin_content: z.boolean().optional().default(true),
  allow_create_notes: z.boolean().optional().default(true),
  allow_create_polls: z.boolean().optional().default(true),
  allow_send_messages: z.boolean().optional().default(true),
});
export type ChatRoomMemberPermissions = z.infer<typeof ChatRoomMemberPermissionsSchema>;

export const ChatRoomSchema = z.object({
  id: z.string(),
  kind: z.enum(["workspace", "dm", "group", "channel"]),
  name: z.string(),
  workspace_id: z.string(),
  // Go encodes nil slices as JSON null; treat null like [] so one bad field does not drop the whole list.
  member_user_ids: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  unread_count: z.number().optional().default(0),
  mention_unread_count: z.number().optional().default(0),
  peer_user_id: z.string().optional(),
  peer_email: z.string().optional(),
  peer_display_name: z.string().optional(),
  last_message_body: z.string().optional(),
  last_message_kind: z.string().optional(),
  last_message_sender_id: z.string().optional(),
  last_message_sender_name: z.string().optional(),
  last_message_at: z.string().optional(),
  member_permissions: ChatRoomMemberPermissionsSchema.optional(),
  visibility: z.string().optional(),
  project_id: z.string().optional(),
  topic: z.string().optional(),
  is_default: z.boolean().optional(),
});
export type ChatRoomRecord = z.infer<typeof ChatRoomSchema>;

export const ChatRoomsListSchema = z.object({
  rooms: z.array(ChatRoomSchema).optional().default([]),
});

export const ChatRoomEnvelopeSchema = z.object({
  room: ChatRoomSchema.optional(),
});

export const ChatRoomMemberSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  send_restricted: z.boolean().optional().default(false),
  email: z.string(),
  display_name: z.string(),
});
export type ChatRoomMemberRecord = z.infer<typeof ChatRoomMemberSchema>;

export const ChatBlockStatusSchema = z.object({
  blocked_by_me: z.boolean().optional().default(false),
  blocked_me: z.boolean().optional().default(false),
});
export type ChatBlockStatus = z.infer<typeof ChatBlockStatusSchema>;

export const ChatNicknameMapSchema = z.object({
  nicknames: z.record(z.string(), z.string()).optional().default({}),
});
export type ChatNicknameMap = z.infer<typeof ChatNicknameMapSchema>;

export const ChatGifItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  preview_url: z.string().optional(),
});
export const ChatGifListSchema = z.object({
  items: z.array(ChatGifItemSchema).optional().default([]),
});
export type ChatGifRecord = {
  id: string;
  label: string;
  url: string;
  previewUrl: string;
};

export const ChatMediaStatusSchema = z.object({
  tenor_enabled: z.boolean().optional().default(false),
});

export const ChatVoiceTokenSchema = z.object({
  token: z.string(),
  url: z.string(),
});
export type ChatVoiceToken = z.infer<typeof ChatVoiceTokenSchema>;

export const PendingChatVoiceInviteSchema = z.object({
  room_id: z.string(),
  call_id: z.string(),
  caller_id: z.string(),
  caller_name: z.string().optional().default(""),
  call_kind: z.string().optional().default("dm"),
  room_name: z.string().optional(),
  invited_at: z.string().optional().default(""),
});
export type PendingChatVoiceInvite = z.infer<typeof PendingChatVoiceInviteSchema>;

export const PendingChatVoiceInvitesSchema = z.object({
  invites: z.array(PendingChatVoiceInviteSchema).optional().default([]),
});

export const enc = encodeURIComponent;

export function toWorkspaceChatRoom(data: WorkspaceChatRoom | null): WorkspaceChatRoom | null {
  if (!data?.enabled) return null;
  return data;
}
