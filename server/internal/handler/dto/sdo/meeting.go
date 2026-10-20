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
	ScribeEnabled    bool   `json:"scribe_enabled" description:"Thư ký AI bật cho cuộc họp này (mặc định bật; chủ trì/admin tắt được)"`
	ScribeStatus     string `json:"scribe_status,omitempty" description:"Trạng thái lần chạy mới nhất của thư ký AI (chỉ có ở GET chi tiết): DISPATCHED | ACTIVE | FINISHED | FAILED" example:"ACTIVE"`
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
	SharedMic           bool   `json:"shared_mic" description:"Mic của người này là micro hội trường: thư ký AI tách người nói"`
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
	SpeakerName   string `json:"speaker_name" description:"Tên người nói; dòng micro hội trường chưa gán có tên tiếng Việt dựng sẵn, client nên dùng room_speaker"`
	Text          string `json:"text"`
	SpokenAt      string `json:"spoken_at" example:"2026-08-29T02:00:00Z"`
	SpeakerLabel  string `json:"speaker_label,omitempty" description:"Chỉ dòng micro hội trường chưa gán người nói: nhãn thô; kết thúc bằng :? khi không rõ người nói" example:"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V:AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-1:A"`
	RoomSpeaker   int32  `json:"room_speaker,omitempty" description:"Số thứ tự người nói của micro hội trường trong cuộc họp (Người nói n); 0 khi không rõ" example:"2"`
	// Parent spec §6.4 (UNI-2001): where the line came from and, for the
	// scribe and uploads, its place in the audio.
	Source          string `json:"source" enum:"CAPTION,AGENT,TRANSCRIPTION" description:"CAPTION = phụ đề trình duyệt; AGENT = thư ký AI; TRANSCRIPTION = ghi lời file tải lên" example:"TRANSCRIPTION"`
	TranscriptionID string `json:"transcription_id,omitempty" description:"Lần ghi lời sinh ra dòng này (source TRANSCRIPTION)" example:"01JA09K3N1P2Q3R4S5T6U7V8"`
	StartMs         *int32 `json:"start_ms,omitempty" description:"Mốc bắt đầu (ms) trong tệp với TRANSCRIPTION, tính từ giờ bắt đầu thực tế với AGENT" example:"61500"`
	EndMs           *int32 `json:"end_ms,omitempty" description:"Mốc kết thúc (ms), cùng gốc với start_ms" example:"64200"`
}

