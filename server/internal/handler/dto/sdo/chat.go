package sdo

// WorkspaceChatRoomSDO is the workspace native chat room.
type WorkspaceChatRoomSDO struct {
	RoomID      string `json:"room_id,omitempty" description:"Chat room id when provisioned; omitted until the first message" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	WorkspaceID string `json:"workspace_id" description:"UniWork workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Enabled     bool   `json:"enabled" description:"true when native chat is available" example:"true"`
}

// VoiceCallLogDTO is metadata for a voice call log message.
type VoiceCallLogDTO struct {
	Outcome         string `json:"outcome" description:"completed, unanswered, or declined" example:"completed"`
	DurationSeconds int    `json:"duration_seconds,omitempty" description:"Call length in seconds when completed" example:"125"`
	CallerID        string `json:"caller_id" description:"User id of the caller" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
}

// VoiceMessageDTO is metadata for private voice-message content.
type VoiceMessageDTO struct {
	DurationMS  int    `json:"duration_ms" description:"Recording duration in milliseconds" example:"12500"`
	ContentType string `json:"content_type" description:"Sniffed audio MIME type" example:"audio/webm"`
	SizeBytes   int64  `json:"size_bytes" description:"Stored audio size in bytes" example:"184320"`
}

// FileMessageDTO is metadata for private chat-file content (object_key stays server-side).
type FileMessageDTO struct {
	Filename    string `json:"filename" description:"Original filename" example:"sprint.pdf"`
	ContentType string `json:"content_type" description:"Sniffed MIME type" example:"application/pdf"`
	SizeBytes   int64  `json:"size_bytes" description:"Stored file size in bytes" example:"204800"`
}

// ChatPollOptionDTO is one poll choice with vote count.
type ChatPollOptionDTO struct {
	ID    string `json:"id" description:"Option id" example:"01J8X4OPT0N1P2Q3R4S5T6U7V8"`
	Label string `json:"label" description:"Option label" example:"Canteen"`
	Votes int    `json:"votes" description:"Vote count" example:"3"`
}

// ChatPollSettingsDTO configures poll behavior.
type ChatPollSettingsDTO struct {
	DeadlineAt           *string `json:"deadline_at,omitempty" description:"RFC3339 deadline" example:"2026-09-05T12:00:00Z"`
	PinToTop             bool    `json:"pin_to_top,omitempty" description:"Pin poll to top" example:"false"`
	AllowMultiple        bool    `json:"allow_multiple,omitempty" description:"Allow multiple selections" example:"true"`
	AllowAddOptions      bool    `json:"allow_add_options,omitempty" description:"Members may add options" example:"true"`
	HideResultsUntilVote bool    `json:"hide_results_until_vote,omitempty" description:"Hide results until voted" example:"false"`
	HideVoters           bool    `json:"hide_voters,omitempty" description:"Hide voters" example:"false"`
}

// ChatPollDTO is poll metadata attached to a poll message.
type ChatPollDTO struct {
	Question        string              `json:"question" description:"Poll question" example:"Ăn trưa ở đâu?"`
	Options         []ChatPollOptionDTO `json:"options" description:"Poll options"`
	Settings        ChatPollSettingsDTO `json:"settings" description:"Poll settings"`
	ViewerOptionIDs []string            `json:"viewer_option_ids,omitempty" description:"Option ids selected by the caller" example:"[\"01J8X4OPT0N1P2Q3R4S5T6U7V8\"]"`
	VotesByUser     map[string][]string `json:"votes_by_user,omitempty" description:"User id to selected option ids when voter list is visible"`
}

// ChatReminderDTO is reminder metadata attached to a reminder message.
type ChatReminderDTO struct {
	Body     string `json:"body" description:"Reminder content" example:"Họp sprint lúc 9h"`
	RemindAt string `json:"remind_at" description:"RFC3339 reminder time" example:"2026-09-05T09:00:00Z"`
	Repeat   string `json:"repeat" description:"none, daily, weekly, or monthly" example:"none"`
}

// ChatNoteDTO is note metadata attached to a note message.
type ChatNoteDTO struct {
	Body     string `json:"body" description:"Note content" example:"Link tài liệu sprint"`
	PinToTop bool   `json:"pin_to_top" description:"Whether the note is pinned to top" example:"false"`
}

// ChatMessageDTO is a stored chat message.
type ChatMessageDTO struct {
	ID                string           `json:"id" description:"Message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	RoomID            string           `json:"room_id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	WorkspaceID       string           `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	SenderID          string           `json:"sender_id" description:"Author user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	SenderDisplayName string           `json:"sender_display_name" description:"Author display name" example:"Nguyen Van A"`
	Kind              string           `json:"kind,omitempty" description:"text or voice_call_log" example:"text"`
	Body              string           `json:"body" description:"Message text" example:"Xin chào team!"`
	ReplyToMessageID  *string          `json:"reply_to_message_id,omitempty" description:"Replied message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	ThreadRootID      *string          `json:"thread_root_id,omitempty" description:"Thread root message id when this is a reply" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	ReplyCount        int              `json:"reply_count,omitempty" description:"Reply count on a thread root" example:"3"`
	LastReplyAt       string           `json:"last_reply_at,omitempty" description:"RFC3339 of latest reply on a thread root"`
	ThreadUnread      bool             `json:"thread_unread,omitempty" description:"Caller has unread replies in this thread"`
	CreatedAt         string           `json:"created_at" description:"RFC3339 timestamp" example:"2026-03-26T10:00:00Z"`
	EditedAt          string           `json:"edited_at,omitempty" description:"RFC3339 timestamp when the message was last edited" example:"2026-03-26T10:05:00Z"`
	Pinned            bool             `json:"pinned,omitempty" description:"true when pinned in the room" example:"true"`
	MentionedUserIDs  []string         `json:"mentioned_user_ids,omitempty" description:"User ids notified by @mention in this message" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
	Reactions         map[string]int   `json:"reactions,omitempty" description:"Emoji reaction counts keyed by emoji" example:"{\"👍\":2}"`
	VoiceCall         *VoiceCallLogDTO `json:"voice_call,omitempty" description:"Voice call log metadata when kind is voice_call_log"`
	Voice             *VoiceMessageDTO `json:"voice,omitempty" description:"Voice recording metadata when kind is voice"`
	File              *FileMessageDTO  `json:"file,omitempty" description:"File attachment metadata when kind is file"`
	Poll              *ChatPollDTO     `json:"poll,omitempty" description:"Poll payload when kind is poll"`
	Reminder          *ChatReminderDTO `json:"reminder,omitempty" description:"Reminder payload when kind is reminder"`
	Note              *ChatNoteDTO     `json:"note,omitempty" description:"Note payload when kind is note"`
	Priority          string           `json:"priority,omitempty" description:"important or urgent message flag" example:"important"`
	ClientMsgID       string           `json:"client_msg_id,omitempty" description:"Idempotency key the sender supplied, so a client can drop its own queued copy" example:"550e8400-e29b-41d4-a716-446655440000"`
}

// ChatRoomDTO is a dm, group, or channel chat room.
type ChatRoomDTO struct {
	ID                    string                        `json:"id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	Kind                  string                        `json:"kind" description:"dm, group, or channel" example:"channel"`
	Name                  string                        `json:"name" description:"Room display name" example:"marketing"`
	WorkspaceID           string                        `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	MemberUserIDs         []string                      `json:"member_user_ids" description:"Other member user ids" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
	MentionUnreadCount    int                           `json:"mention_unread_count" description:"Unread messages that mention the caller" example:"1"`
	UnreadCount           int                           `json:"unread_count" description:"Unread messages for the caller" example:"3"`
	PeerUserID            string                        `json:"peer_user_id,omitempty" description:"DM peer user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	PeerEmail             string                        `json:"peer_email,omitempty" description:"DM peer email" example:"peer@example.com"`
	PeerDisplayName       string                        `json:"peer_display_name,omitempty" description:"DM peer display name" example:"Nguyen Van A"`
	LastMessageBody       string                        `json:"last_message_body,omitempty" description:"Plain-text preview of the latest message" example:"@Binh check this"`
	LastMessageKind       string                        `json:"last_message_kind,omitempty" description:"Kind of the latest message" example:"text"`
	LastMessageSenderID   string                        `json:"last_message_sender_id,omitempty" description:"Author of the latest message" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	LastMessageSenderName string                        `json:"last_message_sender_name,omitempty" description:"Display name of the latest message author" example:"Nguyen Van A"`
	LastMessageAt         string                        `json:"last_message_at,omitempty" description:"RFC3339 timestamp of the latest message" example:"2026-03-26T10:00:00Z"`
	MemberPermissions     *ChatRoomMemberPermissionsDTO `json:"member_permissions,omitempty" description:"Permissions for regular members in group/channel rooms"`
	Visibility            string                        `json:"visibility,omitempty" description:"public or private (channels)" example:"public"`
	ProjectID             string                        `json:"project_id,omitempty" description:"Linked project id when set"`
	Topic                 string                        `json:"topic,omitempty" description:"Channel topic"`
	IsDefault             bool                          `json:"is_default,omitempty" description:"Default workspace channel"`
}

