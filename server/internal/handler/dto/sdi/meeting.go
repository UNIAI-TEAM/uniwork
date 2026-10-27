package sdi

import (
	"encoding/json"
	"time"
)

// CreateMeetingSDI is POST /api/v1/workspaces/{workspaceID}/meetings.
type CreateMeetingSDI struct {
	Title             string    `json:"title" minLength:"1" description:"Tiêu đề cuộc họp" example:"Standup tuần"`
	Description       string    `json:"description" description:"Agenda tùy chọn" example:"Review sprint"`
	StartsAt          time.Time `json:"starts_at" description:"Thời điểm bắt đầu (RFC3339)" example:"2026-08-28T02:00:00Z"`
	EndsAt            time.Time `json:"ends_at" description:"Thời điểm kết thúc (RFC3339)" example:"2026-08-28T02:30:00Z"`
	Timezone          string    `json:"timezone" example:"Asia/Ho_Chi_Minh"`
	AllowJoinRequest  *bool     `json:"allow_join_request"`
	ProjectID         string    `json:"project_id" example:""`
	AttendeeUserIDs   []string  `json:"attendee_user_ids"`
	Venue             string    `json:"venue" enum:"online,in_person" description:"Hình thức: online có phòng họp; in_person ghi âm tại phòng" example:"online"`
	PreviousMeetingID string    `json:"previous_meeting_id,omitempty" description:"ULID cuộc họp mà cuộc họp này là buổi tiếp theo: cuộc họp mới vào cùng chuỗi, việc chưa xong được mang sang theo chuỗi" example:""`
}

// ListMeetingsSDI documents GET /api/v1/workspaces/{workspaceID}/meetings query params.
type ListMeetingsSDI struct {
	Status      string `query:"status" enum:"SCHEDULED,MISSED,IN_PROGRESS,ENDED,CANCELED" description:"Lọc theo trạng thái người xem thấy: SCHEDULED = chưa bắt đầu và chưa qua giờ kết thúc (ends_at >= now); MISSED = SCHEDULED đã qua giờ kết thúc (ends_at < now); các giá trị khác khớp status đã lưu; bỏ trống = mọi status" example:"SCHEDULED"`
	MeetingType string `query:"meeting_type" description:"SCHEDULED hoặc INSTANT; bỏ trống = cả hai" example:"SCHEDULED"`
	HostUserID  string `query:"host_user_id" description:"Lọc theo ULID người chủ trì" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	ProjectID   string `query:"project_id" description:"Lọc theo ULID project" example:""`
	Q           string `query:"q" description:"Tìm theo tiêu đề (không phân biệt hoa thường)" example:"standup"`
	From        string `query:"from" description:"starts_at từ thời điểm này (RFC3339)" example:"2026-08-01T00:00:00Z"`
	To          string `query:"to" description:"starts_at đến thời điểm này (RFC3339)" example:"2026-08-31T23:59:59Z"`
	Sort        string `query:"sort" enum:"actual_start_at,starts_at" description:"Bỏ trống = mới tạo trước; actual_start_at = mới bắt đầu thật trước; starts_at = hôm nay và sắp tới trước (sớm nhất trước), rồi các ngày đã qua (ngày gần nhất trước), trong ngày theo giờ bắt đầu" example:"starts_at"`
	TZ          string `query:"tz" description:"Múi giờ IANA của người xem, quyết định ngày hôm nay và ngày của từng cuộc họp khi sort=starts_at; bỏ trống = UTC" example:"Asia/Ho_Chi_Minh"`
	Limit       int32  `query:"limit" description:"Kích thước trang (mặc định 50, tối đa 100)" example:"20"`
	Offset      int32  `query:"offset" description:"Offset phân trang" example:"0"`
}

type CreateInstantMeetingSDI struct {
	Title string `json:"title" example:"Họp nhanh"`
	Venue string `json:"venue,omitempty" enum:"online,in_person" description:"Hình thức: online mở phòng họp ngay; in_person ghi âm tại phòng, không mở phòng" example:"online"`
}

// PatchMeetingSDI is PATCH /api/v1/meetings/{meetingID}.
type PatchMeetingSDI struct {
	Title            *string    `json:"title" example:"Standup tuần"`
	Description      *string    `json:"description" example:"Review sprint"`
	StartsAt         *time.Time `json:"starts_at" example:"2026-08-28T02:00:00Z"`
	EndsAt           *time.Time `json:"ends_at" example:"2026-08-28T02:30:00Z"`
	Timezone         *string    `json:"timezone"`
	AllowJoinRequest *bool      `json:"allow_join_request"`
	ProjectID        *string    `json:"project_id"`
	Venue            *string    `json:"venue" enum:"online,in_person" description:"Hình thức: online có phòng họp; in_person ghi âm tại phòng" example:"online"`
	QuorumPercent    *int       `json:"quorum_percent" minimum:"0" maximum:"100" description:"Tỉ lệ có mặt tối thiểu (%); 0 = bỏ yêu cầu" example:"60"`
}

type CreateNoteSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung ghi chú" example:"Quyết định ship vào thứ Sáu."`
}

type UpdateNoteSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung mới của ghi chú" example:"Quyết định ship vào thứ Hai."`
}

type InviteParticipantSDI struct {
	UserID string `json:"user_id" minLength:"1" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

type InvitationResponseSDI struct {
	Response string `json:"response" example:"ACCEPTED"`
}

type HostTransferSDI struct {
	NewHostUserID string `json:"new_host_user_id" minLength:"1"`
}

type CancelMeetingSDI struct {
	Reason string `json:"reason" example:"trùng lịch"`
}

// RestoreMeetingSDI is POST /api/v1/meetings/{meetingID}/restore.
type RestoreMeetingSDI struct {
	Version *int32 `json:"version,omitempty" description:"Phiên bản người dùng đang xem; lệch thì 409 revision_conflict" example:"4"`
}

// ExtendMeetingSDI is POST /api/v1/meetings/{meetingID}/extend.
type ExtendMeetingSDI struct {
	Minutes int `json:"minutes" description:"Số phút gia hạn; mặc định 15, tối đa 120" example:"15"`
}

type CreateInviteLinkSDI struct {
	Name       string    `json:"name" example:"Khách bên ngoài"`
	AccessMode string    `json:"access_mode" example:"AUTO_ADMIT"`
	ExpiresAt  time.Time `json:"expires_at"`
	MaxUses    *int32    `json:"max_uses"`
}

type ResolveInviteLinkSDI struct {
	LinkID string `json:"link_id"`
	Secret string `json:"secret"`
}

type JoinMeetingSDI struct {
	InviteLinkID string `json:"invite_link_id"`
	Secret       string `json:"secret"`
	DisplayName  string `json:"display_name"`
	RequestAgain bool   `json:"request_again" description:"Gửi lại yêu cầu vào phòng sau khi bị chủ trì từ chối; bỏ trống thì lần vào lại trả join_request_rejected"`
}

type CreateJoinRequestSDI struct {
	DisplayName string `json:"display_name"`
}

type RejectJoinRequestSDI struct {
	Reason string `json:"reason"`
}

// AppendTranscriptSDI is POST /api/v1/meetings/{meetingID}/transcript.
type AppendTranscriptSDI struct {
	Text     string    `json:"text" minLength:"1" description:"Một câu đã nhận dạng xong" example:"Chốt ship vào thứ Sáu."`
	SpokenAt time.Time `json:"spoken_at" description:"Thời điểm nói (RFC3339); trống = now" example:"2026-08-29T02:00:00Z"`
}

// AgentSegmentSDI is one final segment the scribe agent sends.
type AgentSegmentSDI struct {
	SegmentID           string    `json:"segment_id" minLength:"1" maxLength:"128" description:"Khóa chống trùng do agent đặt: <job id>-<track sid>-<số thứ tự>, duy nhất giữa các lần chạy của một cuộc họp; gửi lại cùng giá trị không thêm dòng" example:"AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-12"`
	ParticipantIdentity string    `json:"participant_identity" maxLength:"128" description:"Identity LiveKit của người nói (uw_participant_{id})" example:"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V"`
	SpokenAt            time.Time `json:"spoken_at" description:"Lúc bắt đầu nói (RFC 3339, ms)" example:"2026-10-20T02:00:01.250Z"`
	EndedAt             time.Time `json:"ended_at" description:"Lúc nói xong (RFC 3339, ms)" example:"2026-10-20T02:00:04.900Z"`
	SpeechMs            int64     `json:"speech_ms" minimum:"0" maximum:"600000" description:"Thời lượng có tiếng theo VAD, tính vào phút ghi lời của gói" example:"3400"`
	Text                string    `json:"text" minLength:"1" maxLength:"4000" example:"Chốt ship vào thứ Sáu."`
	Language            string    `json:"language" maxLength:"16" description:"Ngôn ngữ STT nhận ra" example:"vi"`
	SpeakerLabel        string    `json:"speaker_label,omitempty" maxLength:"120" description:"Chỉ đoạn của micro hội trường: <participant_identity>:<phiên STT>:<nhãn nhà cung cấp>, nhãn ? khi nhà cung cấp không gán được người nói" example:"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V:AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-1:A"`
}

// AppendAgentSegmentsSDI is POST /api/v1/meetings/{meetingID}/agent/segments.
type AppendAgentSegmentsSDI struct {
	Segments []AgentSegmentSDI `json:"segments" minItems:"1" maxItems:"50" description:"Tối đa 50 đoạn final"`
}

// AgentStartedSDI is POST /api/v1/meetings/{meetingID}/agent/started.
type AgentStartedSDI struct {
	ParticipantSID string `json:"participant_sid" maxLength:"64" description:"SID LiveKit của kết nối agent; webhook participant_left của đúng SID này đóng lần chạy" example:"PA_aBcD1234"`
}

// AgentFinishedSDI is POST /api/v1/meetings/{meetingID}/agent/finished.
type AgentFinishedSDI struct {
	SttSessionMs int64 `json:"stt_session_ms" minimum:"0" description:"Tổng thời gian mở phiên STT của lần chạy (nhà cung cấp tính tiền theo nó), để đối chiếu với phút đã tính" example:"95000"`
}

// SetMeetingScribeSDI is PUT /api/v1/meetings/{meetingID}/scribe.
// SetMeetingSettingsSDI is PUT /orgs/{orgID}/meetings/settings (UNI-2026).
type SetMeetingSettingsSDI struct {
	// A pointer, so a body without the field is refused rather than read as
	// false (which would switch auto summaries off for the organization).
	AutoSummaryEnabled *bool `json:"auto_summary_enabled,omitempty" description:"false = không tự tạo tóm tắt khi họp xong (chủ trì nhận nhắc như cũ); true = tự tạo (mặc định). Thiếu thì giữ nguyên; thiếu cả hai trường thì 400 invalid_request" example:"false"`
	// ScribePolicy is on, opt_in or off; any other value is a 400.
	ScribePolicy *string `json:"scribe_policy,omitempty" enum:"on,opt_in,off" description:"Chính sách thư ký AI của tổ chức: on (mặc định) | opt_in (cuộc họp tạo từ nay tắt thư ký, chủ trì tự bật) | off (không bao giờ gọi thư ký; PUT /meetings/{id}/scribe bật lại bị 409). Thiếu thì giữ nguyên" example:"opt_in"`
}

// SetMeetingAISharingSDI is PUT /api/v1/meetings/{meetingID}/ai-sharing.
type SetMeetingAISharingSDI struct {
	Shared bool `json:"shared" description:"true = chia sẻ nội dung AI của cuộc họp với cả workspace; false = chỉ người của cuộc họp (mặc định)" example:"true"`
}

// SetTranscriptRetentionSDI is PUT /orgs/{orgID}/meetings/transcript-retention (UNI-1995 #5).
type SetTranscriptRetentionSDI struct {
	// A missing field or null keeps transcripts: the safe default.
	TranscriptRetentionDays *int32 `json:"transcript_retention_days" enum:"30,90,180,365" description:"Số ngày giữ lời thoại và file ghi âm tải lên của cuộc họp; null = giữ mãi (mặc định). Tóm tắt, biên bản, việc và task không bị xoá" example:"90"`
}

type SetMeetingScribeSDI struct {
	Enabled bool `json:"enabled" description:"false = tắt thư ký AI cho cuộc họp này; true = bật lại (mặc định bật)" example:"false"`
}

// CaptionSegmentSDI is one final caption the scribe agent wants translated.
type CaptionSegmentSDI struct {
	SegmentID string `json:"segment_id" minLength:"1" maxLength:"128" description:"uw.segment_id của phụ đề gốc; bản dịch trả về dưới cùng id" example:"AJ_66Gefpv7rYTq-TR_AM6EcLRdqMdvN6-12"`
	Text      string `json:"text" minLength:"1" maxLength:"4000" description:"Lời đoạn final, bản gốc" example:"Gửi báo giá cho khách trước thứ Sáu nhé."`
}

// AgentTranslateSDI is POST /api/v1/meetings/{meetingID}/agent/translate.
type AgentTranslateSDI struct {
	Target   string              `json:"target" enum:"vi,en" description:"Ngôn ngữ đích" example:"en"`
	Segments []CaptionSegmentSDI `json:"segments" minItems:"1" maxItems:"20" description:"Đoạn final gom tối đa 1 giây; tổng text tối đa 4.000 ký tự"`
}

// SetCaptionLanguageSDI is PUT /api/v1/meetings/{meetingID}/caption-language.
type SetCaptionLanguageSDI struct {
	Lang string `json:"lang" maxLength:"2" description:"vi hoặc en; chuỗi rỗng = phụ đề gốc" example:"en"`
}

// SetSharedMicSDI is PUT /api/v1/meetings/{meetingID}/participants/{participantID}/shared-mic.
type SetSharedMicSDI struct {
	Enabled bool `json:"enabled" description:"true = đặt người này làm micro hội trường (thư ký AI tách người nói trên mic của họ); false = bỏ" example:"true"`
}

// AssignSpeakerLabelSDI is PUT /api/v1/meetings/{meetingID}/speaker-labels/{speakerLabelID}.
// One of the two, or neither to clear the assignment.
type AssignSpeakerLabelSDI struct {
	UserID *string `json:"user_id,omitempty" description:"Thành viên workspace (người được giao việc) nói nhãn này" example:"01J8X4USER0N1P2Q3R4S5T6U7"`
	Name   *string `json:"name,omitempty" maxLength:"120" description:"Tên tự do khi người nói không phải thành viên" example:"Chị Lan (khách mời)"`
}

// SetParticipantPublishSDI locks or unlocks one media source of a participant
// on LiveKit; the server enforces it on the publish permission.
type SetParticipantPublishSDI struct {
	Enabled bool   `json:"enabled" description:"true = mở khóa nguồn; false = khóa nguồn (dừng track đang phát và chặn phát lại)" example:"false"`
	Source  string `json:"source,omitempty" enum:"microphone,screen_share" description:"Nguồn cần khóa/mở: microphone (mic, kèm âm thanh tab chia sẻ) | screen_share (chia sẻ màn hình và âm thanh của nó); bỏ trống = microphone. Khóa nguồn này giữ nguyên khóa của nguồn kia; không khóa được nguồn của chủ tọa (cannot_mute_host / cannot_lock_host_share)" example:"screen_share"`
}

// CreateSummarySDI is POST /api/v1/meetings/{meetingID}/summary.
type CreateSummarySDI struct {
	Locale string `json:"locale" description:"Ngôn ngữ đầu ra: vi | en; bỏ trống hoặc giá trị khác = vi" example:"vi"`
}

// MeetingCatchUpSDI is POST /api/v1/meetings/{meetingID}/catch-up (scribe spec §5.1, B7).
type MeetingCatchUpSDI struct {
	Locale string `json:"locale" description:"Ngôn ngữ đầu ra: vi | en; bỏ trống hoặc giá trị khác = vi" example:"vi"`
}

type SummaryTaskItemSDI struct {
	Title       string  `json:"title" minLength:"1" example:"Gửi báo cáo sprint"`
	Description string  `json:"description"`
	AssigneeID  *string `json:"assignee_id"`
	ProjectID   *string `json:"project_id" description:"Dự án workspace; tùy chọn"`
	Priority    string  `json:"priority,omitempty" description:"none | low | medium | high | urgent"`
	DueDate     *string `json:"due_date" description:"YYYY-MM-DD" example:"2026-09-05"`
	Owner       string  `json:"owner" description:"Tên người phụ trách do AI gợi ý; chỉ ghi vào mô tả"`
	DueSpoken   string  `json:"due_spoken" description:"Hạn AI trích ra; chỉ ghi vào mô tả"`
}

// AddActionItemSDI is POST /api/v1/meetings/{meetingID}/action-items.
type AddActionItemSDI struct {
	Title     string `json:"title" minLength:"1" maxLength:"500" description:"Tiêu đề việc" example:"Gửi báo cáo sprint"`
	OwnerText string `json:"owner_text,omitempty" maxLength:"200" description:"Người phụ trách như được nhắc tới; chỉ để gợi ý, không tự gán" example:"anh Hùng"`
	DueText   string `json:"due_text,omitempty" maxLength:"200" description:"Hạn như được nhắc tới; chỉ để gợi ý, không tự đặt hạn" example:"thứ sáu tuần sau"`
}

// DismissActionItemSDI is POST .../action-items/{actionItemID}/dismiss.
type DismissActionItemSDI struct {
	Reason string `json:"reason,omitempty" maxLength:"500" description:"Lý do bỏ qua, không bắt buộc" example:"Đã có người làm"`
}

// LinkActionItemSDI is POST .../action-items/{actionItemID}/link.
type LinkActionItemSDI struct {
	TaskID string `json:"task_id" minLength:"1" description:"ULID task đã có trong workspace của cuộc họp, thường là task đang mở mà 409 active_duplicate_task nêu tên" example:"01J8X4TASK1P2Q3R4S5T6U7V8W"`
}

// ConvertActionItemSDI is one pending action item the clerk turns into a
// task, with the values the clerk confirmed. The server never re-reads the
// owner or due phrase into assignee_id or due_date.
type ConvertActionItemSDI struct {
	ActionItemID string  `json:"action_item_id" minLength:"1" description:"ULID việc sau họp của cuộc họp này; không trùng trong một lần gửi" example:"01J8X4ACTN1P2Q3R4S5T6U7V"`
	Title        string  `json:"title,omitempty" description:"Tiêu đề task; để trống = tiêu đề của việc" example:"Gửi báo cáo sprint"`
	Description  string  `json:"description,omitempty" description:"Mô tả thêm; người phụ trách và hạn được nhắc ghi kèm khi task không có người gán hay hạn"`
	AssigneeID   *string `json:"assignee_id" description:"Người được gán; null hoặc rỗng = không gán ai (server không tự đoán từ tên được nhắc)" example:"01JABC1234567890ABCDEFGH"`
	DueDate      *string `json:"due_date" description:"YYYY-MM-DD; null hoặc rỗng = không có hạn (server không tự đọc hạn được nhắc)" example:"2026-09-05"`
	ProjectID    *string `json:"project_id,omitempty" description:"Dự án workspace; bỏ qua = dự án của cuộc họp, rỗng = không thuộc dự án" example:"01JABC1234567890ABCDEFGH"`
	Priority     string  `json:"priority,omitempty" description:"none | low | medium | high | urgent" example:"medium"`
	// The rest of the task composer (CreateTaskSDI), validated the same way.
	Status        string                     `json:"status,omitempty" description:"Key trạng thái trong catalog workspace; mặc định todo" example:"in_progress"`
	AssigneeKind  string                     `json:"assignee_kind,omitempty" description:"human (mặc định) hoặc agent" example:"human"`
	StartDate     *string                    `json:"start_date,omitempty" description:"Ngày bắt đầu YYYY-MM-DD" example:"2026-09-01"`
	ParentTaskID  *string                    `json:"parent_task_id,omitempty" description:"Task cha cùng workspace" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Stage         *int32                     `json:"stage,omitempty" description:"Thứ tự giai đoạn, từ 1 trở lên" example:"1"`
	LabelIDs      []string                   `json:"label_ids,omitempty" description:"Các nhãn active cùng workspace, gắn nguyên tử khi tạo"`
	AttachmentIDs []string                   `json:"attachment_ids,omitempty" description:"Các đính kèm tạm cùng workspace, gắn nguyên tử khi tạo"`
	Properties    map[string]json.RawMessage `json:"properties,omitempty" description:"Giá trị custom property active cùng workspace, lưu nguyên tử khi tạo"`
}

