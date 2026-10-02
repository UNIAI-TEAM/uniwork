package sdo

type MeetingSDO struct {
	Meeting MeetingDTO `json:"meeting"`
}

type MeetingListSDO struct {
	Meetings []MeetingListItemDTO `json:"meetings"`
	Total    int64                `json:"total" example:"12"`
}

// MeetingListItemDTO is a list row: the meeting plus what the row needs to
// draw without a request of its own.
type MeetingListItemDTO struct {
	MeetingDTO
	HasPlayableRecording bool `json:"has_playable_recording" description:"Có ít nhất một bản ghi hình đã có file để xem lại"`
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
	QuorumPercent    *int16 `json:"quorum_percent" description:"Tỉ lệ có mặt tối thiểu (%), null = không yêu cầu" example:"60"`
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
	GuestSession        string `json:"guest_session,omitempty"`
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
	Standing            string `json:"standing" description:"MEMBER | OBSERVER" example:"MEMBER"`
	IsSecretary         bool   `json:"is_secretary"`
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
	LinkID       string `json:"link_id"`
	MeetingID    string `json:"meeting_id,omitempty"`
	Title        string `json:"title"`
	StartsAt     string `json:"starts_at"`
	AccessMode   string `json:"access_mode"`
	Expired      bool   `json:"expired" description:"Liên kết đã bị thu hồi hoặc hết hạn; giữ cho client cũ, client mới đọc link_state"`
	GuestSession string `json:"guest_session,omitempty"`
	LinkState    string `json:"link_state" description:"Trạng thái liên kết: active, expired, revoked hoặc exhausted (hết lượt, chỉ với AUTO_ADMIT)" example:"active"`
	MeetingState string `json:"meeting_state" description:"Cuộc họp còn vào được không: open, ended, canceled hoặc past_scheduled_end" example:"open"`
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
	Scheduled          int64   `json:"scheduled" description:"Cuộc họp SCHEDULED chưa qua giờ kết thúc dự kiến (ends_at >= now)"`
	Missed             int64   `json:"missed" description:"Cuộc họp SCHEDULED đã qua giờ kết thúc dự kiến mà chưa bắt đầu (ends_at < now)"`
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
	ID         string            `json:"id"`
	EventType  string            `json:"event_type"`
	ActorID    string            `json:"actor_id"`
	FromState  string            `json:"from_state,omitempty"`
	ToState    string            `json:"to_state,omitempty"`
	OccurredAt string            `json:"occurred_at"`
	Payload    map[string]string `json:"payload,omitempty" description:"Chỉ có ở MOTION_OPENED {title} và MOTION_CLOSED {title, outcome}"`
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

type MeetingChatMessageDTO struct {
	ID             string `json:"id"`
	MeetingID      string `json:"meeting_id"`
	ParticipantID  string `json:"participant_id"`
	SenderIdentity string `json:"sender_identity"`
	SenderName     string `json:"sender_name"`
	Message        string `json:"message"`
	SentAt         string `json:"sent_at" example:"2026-08-29T02:00:00Z"`
}

type MeetingChatMessageSDO struct {
	Message MeetingChatMessageDTO `json:"message"`
}

type MeetingChatListSDO struct {
	Messages []MeetingChatMessageDTO `json:"messages"`
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

// MeetingRecordingPlaybackSDO is a short-lived direct playback URL (S3 presigned).
type MeetingRecordingPlaybackSDO struct {
	PlaybackURL string `json:"playback_url" description:"Presigned URL for inline MP4 playback" example:"https://s3.example/meetings/rec.mp4?X-Amz-Signature=…"`
	ExpiresAt   string `json:"expires_at" description:"RFC3339 expiry of playback_url" example:"2026-09-15T11:00:00Z"`
}

// MeetingCapabilitiesSDO tells the client which optional features to show.
type MeetingCapabilitiesSDO struct {
	AISummary bool `json:"ai_summary"`
	Recording bool `json:"recording"`
	ServerSTT bool `json:"server_stt"`
}

type ParticipantSDO struct {
	Participant ParticipantDTO `json:"participant"`
}

type AttendanceRowDTO struct {
	ParticipantID       string `json:"participant_id"`
	PrincipalType       string `json:"principal_type" example:"USER"`
	UserID              string `json:"user_id,omitempty"`
	DisplayName         string `json:"display_name"`
	Standing            string `json:"standing" example:"MEMBER"`
	IsSecretary         bool   `json:"is_secretary"`
	Status              string `json:"status" description:"PRESENT | LATE | EXCUSED | ABSENT" example:"PRESENT"`
	Source              string `json:"source" description:"AUTO | MANUAL | SUGGESTED" example:"SUGGESTED"`
	Note                string `json:"note"`
	FirstJoinedAt       string `json:"first_joined_at,omitempty"`
	LastLeftAt          string `json:"last_left_at,omitempty"`
	InRoom              bool   `json:"in_room"`
	PresentSeconds      int64  `json:"present_seconds"`
	SessionCount        int32  `json:"session_count"`
	Removed             bool   `json:"removed" description:"true khi điểm danh đã chốt và người này đã bị gỡ khỏi cuộc họp sau khi được ghi nhận; vẫn được tính trong bản chốt"`
	JoinedAfterFinalize bool   `json:"joined_after_finalize" description:"true khi điểm danh đã chốt và người này được thêm sau đó (source SUGGESTED); không tính vào tổng số, tỉ lệ có mặt hay danh sách biểu quyết"`
}

type AttendanceSummaryDTO struct {
	Members   int   `json:"members"`
	Present   int   `json:"present"`
	Late      int   `json:"late"`
	Excused   int   `json:"excused"`
	Absent    int   `json:"absent"`
	QuorumMet *bool `json:"quorum_met" description:"null khi không đặt tỉ lệ hoặc chưa có thành viên"`
}

type AttendanceSDO struct {
	FinalizedAt   string               `json:"finalized_at,omitempty"`
	FinalizedBy   string               `json:"finalized_by,omitempty"`
	QuorumPercent *int16               `json:"quorum_percent"`
	Summary       AttendanceSummaryDTO `json:"summary"`
	Rows          []AttendanceRowDTO   `json:"rows"`
}

type MotionResultDTO struct {
	Yes      int    `json:"yes" example:"9"`
	No       int    `json:"no" example:"3"`
	Abstain  int    `json:"abstain" example:"2"`
	Required int    `json:"required" description:"Số phiếu tán thành tối thiểu để thông qua; 0 khi không có cử tri" example:"8"`
	Outcome  string `json:"outcome" description:"PASSED | FAILED" example:"PASSED"`
}

type MotionVotersDTO struct {
	Yes     []string `json:"yes" description:"Tên người tán thành (chỉ phiếu công khai)"`
	No      []string `json:"no"`
	Abstain []string `json:"abstain"`
}

type MyBallotDTO struct {
	OnRoll bool    `json:"on_roll" description:"Có trong danh sách cử tri chốt lúc mở"`
	Cast   bool    `json:"cast"`
	Choice *string `json:"choice" description:"null với phiếu kín hoặc khi chưa bỏ phiếu" example:"YES"`
}

type MotionDTO struct {
	ID           string           `json:"id"`
	Title        string           `json:"title" example:"Thông qua kế hoạch quý IV"`
	Description  string           `json:"description"`
	Position     int32            `json:"position" example:"1"`
	BallotMode   string           `json:"ballot_mode" description:"PUBLIC | SECRET" example:"SECRET"`
	Threshold    string           `json:"threshold" description:"MAJORITY | TWO_THIRDS" example:"MAJORITY"`
	Base         string           `json:"base" description:"PRESENT | ALL_MEMBERS" example:"PRESENT"`
	Status       string           `json:"status" description:"DRAFT | OPEN | CLOSED" example:"OPEN"`
	OpenedAt     string           `json:"opened_at,omitempty"`
	ClosedAt     string           `json:"closed_at,omitempty"`
	RollSize     *int32           `json:"roll_size" description:"Số cử tri chốt lúc mở; null khi còn nháp" example:"14"`
	TotalMembers *int32           `json:"total_members" description:"Tổng thành viên lúc mở; null khi còn nháp" example:"18"`
	CastCount    int              `json:"cast_count" example:"9"`
	Result       *MotionResultDTO `json:"result" description:"Chỉ có khi CLOSED; null khi đang mở, kể cả với chủ trì"`
	Voters       *MotionVotersDTO `json:"voters" description:"Chỉ có khi CLOSED và PUBLIC"`
	MyBallot     MyBallotDTO      `json:"my_ballot"`
}

type MotionListSDO struct {
	Motions []MotionDTO `json:"motions"`
}

type MotionSDO struct {
	Motion MotionDTO `json:"motion"`
}