// ChatChannelListSDO is GET .../chat/channels.
type ChatChannelListSDO struct {
	Rooms []ChatRoomDTO `json:"rooms"`
}

// ChatThreadDTO is one followed thread summary.
type ChatThreadDTO struct {
	ThreadRootID string `json:"thread_root_id" description:"Root message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	RoomID       string `json:"room_id" description:"Chat room id"`
	WorkspaceID  string `json:"workspace_id" description:"Workspace id"`
	RootBody     string `json:"root_body" description:"Root message body preview"`
	RootSenderID string `json:"root_sender_id" description:"Root author user id"`
	ReplyCount   int    `json:"reply_count" description:"Number of replies" example:"3"`
	LastReplyAt  string `json:"last_reply_at,omitempty" description:"RFC3339 of latest reply"`
	RootCreated  string `json:"root_created_at" description:"RFC3339 of root message"`
	Unread       bool   `json:"unread" description:"Caller has unread replies"`
	Reason       string `json:"reason,omitempty" description:"Why the caller follows: author|replied|mentioned|manual"`
}

// ChatThreadListSDO is GET .../chat/threads.
type ChatThreadListSDO struct {
	Threads []ChatThreadDTO `json:"threads"`
}

// ChatRoomMemberPermissionsDTO configures what non-admin members may do.
type ChatRoomMemberPermissionsDTO struct {
	AllowChangeProfile bool `json:"allow_change_profile" description:"Members may change group name and avatar" example:"true"`
	AllowPinContent    bool `json:"allow_pin_content" description:"Members may pin messages, notes, and polls" example:"true"`
	AllowCreateNotes   bool `json:"allow_create_notes" description:"Members may create notes and reminders" example:"true"`
	AllowCreatePolls   bool `json:"allow_create_polls" description:"Members may create polls" example:"true"`
	AllowSendMessages  bool `json:"allow_send_messages" description:"Members may send chat messages" example:"true"`
}

// ChatUserLookupSDO is a UniWork user resolved by email for cross-workspace DM.
type ChatUserLookupSDO struct {
	UserID      string `json:"user_id" description:"UniWork user id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email       string `json:"email" description:"Account email" example:"colleague@example.com"`
	DisplayName string `json:"display_name" description:"Display name" example:"Nguyen Van A"`
}

