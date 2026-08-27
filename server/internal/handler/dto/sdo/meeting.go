package sdo

// MeetingSDO wraps one meeting.
type MeetingSDO struct {
	Meeting MeetingDTO `json:"meeting"`
}

// MeetingListSDO is GET /api/v1/workspaces/{workspaceID}/meetings.
type MeetingListSDO struct {
	Meetings []MeetingDTO `json:"meetings"`
}

type MeetingDTO struct {
	ID          string `json:"id" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	WorkspaceID string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Title       string `json:"title" example:"Standup tuần"`
	Description string `json:"description" example:"Review sprint"`
	StartsAt    string `json:"starts_at" example:"2026-08-28T02:00:00Z"`
	EndsAt      string `json:"ends_at" example:"2026-08-28T02:30:00Z"`
	RoomName    string `json:"room_name" description:"Tên phòng LiveKit" example:"mtg_01J8X4MTGN1P2Q3R4S5T6U7V"`
	CreatedBy   string `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

type NoteDTO struct {
	ID          string `json:"id" example:"01J8X4NOTE1P2Q3R4S5T6U7V8"`
	MeetingID   string `json:"meeting_id" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	AuthorID    string `json:"author_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Body        string `json:"body" example:"Quyết định ship vào thứ Sáu."`
	CreatedAt   string `json:"created_at" example:"2026-08-28T02:15:00Z"`
	DisplayName string `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
}

// NoteSDO wraps one meeting note.
type NoteSDO struct {
	Note NoteDTO `json:"note"`
}

// NoteListSDO is GET /api/v1/meetings/{meetingID}/notes.
type NoteListSDO struct {
	Notes []NoteDTO `json:"notes"`
}

// MeetingTokenSDO is POST /api/v1/meetings/{meetingID}/token.
type MeetingTokenSDO struct {
	Token string `json:"token" description:"JWT người tham gia LiveKit" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.example"`
	URL   string `json:"url" description:"URL WebSocket LiveKit" example:"wss://livekit.example.com"`
}
