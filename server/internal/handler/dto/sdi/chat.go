package sdi

// EnsureWorkspaceChatRoomSDI is POST /workspaces/{workspaceID}/chat/room.
type EnsureWorkspaceChatRoomSDI struct{}

// SendChatMessageSDI is POST /workspaces/{workspaceID}/chat/messages.
type SendChatMessageSDI struct {
	Body             string  `json:"body" description:"Message text" example:"Xin chào team!"`
	ReplyToMessageID *string `json:"reply_to_message_id,omitempty" description:"Optional message id to reply to" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
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
