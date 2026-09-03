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
}

type CreateJoinRequestSDI struct {
	DisplayName string `json:"display_name"`
}

type RejectJoinRequestSDI struct {
	Reason string `json:"reason"`
}