// ConvertActionItemsSDI is POST /api/v1/meetings/{meetingID}/action-items/convert.
type ConvertActionItemsSDI struct {
	Items  []ConvertActionItemSDI `json:"items" description:"1–50 việc đang chờ xử lý"`
	Locale string                 `json:"locale" description:"Ngôn ngữ nhãn trong mô tả task (Người phụ trách/Hạn): vi | en; bỏ trống hoặc giá trị khác = vi" example:"vi"`
}

// RateCallSDI is POST /api/v1/meetings/{meetingID}/call-rating.
type RateCallSDI struct {
	Rating string `json:"rating" enum:"good,ok,poor" description:"Âm thanh, hình ảnh lúc rời phòng: good (tốt), ok (tạm), poor (kém)" example:"good"`
}

// AppendChatSDI is POST /api/v1/meetings/{meetingID}/chat.
type AppendChatSDI struct {
	Message string `json:"message" minLength:"1" description:"Nội dung tin nhắn (hỗ trợ xuống dòng)" example:"Chốt ship vào thứ Sáu.\nAi làm phần QA?"`
}

// PatchParticipantSDI sets who votes and who clerks (host/admin only).
type PatchParticipantSDI struct {
	Standing    *string `json:"standing" enum:"MEMBER,OBSERVER" description:"MEMBER = thành viên chính thức, OBSERVER = dự thính" example:"OBSERVER"`
	IsSecretary *bool   `json:"is_secretary" description:"Giao/bỏ vai thư ký (chỉ tài khoản)" example:"true"`
}

