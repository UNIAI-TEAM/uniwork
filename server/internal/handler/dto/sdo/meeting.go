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
	HasPlayableRecording bool     `json:"has_playable_recording" description:"Có ít nhất một bản ghi hình đã có file để xem lại"`
	InRoomUserIDs        []string `json:"in_room_user_ids,omitempty" description:"Cuộc họp đang diễn ra: tối đa 3 user id thành viên đang trong phòng, ai vào trước đứng trước" example:"[\"01J8X4K2M0N1P2Q3R4S5T6U7V8\"]"`
	InRoomCount          int32    `json:"in_room_count,omitempty" description:"Cuộc họp đang diễn ra: số người đang trong phòng, kể cả khách" example:"5"`
	ScribeLive           bool     `json:"scribe_live,omitempty" description:"Cuộc họp đang diễn ra: Thư ký UNI đang ghi (lần chạy mới nhất ACTIVE)" example:"true"`
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
	Venue            string `json:"venue" enum:"online,in_person" description:"Hình thức: online có phòng họp; in_person ghi âm tại phòng" example:"online"`
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
	AIContentShared  bool   `json:"ai_content_shared" description:"Chủ trì hoặc thư ký đã chia sẻ nội dung AI (transcript, tóm tắt, trích dẫn, tóm tắt cho người vào muộn) với cả workspace; false = chỉ người của cuộc họp đọc được"`
	// AIContentReadable is per caller, so only the detail GET and the
	// sharing switch carry it.
	AIContentReadable *bool `json:"ai_content_readable,omitempty" description:"Chỉ có ở GET chi tiết và PUT ai-sharing: người gọi đọc được nội dung AI của cuộc họp (chủ trì, thư ký, người được mời/được nhận vào chưa bị gỡ, quản trị workspace; hoặc cuộc họp đã chia sẻ)"`
	// The series neighbours are read only by the detail GET (UNI-2153).
	SeriesID          string `json:"series_id,omitempty" description:"Chỉ có ở GET chi tiết: id cuộc họp gốc của chuỗi, khi cuộc họp này là cuộc tiếp nối" example:"01J8X4MTGN1P2Q3R4S5T6U7A"`
	PreviousMeetingID string `json:"previous_meeting_id,omitempty" description:"Chỉ có ở GET chi tiết: cuộc họp chưa hủy gần nhất của cùng chuỗi, bắt đầu trước cuộc này" example:"01J8X4MTGN1P2Q3R4S5T6U7A"`
	NextMeetingID     string `json:"next_meeting_id,omitempty" description:"Chỉ có ở GET chi tiết: cuộc họp chưa hủy sớm nhất của cùng chuỗi, bắt đầu sau cuộc này" example:"01J8X4MTGN1P2Q3R4S5T6U7C"`
}

type NoteDTO struct {
	ID          string  `json:"id" example:"01J8X4NOTE1P2Q3R4S5T6U7V8"`
	MeetingID   string  `json:"meeting_id" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	AuthorID    string  `json:"author_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Body        string  `json:"body" example:"Quyết định ship vào thứ Sáu."`
	CreatedAt   string  `json:"created_at" example:"2026-08-28T02:15:00Z"`
	EditedAt    *string `json:"edited_at" description:"Lần sửa gần nhất; null khi chưa từng sửa" example:"2026-08-28T02:20:00Z"`
	DisplayName string  `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string  `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
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
	InRoom              bool   `json:"in_room" description:"Người này đang có mặt trong phòng (có phiên điểm danh đang mở)" example:"true"`
	IsHost              bool   `json:"is_host" description:"Ghế của chủ trì hiện tại: khách, vốn không đọc cuộc họp, theo đó nhận lệnh tắt mic; chỉ có trong danh sách người tham dự" example:"false"`
	RemovedBy           string `json:"removed_by,omitempty" description:"Người đã mời người này ra khỏi cuộc họp; không trả cho khách" example:"01J9Z3D4QH8M2X7N5K1C6V0B9A"`
	RemovedAt           string `json:"removed_at,omitempty" description:"Lúc người này bị mời ra (RFC 3339)" example:"2026-10-27T08:52:00Z"`
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
	Secret     string `json:"secret,omitempty" description:"Mã bí mật của liên kết: luôn có lúc tạo; ở GET danh sách chỉ có với liên kết còn hiệu lực có mã suy ra từ id" example:"q8Jd0xZ3c1v7bN2mK5pR9tW4yA6eH0uL3sF8gD1jC2o"`
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
	Scribe       bool   `json:"scribe" description:"Thư ký AI sẽ ghi lời cuộc họp này (bật cho cuộc họp và có cho tổ chức): trang mời báo cho khách trước khi vào" example:"true"`
	StartedAt    string `json:"started_at,omitempty" description:"Lúc cuộc họp thực sự bắt đầu (RFC 3339); trống khi chưa bắt đầu" example:"2026-10-27T08:40:00Z"`
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
	Language        string `json:"language,omitempty" description:"Ngôn ngữ của dòng (vi, en) khi nguồn cho biết" example:"vi"`
	EditedAt        string `json:"edited_at,omitempty" description:"RFC3339: lần thư ký sửa gần nhất; vắng khi chưa sửa. Nguyên văn không trả về" example:"2026-10-21T05:00:00Z"`
}

