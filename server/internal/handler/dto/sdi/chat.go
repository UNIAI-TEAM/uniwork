package sdi

// EnsureWorkspaceChatRoomSDI is POST /workspaces/{workspaceID}/chat/room.
type EnsureWorkspaceChatRoomSDI struct{}

// SendChatMessageSDI is POST /workspaces/{workspaceID}/chat/messages.
type SendChatMessageSDI struct {
	Body             string                 `json:"body" description:"Message text" example:"Xin chào team!"`
	ClientMsgID      string                 `json:"client_msg_id,omitempty" description:"Client-generated id for idempotent send/retries" example:"550e8400-e29b-41d4-a716-446655440000"`
	ReplyToMessageID *string                `json:"reply_to_message_id,omitempty" description:"Optional message id to reply to" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	Priority         string                 `json:"priority,omitempty" description:"important or urgent for the next text message" example:"important"`
	Poll             *CreateChatPollSDI     `json:"poll,omitempty" description:"Create a poll message instead of plain text"`
	Reminder         *CreateChatReminderSDI `json:"reminder,omitempty" description:"Create a reminder message instead of plain text"`
	Note             *CreateChatNoteSDI     `json:"note,omitempty" description:"Create a note message instead of plain text"`
}

// CreateChatPollSDI creates a poll in a chat room.
type CreateChatPollSDI struct {
	Question string              `json:"question" description:"Poll question" example:"Ăn trưa ở đâu?"`
	Options  []string            `json:"options" description:"Poll options (min 2)" example:"[\"Canteen\",\"Quán ngoài\"]"`
	Settings ChatPollSettingsSDI `json:"settings,omitempty" description:"Poll settings"`
}

// ChatPollSettingsSDI configures poll behavior.
type ChatPollSettingsSDI struct {
	DeadlineAt           *string `json:"deadline_at,omitempty" description:"RFC3339 deadline; omit for no deadline"`
	PinToTop             bool    `json:"pin_to_top,omitempty" description:"Pin poll to top of chat" example:"false"`
	AllowMultiple        bool    `json:"allow_multiple,omitempty" description:"Allow selecting multiple options" example:"true"`
	AllowAddOptions      bool    `json:"allow_add_options,omitempty" description:"Members may add options" example:"true"`
	HideResultsUntilVote bool    `json:"hide_results_until_vote,omitempty" description:"Hide results until the viewer votes" example:"false"`
	HideVoters           bool    `json:"hide_voters,omitempty" description:"Hide voter identities" example:"false"`
}

// VoteChatPollSDI is POST .../messages/{messageID}/poll/vote.
type VoteChatPollSDI struct {
	OptionID string `json:"option_id" description:"Selected poll option id" example:"01J8X4OPT0N1P2Q3R4S5T6U7V8"`
}

// CreateChatReminderSDI creates a reminder in a chat room.
type CreateChatReminderSDI struct {
	Body     string `json:"body" description:"Reminder content" example:"Họp sprint lúc 9h"`
	RemindAt string `json:"remind_at" description:"RFC3339 reminder time" example:"2026-09-05T09:00:00Z"`
	Repeat   string `json:"repeat,omitempty" description:"none, daily, weekly, or monthly" example:"none"`
}

// CreateChatNoteSDI creates a note in a chat room.
type CreateChatNoteSDI struct {
	Body     string `json:"body" description:"Note content" example:"Link tài liệu sprint"`
	PinToTop bool   `json:"pin_to_top,omitempty" description:"Pin note to top of chat" example:"false"`
}

// CreateGroupSDI is POST /workspaces/{workspaceID}/chat/groups.
type CreateGroupSDI struct {
	Name          string   `json:"name" description:"Group display name" example:"Team Alpha"`
	MemberUserIDs []string `json:"member_user_ids" description:"Other member UniWork user ids (min 2)" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\",\"01J8X4USR0N1P2Q3R4S5T6U7V9\"]"`
}

// ResolveDMSDI is POST /workspaces/{workspaceID}/chat/dm.
type ResolveDMSDI struct {
	UserID string `json:"user_id" description:"Target UniWork user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
}

// InviteGroupMembersSDI is POST /workspaces/{workspaceID}/chat/rooms/{roomID}/members.
type InviteGroupMembersSDI struct {
	MemberUserIDs []string `json:"member_user_ids" description:"User ids to invite" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
}

// MintChatVoiceTokenSDI is POST /chat/voice/token.
type MintChatVoiceTokenSDI struct {
	RoomID string `json:"room_id" description:"Native UniWork chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	CallID string `json:"call_id" description:"Active voice call id from invite" example:"550e8400-e29b-41d4-a716-446655440000"`
}

// VoiceSignalSDI is POST voice invite/hangup on a chat room.
type VoiceSignalSDI struct {
	CallID          string `json:"call_id" description:"Client-generated voice call id" example:"550e8400-e29b-41d4-a716-446655440000"`
	DurationSeconds *int   `json:"duration_seconds,omitempty" description:"Connected call duration in seconds (hangup only)" example:"125"`
}

// ToggleChatReactionSDI is POST .../messages/{messageID}/reactions.
type ToggleChatReactionSDI struct {
	Emoji string `json:"emoji" description:"Emoji to toggle" example:"👍"`
}

// EditChatMessageSDI is PATCH .../messages/{messageID}.
type EditChatMessageSDI struct {
	Body string `json:"body" description:"Updated message text" example:"Xin chào team! (đã sửa)"`
}

// PatchChatRoomMemberSDI is PATCH .../rooms/{roomID}/members/{userID}.
type PatchChatRoomMemberSDI struct {
	Role           *string `json:"role,omitempty" description:"Chat room role: admin or member" example:"admin"`
	SendRestricted *bool   `json:"send_restricted,omitempty" description:"When true, member may read but not send" example:"true"`
}

// PatchChatRoomSDI is PATCH .../rooms/{roomID}.
type PatchChatRoomSDI struct {
	Name              *string                       `json:"name,omitempty" description:"Group or workspace room display name" example:"Team Alpha"`
	MemberPermissions *ChatRoomMemberPermissionsSDI `json:"member_permissions,omitempty" description:"Permissions granted to regular members"`
}

// ChatRoomMemberPermissionsSDI configures what non-admin members may do.
type ChatRoomMemberPermissionsSDI struct {
	AllowChangeProfile *bool `json:"allow_change_profile,omitempty" description:"Members may change group name and avatar" example:"true"`
	AllowPinContent    *bool `json:"allow_pin_content,omitempty" description:"Members may pin messages, notes, and polls" example:"true"`
	AllowCreateNotes   *bool `json:"allow_create_notes,omitempty" description:"Members may create notes and reminders" example:"true"`
	AllowCreatePolls   *bool `json:"allow_create_polls,omitempty" description:"Members may create polls" example:"true"`
	AllowSendMessages  *bool `json:"allow_send_messages,omitempty" description:"Members may send chat messages" example:"true"`
}

// SetChatNicknameSDI is PUT .../users/{userID}/nickname.
type SetChatNicknameSDI struct {
	Nickname string `json:"nickname" description:"Personal nickname visible only to caller; empty removes it" example:"Long đẹp trai"`
}