// MarkAttendanceSDI is PUT /api/v1/meetings/{meetingID}/attendance/{participantID}.
type MarkAttendanceSDI struct {
	Status string `json:"status" enum:"PRESENT,LATE,EXCUSED,ABSENT" example:"EXCUSED"`
	Note   string `json:"note" maxLength:"200" description:"Lý do vắng; chỉ lưu khi EXCUSED" example:"Đi công tác"`
}

// CreateMotionSDI is POST /api/v1/meetings/{meetingID}/motions.
type CreateMotionSDI struct {
	Title       string `json:"title" minLength:"1" maxLength:"200" description:"Nội dung biểu quyết (đếm theo ký tự)" example:"Thông qua kế hoạch quý IV"`
	Description string `json:"description" maxLength:"2000" description:"Mô tả thêm, không bắt buộc" example:""`
	BallotMode  string `json:"ballot_mode" enum:"PUBLIC,SECRET" description:"PUBLIC = công khai, SECRET = bỏ phiếu kín" example:"SECRET"`
	Threshold   string `json:"threshold" enum:"MAJORITY,TWO_THIRDS" description:"Ngưỡng thông qua" example:"MAJORITY"`
	Base        string `json:"base" enum:"PRESENT,ALL_MEMBERS" description:"Mẫu số: số thành viên có mặt hoặc tổng thành viên" example:"PRESENT"`
}