// TranscriptDeletedSDO answers DELETE /meetings/{meetingID}/transcript.
type TranscriptDeletedSDO struct {
	Deleted int64 `json:"deleted" description:"Số dòng đã xoá" example:"42"`
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

// MeetingEvidenceRefDTO names one input line a decision or an action item rests on.
type MeetingEvidenceRefDTO struct {
	Kind string `json:"kind" enum:"segment,note,chat" description:"segment = đoạn transcript, note = ghi chú, chat = tin nhắn trong phòng" example:"segment"`
	ID   string `json:"id" example:"01J8X4SEG0000000000000000"`
}

// MeetingSummaryDecisionDTO is one decision of a summary with its evidence.
type MeetingSummaryDecisionDTO struct {
	Text     string                  `json:"text" example:"Phát hành vào thứ Sáu"`
	Evidence []MeetingEvidenceRefDTO `json:"evidence" description:"Căn cứ; rỗng với bản tóm tắt trước meeting_summary@5"`
}

// MeetingEvidenceSourceDTO is one cited line as the reader sees it.
type MeetingEvidenceSourceDTO struct {
	Kind   string `json:"kind" enum:"segment,note,chat" example:"segment"`
	ID     string `json:"id" example:"01J8X4SEG0000000000000000"`
	Author string `json:"author" description:"Người nói, người ghi hoặc người gửi" example:"Lan"`
	Text   string `json:"text" example:"Chốt phát hành thứ Sáu"`
	At     string `json:"at" description:"Lúc nói, ghi hoặc gửi (RFC 3339)" example:"2026-10-20T02:15:00Z"`
}

// MeetingEvidenceSDO answers GET /api/v1/meetings/{meetingID}/evidence.
type MeetingEvidenceSDO struct {
	Items []MeetingEvidenceSourceDTO `json:"items" description:"Theo thứ tự hỏi; căn cứ không còn hoặc không thuộc cuộc họp thì vắng"`
}

type MeetingSummaryDTO struct {
	ID        string                      `json:"id"`
	MeetingID string                      `json:"meeting_id"`
	Summary   string                      `json:"summary"`
	Decisions []MeetingSummaryDecisionDTO `json:"decisions"`
	Model     string                      `json:"model"`
	CreatedBy string                      `json:"created_by"`
	// CreatedByKind is system for the summary made when the meeting ended (UNI-2026).
	CreatedByKind string `json:"created_by_kind" enum:"human,agent,system" description:"system = tóm tắt tự tạo khi họp xong" example:"system"`
	CreatedAt     string `json:"created_at"`
	Partial       bool   `json:"partial" description:"Tóm tắt dựa trên một phần cuộc họp: transcript dài hơn ngân sách đầu vào"`
	// UNI-1995 #5: the transcript was corrected, cut or replaced after this
	// summary was made; a clerk may regenerate it.
	TranscriptChangedAt *string `json:"transcript_changed_at,omitempty" description:"RFC3339: lời thoại đã được sửa, xoá hoặc thay sau khi tóm tắt này được tạo; vắng khi chưa" example:"2026-10-21T05:00:00Z"`
	// Topics and OpenQuestions are meeting_summary@7's; empty before it.
	Topics        []MeetingSummaryTopicDTO    `json:"topics" description:"Các chủ đề theo thứ tự được bàn (meeting_summary@7); rỗng với bản tóm tắt cũ"`
	OpenQuestions []MeetingSummaryDecisionDTO `json:"open_questions" description:"Câu hỏi còn bỏ ngỏ, mỗi câu kèm căn cứ (meeting_summary@7)"`
	// SummaryPoints are meeting_summary@8's; Summary is them joined.
	SummaryPoints []MeetingSummaryDecisionDTO `json:"summary_points" description:"Đoạn tóm tắt tách thành 2–6 câu, mỗi câu kèm căn cứ (meeting_summary@8); summary là các câu này ghép lại; rỗng với bản tóm tắt cũ"`
}

// MeetingSummaryTopicDTO is one topic of a summary: where it starts in the
// transcript and its key points with their evidence.
type MeetingSummaryTopicDTO struct {
	Title   string                      `json:"title" example:"Ngân sách quý IV"`
	Start   *MeetingEvidenceRefDTO      `json:"start" description:"Đoạn transcript chủ đề bắt đầu; null khi không có"`
	StartAt *string                     `json:"start_at" description:"RFC 3339: lúc đoạn bắt đầu được nói; null khi không có" example:"2026-10-20T02:15:00Z"`
	Points  []MeetingSummaryDecisionDTO `json:"points" description:"Ý chính của chủ đề, mỗi ý kèm căn cứ"`
}

// MeetingSummaryRunDTO says whether a summary is being made.
type MeetingSummaryRunDTO struct {
	Status   string  `json:"status" enum:"idle,queued,running" description:"running = đang tạo; queued = hệ thống sẽ tự tạo (chờ dòng cuối hoặc chờ thử lại); idle = không có lần tạo nào" example:"running"`
	At       *string `json:"at" description:"RFC 3339: lúc bắt đầu (running) hoặc lúc đến hạn (queued); null khi idle" example:"2026-10-20T02:15:00Z"`
	Attempts int     `json:"attempts" description:"Số lần hệ thống đã thử tự tạo" example:"1"`
	// UNI-1995 #12: a clerk's run outlives its request, so its failure is read here.
	Failure *MeetingSummaryRunFailureDTO `json:"failure" description:"Lần tạo gần nhất hỏng (mã lỗi như POST trả); null khi không có hoặc đã có lần tạo mới"`
}

// MeetingSummaryRunFailureDTO is the last summary run's failure.
type MeetingSummaryRunFailureDTO struct {
	Code string `json:"code" description:"Mã lỗi như POST .../summary trả: ai_failed, ai_timeout, ai_rate_limited, ai_quota_exceeded, summary_no_source, …" example:"ai_timeout"`
	At   string `json:"at" description:"RFC 3339: lúc lần tạo hỏng" example:"2026-10-20T02:16:00Z"`
}

// MeetingSettingsSDO is the organization's meeting settings (UNI-2026).
type MeetingSettingsSDO struct {
	OrganizationID     string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	AutoSummaryEnabled bool    `json:"auto_summary_enabled" description:"Hệ thống tự tạo tóm tắt khi cuộc họp kết thúc" example:"true"`
	ScribePolicy       string  `json:"scribe_policy" description:"Chính sách thư ký AI: on | opt_in | off" example:"on"`
	UpdatedBy          *string `json:"updated_by,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind      *string `json:"updated_by_kind,omitempty" description:"human, agent hoặc system" example:"human"`
	UpdatedAt          *string `json:"updated_at,omitempty" example:"2026-10-21T09:00:00Z"`
	// UNI-1995 #5.
	TranscriptRetentionDays *int32 `json:"transcript_retention_days" description:"Số ngày giữ lời thoại và file ghi âm tải lên; null = giữ mãi" example:"90"`
}

// MeetingCatchUpPointDTO is one key point of a late joiner's brief and the
// stretch of speech it came from.
type MeetingCatchUpPointDTO struct {
	Text      string  `json:"text" description:"Ý chính" example:"Chốt demo vào thứ Sáu"`
	SegmentID string  `json:"segment_id,omitempty" description:"Đoạn lời đầu tiên của quãng nói chứa ý này; trống khi ý lấy từ ghi chú" example:"01K7SEG00000000000000000001"`
	SpokenAt  *string `json:"spoken_at,omitempty" description:"RFC3339: lúc đoạn lời đó được nói" example:"2026-10-21T02:05:00Z"`
}

// MeetingCatchUpItemDTO is a follow-up people agreed on, pointed like a point.
type MeetingCatchUpItemDTO struct {
	Title     string  `json:"title" example:"Gửi bản demo cho khách"`
	Owner     string  `json:"owner,omitempty" example:"An"`
	Due       string  `json:"due,omitempty" example:"thứ Sáu"`
	SegmentID string  `json:"segment_id,omitempty" example:"01K7SEG00000000000000000001"`
	SpokenAt  *string `json:"spoken_at,omitempty" example:"2026-10-21T02:05:00Z"`
}

// MeetingCatchUpSDO is POST /api/v1/meetings/{meetingID}/catch-up.
type MeetingCatchUpSDO struct {
	Summary     string                   `json:"summary" example:"Nhóm đã chốt lịch demo và bàn ngân sách quý IV."`
	Highlights  []MeetingCatchUpPointDTO `json:"highlights"`
	ActionItems []MeetingCatchUpItemDTO  `json:"action_items"`
	GeneratedAt string                   `json:"generated_at" description:"RFC3339: lúc bản tóm tắt được tạo (dùng chung tối đa 2 phút)" example:"2026-10-21T02:25:00Z"`
	Partial     bool                     `json:"partial" description:"Phần lời cũ nhất không vừa ngân sách và bị bỏ"`
}

type MeetingSummarySDO struct {
	Summary *MeetingSummaryDTO   `json:"summary"`
	Run     MeetingSummaryRunDTO `json:"run" description:"Tóm tắt có đang được tạo không (UNI-1995)"`
}

// MeetingActionItemTaskDTO is the live task a converted action item became.
type MeetingActionItemTaskDTO struct {
	ID         string  `json:"id" example:"01JABC1234567890ABCDEFGH"`
	Title      string  `json:"title" example:"Gửi báo cáo sprint"`
	Status     string  `json:"status" description:"Khoá trạng thái task" example:"todo"`
	Done       bool    `json:"done" description:"Trạng thái thuộc nhóm done hoặc cancelled" example:"false"`
	Overdue    bool    `json:"overdue" description:"Chưa xong và quá hạn (theo múi giờ cuộc họp)" example:"true"`
	AssigneeID *string `json:"assignee_id" example:"01JABC1234567890ABCDEFGH"`
	DueDate    *string `json:"due_date" description:"YYYY-MM-DD" example:"2026-10-30"`
}

// MeetingActionItemDTO is one action item of a meeting with its derived state.
type MeetingActionItemDTO struct {
	ID                  string                    `json:"id" example:"01J8X4ACTN1P2Q3R4S5T6U7V"`
	Source              string                    `json:"source" enum:"AI,MANUAL,LIVE" description:"AI = bản tóm tắt đề xuất, MANUAL = clerk thêm tay, LIVE = thư ký AI rút trong lúc họp" example:"AI"`
	Position            int                       `json:"position" example:"0"`
	Title               string                    `json:"title" example:"Gửi báo cáo sprint"`
	OwnerText           string                    `json:"owner_text" description:"Người phụ trách như được nhắc, nguyên văn" example:"anh Hùng"`
	DueText             string                    `json:"due_text" description:"Hạn như được nhắc, nguyên văn" example:"thứ sáu tuần sau"`
	Description         string                    `json:"description" description:"Mô tả văn xuôi AI viết lại từ nội dung họp (meeting_summary@6+); rỗng khi không có" example:"Tổng hợp tiến độ sprint và gửi cho khách trước buổi demo để khách duyệt phạm vi."`
	SuggestedPriority   string                    `json:"suggested_priority" description:"Mức độ AI gợi ý khi cuộc họp nêu rõ: low, medium, high hoặc urgent; rỗng khi không có" example:"high"`
	SuggestedAssigneeID *string                   `json:"suggested_assignee_id" description:"Thành viên duy nhất khớp tên được nhắc; chỉ với việc chờ xử lý" example:"01JABC1234567890ABCDEFGH"`
	SuggestedDueDate    *string                   `json:"suggested_due_date" description:"Hạn được nhắc đọc theo ngày họp (YYYY-MM-DD); chỉ với việc chờ xử lý" example:"2026-10-30"`
	SuggestedDueGuessed bool                      `json:"suggested_due_guessed" description:"true khi suggested_due_date được đoán từ lời nói lỏng (\"thứ Hai\", \"tuần sau\"), không phải ngày viết rõ" example:"true"`
	Status              string                    `json:"status" enum:"PENDING,CONVERTED,DISMISSED" example:"PENDING"`
	DismissReason       string                    `json:"dismiss_reason" example:""`
	DismissedBy         *string                   `json:"dismissed_by" example:"01JABC1234567890ABCDEFGH"`
	DismissedAt         *string                   `json:"dismissed_at" example:"2026-10-20T08:00:00Z"`
	Task                *MeetingActionItemTaskDTO `json:"task" description:"Task đã tạo; chỉ với việc đã giao"`
	Evidence            []MeetingEvidenceRefDTO   `json:"evidence" description:"Căn cứ của việc AI; rỗng với việc thêm tay"`
	SummaryID           *string                   `json:"summary_id" description:"Bản tóm tắt đề xuất việc; null với việc tay" example:"01JABC1234567890ABCDEFGH"`
	CreatedAt           string                    `json:"created_at" example:"2026-10-20T08:00:00Z"`
}

// MeetingActionItemCountsDTO heads the meeting's "after the meeting" section.
type MeetingActionItemCountsDTO struct {
	Pending      int `json:"pending" example:"3"`
	Converted    int `json:"converted" example:"5"`
	Dismissed    int `json:"dismissed" example:"1"`
	TasksDone    int `json:"tasks_done" example:"2"`
	TasksOverdue int `json:"tasks_overdue" example:"1"`
}

// MeetingActionItemsSDO answers GET /api/v1/meetings/{meetingID}/action-items.
type MeetingActionItemsSDO struct {
	Items  []MeetingActionItemDTO     `json:"items"`
	Counts MeetingActionItemCountsDTO `json:"counts"`
}

// MeetingCarriedOverMeetingDTO is the earlier meeting a carried-over task came from.
type MeetingCarriedOverMeetingDTO struct {
	ID        string `json:"id" example:"01J8X4MTNG1P2Q3R4S5T6U7V"`
	Title     string `json:"title" example:"Giao ban tuần 42"`
	StartedAt string `json:"started_at" description:"Giờ bắt đầu thực tế, chưa có thì theo lịch (RFC 3339)" example:"2026-10-13T02:00:00Z"`
}

// MeetingCarriedOverItemDTO is a converted item of an earlier meeting whose task is still open.
type MeetingCarriedOverItemDTO struct {
	ActionItemID string                       `json:"action_item_id" example:"01J8X4ACTN1P2Q3R4S5T6U7V"`
	Meeting      MeetingCarriedOverMeetingDTO `json:"meeting"`
	Task         MeetingActionItemTaskDTO     `json:"task"`
}

// MeetingCarriedOverItemsSDO answers GET /api/v1/meetings/{meetingID}/carried-over-items.
type MeetingCarriedOverItemsSDO struct {
	Items []MeetingCarriedOverItemDTO `json:"items"`
	Total int                         `json:"total" description:"Tổng số việc mang sang, kể cả phần ngoài trang (tối đa 100 mục mỗi trang)" example:"3"`
}

// MeetingActionItemSDO answers POST /api/v1/meetings/{meetingID}/action-items.
type MeetingActionItemSDO struct {
	Item MeetingActionItemDTO `json:"item"`
}

// ActionItemLinkDTO pairs a converted action item with its new task.
type ActionItemLinkDTO struct {
	ActionItemID string `json:"action_item_id" example:"01J8X4ACTN1P2Q3R4S5T6U7V"`
	TaskID       string `json:"task_id" example:"01JABC1234567890ABCDEFGH"`
}

// ConvertActionItemsSDO answers POST .../action-items/convert, in request order.
type ConvertActionItemsSDO struct {
	Links []ActionItemLinkDTO `json:"links"`
}

// UndoConvertActionItemsSDO lists the items put back to pending.
type UndoConvertActionItemsSDO struct {
	Restored []string `json:"restored" description:"Các việc đã về chờ xử lý (task của chúng đã vào thùng rác); việc không đủ điều kiện không có ở đây" example:"[\"01J8X4AI0N1P2Q3R4S5T6U7V8W\"]"`
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
	Transcription bool   `json:"transcription" description:"Ghi lời file ghi âm tải lên có cho workspace này: có nhà cung cấp, cờ meeting_transcription bật, gói có meeting.transcription"`
	ScribePolicy  string `json:"scribe_policy" description:"Chính sách thư ký AI của tổ chức: on (mặc định, cuộc họp mới có thư ký) | opt_in (cuộc họp mới tắt thư ký, chủ trì bật khi lên lịch hoặc trong phòng) | off (không bao giờ có thư ký)" example:"on"`
}

// MeetingDialInSDO is how to call into one meeting by phone (UNI-2029).
type MeetingDialInSDO struct {
	Enabled bool   `json:"enabled" description:"Cuộc họp nhận cuộc gọi điện thoại: server bật SIP, cờ meeting_dial_in bật, cuộc họp chưa kết thúc" example:"true"`
	Number  string `json:"number" description:"Số tổng đài của triển khai; rỗng khi enabled = false" example:"+84 28 7300 0000"`
	Pin     string `json:"pin" description:"Mã PIN 6 số của cuộc họp; người gọi nhập sau khi tổng đài trả lời. Rỗng khi enabled = false" example:"042137"`
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

// MeetingAgentExtractSDO answers POST /agent/extract (scribe spec §4.4).
type MeetingAgentExtractSDO struct {
	Created int    `json:"created" description:"Số việc LIVE mới thêm vào Việc sau họp" example:"2"`
	Skipped string `json:"skipped,omitempty" description:"Lý do không rút việc: unavailable (cờ, gói hoặc AI chưa bật), capped (quá 20 lần mỗi giờ), ai_quota_exceeded (hết tín dụng AI), concurrent (một lần rút khác đã đọc các đoạn này), closed (lần chạy không còn ACTIVE hay đã quá 10 phút xả, hoặc thư ký đã tắt cho cuộc họp)" example:"capped"`
}

// CaptionTranslationDTO is one translated caption.
type CaptionTranslationDTO struct {
	SegmentID string `json:"segment_id" description:"Id đoạn gốc" example:"AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-12"`
	Text      string `json:"text" example:"Send the quote to the client before Friday."`
}

// MeetingAgentTranslateSDO answers POST /agent/translate (scribe spec §5.3).
type MeetingAgentTranslateSDO struct {
	Translations []CaptionTranslationDTO `json:"translations" description:"Bản dịch theo segment_id; đoạn thiếu ở đây thì hiện bản gốc"`
	Skipped      string                  `json:"skipped,omitempty" description:"Lý do không dịch: unavailable (cờ, gói hoặc AI chưa bật), capped (quá 1 lần mỗi giây cho ngôn ngữ này), ai_quota_exceeded (hết tín dụng AI), closed (cuộc họp không còn diễn ra, lần chạy không ACTIVE, hoặc thư ký đã tắt)" example:"capped"`
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

// MeetingMinutesDTO is the minutes of a meeting: a UniNote page it references.
type MeetingMinutesDTO struct {
	DocumentID           *string `json:"document_id" description:"Trang UniNote của biên bản; null khi người gọi không có quyền xem trang (khi đó finalized_version_id, finalized_version cũng null và edited_since_finalized false)" example:"01J8X4DOC0N1P2Q3R4S5T6U7V8"`
	Finalized            bool    `json:"finalized" description:"Đã chốt (có phiên bản được ghi nhận)"`
	FinalizedAt          *string `json:"finalized_at" description:"Lúc chốt; null khi là bản nháp" example:"2026-10-20T03:00:00Z"`
	FinalizedBy          *string `json:"finalized_by" description:"Người chốt; null khi là bản nháp" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	FinalizedVersionID   *string `json:"finalized_version_id" description:"Phiên bản tài liệu đã chốt" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	FinalizedVersion     *int32  `json:"finalized_version" description:"Số thứ tự phiên bản đã chốt trong lịch sử trang" example:"2"`
	EditedSinceFinalized bool    `json:"edited_since_finalized" description:"Nội dung trang đã được lưu sau phiên bản đã chốt"`
	CanEdit              bool    `json:"can_edit" description:"Người gọi có quyền sửa trang và trang không ở kho lưu trữ (cần cho chốt và bỏ chốt)"`
	PendingItems         int     `json:"pending_items" description:"Số việc cần làm của cuộc họp chưa giao và chưa bỏ qua: giao diện cảnh báo trước khi chốt" example:"2"`
}

// MeetingMinutesSDO answers GET and the commands of /api/v1/meetings/{meetingID}/minutes.
type MeetingMinutesSDO struct {
	Minutes *MeetingMinutesDTO `json:"minutes" description:"null khi cuộc họp chưa có biên bản, hoặc trang đã bị xoá hay vào thùng rác"`
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
	ID               string `json:"id" example:"01JA09K3N1P2Q3R4S5T6U7V8"`
	MeetingID        string `json:"meeting_id" example:"01J8X4MTGN1P2Q3R4S5T6U7V"`
	FileID           string `json:"file_id" example:"01JA09K3N1P2Q3R4S5T6U7V9"`
	Filename         string `json:"filename" example:"hop-chi-bo.m4a"`
	SizeBytes        int64  `json:"size_bytes" example:"28800000"`
	Language         string `json:"language" enum:"vi,en" example:"vi"`
	Status           string `json:"status" enum:"QUEUED,RUNNING,COMPLETE,FAILED" example:"RUNNING"`
	ErrorCode        string `json:"error_code,omitempty" enum:"file_unavailable,provider_error,timeout" description:"Lý do của lần thử gần nhất bị lỗi; với FAILED là lý do cuối" example:"provider_error"`
	Attempts         int32  `json:"attempts" description:"Số lần đã gửi nhà cung cấp (tối đa 3)" example:"1"`
	StartsAt         string `json:"starts_at" description:"Giờ thật ứng với giây 0 của tệp" example:"2026-10-20T01:30:00Z"`
	EstimatedSeconds int32  `json:"estimated_seconds" description:"Thời lượng ước tính lúc nhận tệp (giây), có ngay từ QUEUED" example:"2538"`
	AudioSeconds     int32  `json:"audio_seconds,omitempty" description:"Thời lượng đã tính phí, có khi COMPLETE" example:"3600"`
	CreatedBy        string `json:"created_by" example:"01J8X4USER0N1P2Q3R4S5T6U7"`
	CreatedAt        string `json:"created_at" example:"2026-10-20T04:00:00Z"`
	CompletedAt      string `json:"completed_at,omitempty" example:"2026-10-20T04:20:00Z"`
}

type MeetingTranscriptionSDO struct {
	Transcription MeetingTranscriptionDTO `json:"transcription"`
}

type MeetingTranscriptionListSDO struct {
	Transcriptions []MeetingTranscriptionDTO `json:"transcriptions" description:"Mới nhất trước, tối đa 100"`
}
