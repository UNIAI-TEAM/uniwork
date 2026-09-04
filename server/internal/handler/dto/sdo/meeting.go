package sdo

type MeetingSDO struct {
	Meeting MeetingDTO `json:"meeting"`
}

type MeetingListSDO struct {
	Meetings []MeetingDTO `json:"meetings"`
	Total    int64        `json:"total" example:"12"`
}

type MeetingDTO struct {
	ID               string `json:"id" description:"ULID cuộc họp" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	WorkspaceID      string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Title            string `json:"title" example:"Standup tuần"`
	Description      string `json:"description" example:"Review sprint"`
	StartsAt         string `json:"starts_at" example:"2026-08-28T02:00:00Z"`
	EndsAt           string `json:"ends_at" example:"2026-08-28T02:30:00Z"`
	RoomName         string `json:"room_name" description:"Tên phòng opaque (legacy)" example:"uw_mtg_01J8X4MTGN1P2Q3R4S5T6U7V"`
	CreatedBy        string `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedAt        string `json:"created_at" example:"2026-08-28T02:00:00Z"`
	Status           string `json:"status" example:"SCHEDULED"`
	MeetingType      string `json:"meeting_type" example:"SCHEDULED"`
	HostUserID       string `json:"host_user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Timezone         string `json:"timezone" example:"UTC"`
	AllowJoinRequest bool   `json:"allow_join_request"`
	ProjectID        string `json:"project_id,omitempty"`
	ActualStartAt    string `json:"actual_start_at,omitempty"`
	ActualEndAt      string `json:"actual_end_at,omitempty"`
	Version          int32  `json:"version"`
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

type NoteSDO struct {
	Note NoteDTO `json:"note"`
}

type NoteListSDO struct {
	Notes []NoteDTO `json:"notes"`
}

type MeetingTokenSDO struct {
	Token string `json:"token" description:"JWT người tham gia LiveKit" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.example"`
	URL   string `json:"url" description:"URL WebSocket LiveKit" example:"wss://livekit.example.com"`
}

type JoinDecisionSDO struct {
	Decision            string `json:"decision" example:"ADMIT"`
	Reason              string `json:"reason,omitempty"`
	MeetingStatus       string `json:"meeting_status" example:"IN_PROGRESS"`
	ConferenceSessionID string `json:"conference_session_id,omitempty"`
	Provider            string `json:"provider,omitempty" example:"livekit"`
	ServerURL           string `json:"server_url,omitempty"`
	ParticipantToken    string `json:"participant_token,omitempty"`
	ExpiresAt           string `json:"expires_at,omitempty"`
	JoinRequestID       string `json:"join_request_id,omitempty"`
}

type ParticipantDTO struct {
	ID                  string `json:"id"`
	MeetingID           string `json:"meeting_id"`
	PrincipalType       string `json:"principal_type"`
	UserID              string `json:"user_id,omitempty"`
	GuestID             string `json:"guest_id,omitempty"`
	DisplayNameSnapshot string `json:"display_name_snapshot"`
	Role                string `json:"role"`
	Status              string `json:"status"`
}

type ParticipantListSDO struct {
	Participants []ParticipantDTO `json:"participants"`
}

type InvitationDTO struct {
	ID             string `json:"id"`
	MeetingID      string `json:"meeting_id"`
	ParticipantID  string `json:"participant_id"`
	ResponseStatus string `json:"response_status"`
}

type InvitationListSDO struct {
	Invitations []InvitationDTO `json:"invitations"`
}