// PatchMotionSDI is PATCH /api/v1/meetings/{meetingID}/motions/{motionID}; draft only.
type PatchMotionSDI struct {
	Title       *string `json:"title" minLength:"1" maxLength:"200" example:"Thông qua kế hoạch quý IV"`
	Description *string `json:"description" maxLength:"2000" example:""`
	BallotMode  *string `json:"ballot_mode" enum:"PUBLIC,SECRET" example:"PUBLIC"`
	Threshold   *string `json:"threshold" enum:"MAJORITY,TWO_THIRDS" example:"TWO_THIRDS"`
	Base        *string `json:"base" enum:"PRESENT,ALL_MEMBERS" example:"ALL_MEMBERS"`
	Position    *int32  `json:"position" minimum:"1" description:"Đổi chỗ với nội dung đang ở vị trí này (cả hai phải còn nháp)" example:"1"`
}

// CastBallotSDI is POST /api/v1/meetings/{meetingID}/motions/{motionID}/ballot.
type CastBallotSDI struct {
	Choice string `json:"choice" enum:"YES,NO,ABSTAIN" description:"Không đổi được sau khi gửi" example:"YES"`
}

// CreateMinutesSDI is POST /api/v1/meetings/{meetingID}/minutes.
type CreateMinutesSDI struct {
	Locale string `json:"locale" description:"Ngôn ngữ biên bản: vi | en; bỏ trống hoặc giá trị khác = vi" example:"vi"`
}

