package sdo

// ChatFollowUpDTO is one personal follow-up on a chat message.
type ChatFollowUpDTO struct {
	ID                string  `json:"id" description:"Follow-up id" example:"01J8X4FU0N1P2Q3R4S5T6U7V8"`
	OrganizationID    string  `json:"organization_id" description:"Organization id" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	WorkspaceID       string  `json:"workspace_id" description:"Workspace id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	RoomID            string  `json:"room_id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	MessageID         string  `json:"message_id" description:"Anchored chat message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	UserID            string  `json:"user_id" description:"Owner user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	Note              string  `json:"note" description:"Personal note" example:"Nhắc lại sau standup"`
	DueAt             *string `json:"due_at,omitempty" description:"RFC3339 due time" example:"2026-09-20T09:00:00Z"`
	CompletedAt       *string `json:"completed_at,omitempty" description:"RFC3339 when completed" example:"2026-09-19T15:00:00Z"`
	CreatedBy         string  `json:"created_by" description:"Creator user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CreatedByKind     string  `json:"created_by_kind" description:"human, agent, or system" example:"human"`
	CreatedAt         string  `json:"created_at" description:"RFC3339 created time" example:"2026-09-11T10:00:00Z"`
	UpdatedAt         string  `json:"updated_at" description:"RFC3339 updated time" example:"2026-09-11T10:00:00Z"`
	RoomKind          string  `json:"room_kind" description:"workspace, channel, group, or dm" example:"dm"`
	RoomName          string  `json:"room_name" description:"Stored room name (channels/groups); empty for workspace/dm" example:"dev"`
	RoomVisibility    string  `json:"room_visibility" description:"public or private for channels" example:"public"`
	PeerDisplayName   string  `json:"peer_display_name" description:"Other member display name for DM rooms" example:"Binh"`
	MessageBody       string  `json:"message_body" description:"Preview of the anchored message body" example:"Cần follow sau meeting"`
	MessageKind       string  `json:"message_kind" description:"Anchored message kind" example:"text"`
	MessageSenderID   string  `json:"message_sender_id" description:"Sender user id of the anchored message" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	MessageSenderName string  `json:"message_sender_name" description:"Sender display name of the anchored message" example:"Long"`
}

// ChatFollowUpSDO wraps a single follow-up.
type ChatFollowUpSDO struct {
	FollowUp ChatFollowUpDTO `json:"follow_up"`
}

// ChatFollowUpListSDO is GET .../chat/follow-ups.
type ChatFollowUpListSDO struct {
	FollowUps []ChatFollowUpDTO `json:"follow_ups"`
}