type TranscriptSegmentSDO struct {
	Segment TranscriptSegmentDTO `json:"segment"`
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

type SummaryActionItemDTO struct {
	Title string `json:"title"`
	Owner string `json:"owner"`
	Due   string `json:"due"`
}

// MeetingSummaryActionItemDTO is one action item of a meeting summary with
// what the server suggests for it and the task it already became.
type MeetingSummaryActionItemDTO struct {
	Index               int     `json:"index" description:"Vị trí trong action_items; gửi lại ở POST .../summary/tasks" example:"0"`
	Title               string  `json:"title" example:"Gửi báo cáo sprint"`
	Owner               string  `json:"owner" description:"Tên người phụ trách AI ghi" example:"Minh"`
	Due                 string  `json:"due" description:"Hạn AI ghi, nguyên văn" example:"thứ Sáu"`
	SuggestedAssigneeID *string `json:"suggested_assignee_id,omitempty" description:"Thành viên workspace duy nhất khớp tên AI ghi; vắng khi không ai hoặc nhiều người khớp" example:"01JABC1234567890ABCDEFGH"`
	DueDate             *string `json:"due_date,omitempty" description:"Hạn AI ghi đọc theo ngày họp (YYYY-MM-DD); vắng khi không đọc được" example:"2026-09-04"`
	TaskID              *string `json:"task_id,omitempty" description:"Task đã tạo từ việc này của bản tóm tắt này, khi task còn tồn tại" example:"01JABC1234567890ABCDEFGH"`
}

type MeetingSummaryDTO struct {
	ID          string                        `json:"id"`
	MeetingID   string                        `json:"meeting_id"`
	Summary     string                        `json:"summary"`
	Decisions   []string                      `json:"decisions"`
	ActionItems []MeetingSummaryActionItemDTO `json:"action_items"`
	Model       string                        `json:"model"`
	CreatedBy   string                        `json:"created_by"`
	CreatedAt   string                        `json:"created_at"`
	Partial     bool                          `json:"partial" description:"Tóm tắt dựa trên một phần cuộc họp: transcript dài hơn ngân sách đầu vào"`
}

type MeetingSummarySDO struct {
	Summary *MeetingSummaryDTO `json:"summary"`
}

// SummaryTaskLinkDTO pairs a converted action item with its new task.
type SummaryTaskLinkDTO struct {
	Index  int    `json:"index" example:"0"`
	TaskID string `json:"task_id" example:"01JABC1234567890ABCDEFGH"`
}

// MeetingSummaryTasksSDO answers POST /api/v1/meetings/{meetingID}/summary/tasks.
type MeetingSummaryTasksSDO struct {
	TaskIDs []string             `json:"task_ids" description:"Task đã tạo, theo thứ tự gửi lên"`
	Items   []SummaryTaskLinkDTO `json:"items" description:"Việc nào thành task nào, theo thứ tự gửi lên"`
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
	Scribe    bool `json:"scribe" description:"Thư ký AI (agent ghi lời) có cho workspace này: server chạy agent, cờ meeting_scribe bật, gói có meeting.transcription"`
	// Transcription: uploads may be transcribed in batch (UNI-2001).
	Transcription bool `json:"transcription" description:"Ghi lời file ghi âm tải lên có cho workspace này: có nhà cung cấp, cờ meeting_transcription bật, gói có meeting.transcription"`
}

// MeetingAgentContextSDO is what the scribe agent turns into STT keyterms.
type MeetingAgentContextSDO struct {
	MeetingTitle        string   `json:"meeting_title" example:"Giao ban tuần"`
	WorkspaceName       string   `json:"workspace_name" example:"Phòng Kế hoạch"`
	ProjectName         string   `json:"project_name" example:"Dự án Cầu Rồng"`
	Locale              string   `json:"locale" example:"vi"`
	ParticipantNames    []string `json:"participant_names" description:"Tên hiển thị của người được mời và người tham gia; không có email" example:"[\"Nguyễn Văn An\"]"`
	SharedMicIdentities []string `json:"shared_mic_identities" description:"Identity LiveKit của người tham gia đang là micro hội trường: agent tách người nói trên track của họ" example:"[\"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V\"]"`
}

// MeetingAgentSegmentsSDO counts a batch: new rows and ones already stored.
type MeetingAgentSegmentsSDO struct {
	Accepted   int `json:"accepted" example:"18"`
	Duplicates int `json:"duplicates" example:"2"`
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

// SpeakerLabelDTO is one speaker label of a meeting's transcript (shared
// microphone or uploaded file) and whom a clerk assigned it to.
type SpeakerLabelDTO struct {
	ID            string `json:"id" example:"01J8X4SPKL0N1P2Q3R4S5T6U7"`
	LabelKey      string `json:"label_key" description:"<participant_identity>:<phiên STT>:<nhãn> hoặc upload:<transcription_id>:<nhãn>" example:"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V:AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-1:A"`
	Speaker       string `json:"speaker" description:"Nhãn của nhà cung cấp (phần cuối label_key); chỉ đúng trong một phiên STT" example:"A"`
	Number        int32  `json:"number" description:"Số thứ tự trong cuộc họp theo lần xuất hiện đầu: Hội trường · Người nói n" example:"2"`
	UserID        string `json:"user_id,omitempty" description:"Thành viên được gán" example:"01J8X4USER0N1P2Q3R4S5T6U7"`
	Name          string `json:"name,omitempty" description:"Tên tự do được gán" example:"Chị Lan"`
	AssignedName  string `json:"assigned_name,omitempty" description:"Tên transcript hiện cho nhãn: tên hiển thị của thành viên hoặc tên tự do; trống khi chưa gán" example:"Chị Lan"`
	Sample        string `json:"sample,omitempty" description:"Câu đầu tiên của nhãn, để nhận ra người nói" example:"Chốt ship vào thứ Sáu."`
	FirstSpokenAt string `json:"first_spoken_at,omitempty" example:"2026-10-20T02:00:01Z"`
}

type SpeakerLabelListSDO struct {
	Labels []SpeakerLabelDTO `json:"labels"`
}

type SpeakerLabelSDO struct {
	Label SpeakerLabelDTO `json:"label"`
}

// MeetingTranscriptionDTO is one transcription of one uploaded recording
// (UNI-2001, parent spec §5.3).
type MeetingTranscriptionDTO struct {
	ID           string `json:"id" example:"01JA09K3N1P2Q3R4S5T6U7V8"`
	MeetingID    string `json:"meeting_id" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	FileID       string `json:"file_id" example:"01JA09K3N1P2Q3R4S5T6U7V9"`
	Filename     string `json:"filename" example:"hop-chi-bo.m4a"`
	SizeBytes    int64  `json:"size_bytes" example:"28800000"`
	Language     string `json:"language" enum:"vi,en" example:"vi"`
	Status       string `json:"status" enum:"QUEUED,RUNNING,COMPLETE,FAILED" example:"RUNNING"`
	ErrorCode    string `json:"error_code,omitempty" enum:"file_unavailable,provider_error,timeout" description:"Lý do của lần thử gần nhất bị lỗi; với FAILED là lý do cuối" example:"provider_error"`
	Attempts     int32  `json:"attempts" description:"Số lần đã gửi nhà cung cấp (tối đa 3)" example:"1"`
	StartsAt     string `json:"starts_at" description:"Giờ thật ứng với giây 0 của tệp" example:"2026-10-20T01:30:00Z"`
	AudioSeconds int32  `json:"audio_seconds,omitempty" description:"Thời lượng đã tính phí, có khi COMPLETE" example:"3600"`
	CreatedBy    string `json:"created_by" example:"01J8X4USER0N1P2Q3R4S5T6U7"`
	CreatedAt    string `json:"created_at" example:"2026-10-20T04:00:00Z"`
	CompletedAt  string `json:"completed_at,omitempty" example:"2026-10-20T04:20:00Z"`
}

type MeetingTranscriptionSDO struct {
	Transcription MeetingTranscriptionDTO `json:"transcription"`
}

type MeetingTranscriptionListSDO struct {
	Transcriptions []MeetingTranscriptionDTO `json:"transcriptions" description:"Mới nhất trước, tối đa 100"`
}