// RecordMeetingHeldSDI is POST /api/v1/meetings/{meetingID}/held: the actual
// times of a meeting held in person without a room (UNI-2001).
type RecordMeetingHeldSDI struct {
	StartedAt       string `json:"started_at" format:"date-time" description:"Giờ bắt đầu thực tế (RFC 3339)" example:"2026-10-20T01:30:00Z"`
	EndedAt         string `json:"ended_at" format:"date-time" description:"Giờ kết thúc thực tế; sau started_at và không ở tương lai" example:"2026-10-20T03:00:00Z"`
	DurationSeconds int    `json:"duration_seconds,omitempty" description:"Thời lượng đã họp (giây), khi bỏ trống hai giờ: kết thúc lúc server nhận" example:"2520"`
}

// RequestTranscriptionSDI is POST /api/v1/meetings/{meetingID}/transcriptions.
type RequestTranscriptionSDI struct {
	UploadID        string  `json:"upload_id" description:"upload_id do POST /upload-sessions/{sessionID}/complete trả về cho phiên tải purpose meeting_audio" example:"01JA09K3N1P2Q3R4S5T6U7V8"`
	Language        string  `json:"language,omitempty" enum:"vi,en" description:"Ngôn ngữ chính của buổi họp; bỏ trống = vi" example:"vi"`
	Consent         bool    `json:"consent" description:"Người tải lên xác nhận đã thông báo cho người dự họp về việc ghi âm (Nghị định 13/2023/NĐ-CP); false -> 422 recording_consent_required" example:"true"`
	DurationSeconds float64 `json:"duration_seconds,omitempty" minimum:"0" description:"Thời lượng (giây) trình duyệt đọc từ metadata của tệp; bỏ trống khi không đọc được. Chỉ dùng để ước hạn mức trước (kẹp theo dung lượng tệp), phút tính phí lấy từ nhà cung cấp" example:"1080.5"`
}

