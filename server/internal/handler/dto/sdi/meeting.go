package sdi

import "time"

// CreateMeetingSDI is POST /api/v1/workspaces/{workspaceID}/meetings.
type CreateMeetingSDI struct {
	Title       string    `json:"title" minLength:"1" description:"Tiêu đề cuộc họp" example:"Standup tuần"`
	Description string    `json:"description" description:"Agenda tùy chọn" example:"Review sprint"`
	StartsAt    time.Time `json:"starts_at" description:"Thời điểm bắt đầu (RFC3339)" example:"2026-08-28T02:00:00Z"`
	EndsAt      time.Time `json:"ends_at" description:"Thời điểm kết thúc (RFC3339)" example:"2026-08-28T02:30:00Z"`
}

// PatchMeetingSDI is PATCH /api/v1/meetings/{meetingID}.
type PatchMeetingSDI struct {
	Title       *string    `json:"title" example:"Standup tuần"`
	Description *string    `json:"description" example:"Review sprint"`
	StartsAt    *time.Time `json:"starts_at" example:"2026-08-28T02:00:00Z"`
	EndsAt      *time.Time `json:"ends_at" example:"2026-08-28T02:30:00Z"`
}

// CreateNoteSDI is POST /api/v1/meetings/{meetingID}/notes.
type CreateNoteSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung ghi chú" example:"Quyết định ship vào thứ Sáu."`
}
