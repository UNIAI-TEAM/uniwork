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
	CreatedAt         string           `json:"created_at" description:"RFC3339 timestamp" example:"2026-03-26T10:00:00Z"`
	Reactions         map[string]int   `json:"reactions,omitempty" description:"Emoji reaction counts keyed by emoji" example:"{\"👍\":2}"`
	VoiceCall         *VoiceCallLogDTO `json:"voice_call,omitempty" description:"Voice call log metadata when kind is voice_call_log"`
}

// ChatRoomDTO is a dm or group chat room.
type ChatRoomDTO struct {
	ID              string   `json:"id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	Kind            string   `json:"kind" description:"dm or group" example:"dm"`
	Name            string   `json:"name" description:"Room display name" example:"Nguyen Van A"`
	WorkspaceID     string   `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	MemberUserIDs   []string `json:"member_user_ids" description:"Other member user ids" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
	UnreadCount     int      `json:"unread_count" description:"Unread messages for the caller" example:"3"`
	PeerUserID      string   `json:"peer_user_id,omitempty" description:"DM peer user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	PeerEmail       string   `json:"peer_email,omitempty" description:"DM peer email" example:"peer@example.com"`
	PeerDisplayName string   `json:"peer_display_name,omitempty" description:"DM peer display name" example:"Nguyen Van A"`
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