// ChatBlockStatusSDO is the block relationship between caller and a peer.
type ChatBlockStatusSDO struct {
	BlockedByMe bool `json:"blocked_by_me" description:"Caller blocked the peer" example:"true"`
	BlockedMe   bool `json:"blocked_me" description:"Peer blocked the caller" example:"false"`
}

// ChatNicknameMapSDO is GET .../chat/nicknames.
type ChatNicknameMapSDO struct {
	Nicknames map[string]string `json:"nicknames" description:"Target user id to personal nickname"`
}

// ChatGifItemSDO is one GIF result for chat composer search.
type ChatGifItemSDO struct {
	ID         string `json:"id" description:"Provider gif id" example:"12345"`
	Label      string `json:"label" description:"Human-readable label" example:"thumbs up"`
	URL        string `json:"url" description:"Full gif url" example:"https://media.tenor.com/example.gif"`
	PreviewURL string `json:"preview_url" description:"Small preview url" example:"https://media.tenor.com/example-preview.gif"`
}

// ChatGifListSDO is GET .../chat/gifs/search or .../chat/gifs/trending.
type ChatGifListSDO struct {
	Items []ChatGifItemSDO `json:"items"`
}

// ChatMediaStatusSDO is GET .../chat/media/status.
type ChatMediaStatusSDO struct {
	TenorEnabled bool `json:"tenor_enabled" example:"true" description:"Tenor API key configured on server"`
}

// PendingVoiceInviteSDO is a ring invite waiting for the callee.
type PendingVoiceInviteSDO struct {
	RoomID     string `json:"room_id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	CallID     string `json:"call_id" description:"Active voice call id" example:"550e8400-e29b-41d4-a716-446655440000"`
	CallerID   string `json:"caller_id" description:"Caller user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CallerName string `json:"caller_name" description:"Caller display name" example:"Nguyen Van A"`
	CallKind   string `json:"call_kind" description:"dm or group" example:"dm"`
	RoomName   string `json:"room_name,omitempty" description:"Group room name when call_kind is group" example:"Team Alpha"`
	InvitedAt  string `json:"invited_at" description:"RFC3339 timestamp when the invite was sent" example:"2026-03-26T10:00:00Z"`
}

// ChatRoomMemberDTO is a member row for chat room moderation.
type ChatRoomMemberDTO struct {
	UserID         string `json:"user_id" description:"Member user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	Role           string `json:"role" description:"Chat room role: admin or member" example:"admin"`
	SendRestricted bool   `json:"send_restricted" description:"Read-only when true" example:"false"`
	Email          string `json:"email" description:"Account email" example:"member@example.com"`
	DisplayName    string `json:"display_name" description:"Display name" example:"Nguyen Van A"`
}

// ChatRoomMemberListSDO is GET .../rooms/{roomID}/members.
type ChatRoomMemberListSDO struct {
	Members []ChatRoomMemberDTO `json:"members"`
}

// ChatMessageLinkDTO is one link from a chat message to another entity.
type ChatMessageLinkDTO struct {
	ID         string `json:"id" description:"Link id" example:"01J8X4LNK0N1P2Q3R4S5T6U7V8"`
	MessageID  string `json:"message_id" description:"Chat message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	TargetType string `json:"target_type" description:"task in this release" example:"task"`
	TargetID   string `json:"target_id" description:"Target entity id" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
	Relation   string `json:"relation" description:"created_from or mentions" example:"mentions"`
	CreatedBy  string `json:"created_by" description:"User who created the link" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CreatedAt  string `json:"created_at" description:"RFC3339 timestamp" example:"2026-09-10T10:00:00Z"`
}

// ChatMessageLinkListSDO is GET .../chat/messages/{messageID}/links.
type ChatMessageLinkListSDO struct {
	Links []ChatMessageLinkDTO `json:"links"`
}
