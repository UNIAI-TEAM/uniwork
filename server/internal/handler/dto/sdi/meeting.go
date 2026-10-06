package sdi

import "time"

// CreateMeetingSDI is POST /api/v1/workspaces/{workspaceID}/meetings.
type CreateMeetingSDI struct {
	Title            string    `json:"title" minLength:"1" description:"Tiêu đề cuộc họp" example:"Standup tuần"`
	Description      string    `json:"description" description:"Agenda tùy chọn" example:"Review sprint"`
	StartsAt         time.Time `json:"starts_at" description:"Thời điểm bắt đầu (RFC3339)" example:"2026-08-28T02:00:00Z"`
	EndsAt           time.Time `json:"ends_at" description:"Thời điểm kết thúc (RFC3339)" example:"2026-08-28T02:30:00Z"`
	Timezone         string    `json:"timezone" example:"Asia/Ho_Chi_Minh"`
	AllowJoinRequest *bool     `json:"allow_join_request"`
	ProjectID        string    `json:"project_id" example:""`
	AttendeeUserIDs  []string  `json:"attendee_user_ids"`
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
	QuorumPercent    *int       `json:"quorum_percent" minimum:"0" maximum:"100" description:"Tỉ lệ có mặt tối thiểu (%); 0 = bỏ yêu cầu" example:"60"`
}

type CreateNoteSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung ghi chú" example:"Quyết định ship vào thứ Sáu."`
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

// AppendAgentTranscriptSDI is POST /api/v1/meetings/{meetingID}/transcript/agent.
type AppendAgentTranscriptSDI struct {
	ParticipantIdentity string    `json:"participant_identity" minLength:"1" description:"LiveKit identity uw_participant_{id}" example:"uw_participant_01J8X4MTGN1P2Q3R4S5T6U7V"`
	SpeakerName         string    `json:"speaker_name" description:"Tên hiển thị; trống = lấy từ participant" example:"Nguyễn Văn An"`
	Text                string    `json:"text" minLength:"1" example:"Chốt ship vào thứ Sáu."`
	SpokenAt            time.Time `json:"spoken_at" description:"Thời điểm nói (RFC3339); trống = now"`
}

// SetParticipantPublishSDI locks or unlocks one media source of a participant
// on LiveKit; the server enforces it on the publish permission.
type SetParticipantPublishSDI struct {
	Enabled bool   `json:"enabled" description:"true = mở khóa nguồn; false = khóa nguồn (dừng track đang phát và chặn phát lại)" example:"false"`
	Source  string `json:"source,omitempty" enum:"microphone,screen_share" description:"Nguồn cần khóa/mở: microphone (mic, kèm âm thanh tab chia sẻ) | screen_share (chia sẻ màn hình và âm thanh của nó); bỏ trống = microphone. Khóa nguồn này giữ nguyên khóa của nguồn kia; không khóa được nguồn của chủ tọa (cannot_mute_host / cannot_lock_host_share)" example:"screen_share"`
}

// CreateSummarySDI is POST /api/v1/meetings/{meetingID}/summary.
type CreateSummarySDI struct {
	Locale string `json:"locale" description:"Ngôn ngữ đầu ra: vi | en" example:"vi"`
}

type SummaryTaskItemSDI struct {
	Title       string  `json:"title" minLength:"1" example:"Gửi báo cáo sprint"`
	Description string  `json:"description"`
	AssigneeID  *string `json:"assignee_id"`
	ProjectID   *string `json:"project_id" description:"Dự án workspace; tùy chọn"`
	Priority    string  `json:"priority,omitempty" description:"none | low | medium | high | urgent"`
	DueDate     *string `json:"due_date" description:"YYYY-MM-DD" example:"2026-09-05"`
	Owner       string  `json:"owner" description:"Tên người phụ trách do AI gợi ý; server resolve sang assignee_id"`
	DueSpoken   string  `json:"due_spoken" description:"Hạn nói trong họp; server parse sang due_date"`
}

// SummaryTasksSDI is POST /api/v1/meetings/{meetingID}/summary/tasks.
type SummaryTasksSDI struct {
	Items []SummaryTaskItemSDI `json:"items"`
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