type InviteLinkDTO struct {
	ID         string `json:"id"`
	MeetingID  string `json:"meeting_id"`
	Name       string `json:"name"`
	AccessMode string `json:"access_mode"`
	ExpiresAt  string `json:"expires_at"`
	MaxUses    *int32 `json:"max_uses,omitempty"`
	UsedCount  int32  `json:"used_count"`
	RevokedAt  string `json:"revoked_at,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
	Secret     string `json:"secret,omitempty"`
}

type InviteLinkSDO struct {
	InviteLink InviteLinkDTO `json:"invite_link"`
}

type InviteLinkListSDO struct {
	InviteLinks []InviteLinkDTO `json:"invite_links"`
}

type PublicInviteLinkSDO struct {
	LinkID     string `json:"link_id"`
	MeetingID  string `json:"meeting_id,omitempty"`
	Title      string `json:"title"`
	StartsAt   string `json:"starts_at"`
	AccessMode string `json:"access_mode"`
	Expired    bool   `json:"expired"`
}

type JoinRequestDTO struct {
	ID                  string `json:"id"`
	MeetingID           string `json:"meeting_id"`
	RequesterUserID     string `json:"requester_user_id,omitempty"`
	DisplayNameSnapshot string `json:"display_name_snapshot"`
	Status              string `json:"status"`
}

type JoinRequestListSDO struct {
	JoinRequests []JoinRequestDTO `json:"join_requests"`
}

type MeetingStatisticsSDO struct {
	Total              int64   `json:"total"`
	Scheduled          int64   `json:"scheduled"`
	InProgress         int64   `json:"in_progress"`
	Ended              int64   `json:"ended"`
	Canceled           int64   `json:"canceled"`
	Instant            int64   `json:"instant"`
	InvPending         int64   `json:"invitation_pending"`
	InvAccepted        int64   `json:"invitation_accepted"`
	InvDeclined        int64   `json:"invitation_declined"`
	InvTentative       int64   `json:"invitation_tentative"`
	JoinTotal          int64   `json:"join_request_total"`
	JoinApproved       int64   `json:"join_request_approved"`
	JoinRejected       int64   `json:"join_request_rejected"`
	AvgApprovalSeconds float64 `json:"avg_approval_seconds"`
	LinksCreated       int64   `json:"invite_links_created"`
	LinksUsed          int64   `json:"invite_links_used"`
	LinksRevoked       int64   `json:"invite_links_revoked"`
	LinksExpired       int64   `json:"invite_links_expired"`
}

type ActivityItemDTO struct {
	ID         string `json:"id"`
	EventType  string `json:"event_type"`
	ActorID    string `json:"actor_id"`
	FromState  string `json:"from_state,omitempty"`
	ToState    string `json:"to_state,omitempty"`
	OccurredAt string `json:"occurred_at"`
}

type ActivityListSDO struct {
	Activity []ActivityItemDTO `json:"activity"`
}

type TranscriptSegmentDTO struct {
	ID            string `json:"id"`
	MeetingID     string `json:"meeting_id"`
	ParticipantID string `json:"participant_id"`
	SpeakerName   string `json:"speaker_name"`
	Text          string `json:"text"`
	SpokenAt      string `json:"spoken_at" example:"2026-08-29T02:00:00Z"`
}

type TranscriptSegmentSDO struct {
	Segment TranscriptSegmentDTO `json:"segment"`
}

type TranscriptListSDO struct {
	Segments []TranscriptSegmentDTO `json:"segments"`
}

type ChatMessageDTO struct {
	ID             string `json:"id"`
	MeetingID      string `json:"meeting_id"`
	ParticipantID  string `json:"participant_id"`
	SenderIdentity string `json:"sender_identity"`
	SenderName     string `json:"sender_name"`
	Message        string `json:"message"`
	SentAt         string `json:"sent_at" example:"2026-08-29T02:00:00Z"`
}

type ChatMessageSDO struct {
	Message ChatMessageDTO `json:"message"`
}

type ChatListSDO struct {
	Messages []ChatMessageDTO `json:"messages"`
}

type SummaryActionItemDTO struct {
	Title string `json:"title"`
	Owner string `json:"owner"`
	Due   string `json:"due"`
}

type MeetingSummaryDTO struct {
	ID          string                 `json:"id"`
	MeetingID   string                 `json:"meeting_id"`
	Summary     string                 `json:"summary"`
	Decisions   []string               `json:"decisions"`
	ActionItems []SummaryActionItemDTO `json:"action_items"`
	Model       string                 `json:"model"`
	CreatedBy   string                 `json:"created_by"`
	CreatedAt   string                 `json:"created_at"`
}

type MeetingSummarySDO struct {
	Summary *MeetingSummaryDTO `json:"summary"`
}

type TaskIDListSDO struct {
	TaskIDs []string `json:"task_ids"`
}

type RecordingDTO struct {
	ID        string `json:"id"`
	MeetingID string `json:"meeting_id"`
	Status    string `json:"status" example:"ACTIVE"`
	FileURL   string `json:"file_url"`
	StartedBy string `json:"started_by"`
	StartedAt string `json:"started_at"`
	EndedAt   string `json:"ended_at"`
}

type RecordingSDO struct {
	Recording RecordingDTO `json:"recording"`
}

type RecordingListSDO struct {
	Recordings []RecordingDTO `json:"recordings"`
}

// MeetingCapabilitiesSDO tells the client which optional features to show.
type MeetingCapabilitiesSDO struct {
	AISummary bool `json:"ai_summary"`
	Recording bool `json:"recording"`
}