// CreateMeetingAudioUploadSessionSDI is POST
// /api/v1/meetings/{meetingID}/audio-upload-sessions: the shared large upload
// session for a meeting recording (purpose meeting_audio, UNI-2001).
type CreateMeetingAudioUploadSessionSDI struct {
	Filename        string                `json:"filename" description:"Tên tệp ghi âm" example:"hop-chi-bo.m4a"`
	SizeBytes       int64                 `json:"size_bytes" description:"Kích thước tệp (byte), tối đa 2 GiB (413 file_too_large); không có ngưỡng dưới" example:"28800000"`
	Probe           UploadSessionProbeSDI `json:"probe" description:"head_b64 là đúng min(size_bytes, 64 KiB) byte đầu tệp; loại tệp đọc từ đó phải là âm thanh mp3, m4a, wav, ogg, webm hoặc video mp4 (415 khác đi). Các trường central directory bị bỏ qua"`
	DurationSeconds float64               `json:"duration_seconds,omitempty" minimum:"0" description:"Thời lượng (giây) trình duyệt đọc từ metadata của tệp; bỏ trống khi không đọc được. Chỉ dùng để ước hạn mức trước (kẹp theo dung lượng tệp), phút tính phí lấy từ nhà cung cấp" example:"1080.5"`
}
