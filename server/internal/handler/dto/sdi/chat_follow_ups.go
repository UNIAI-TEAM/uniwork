package sdi

// CreateChatFollowUpSDI is POST .../chat/messages/{messageID}/follow-ups.
type CreateChatFollowUpSDI struct {
	Note  string  `json:"note,omitempty" description:"Optional personal note" example:"Nhắc lại sau standup"`
	DueAt *string `json:"due_at,omitempty" description:"Optional RFC3339 due time" example:"2026-09-20T09:00:00Z"`
}

// PatchChatFollowUpSDI is PATCH .../chat/follow-ups/{followUpID}.
// due_at may be null to clear; omit the field to leave it unchanged.
type PatchChatFollowUpSDI struct {
	Note      *string `json:"note,omitempty" description:"Replace the note" example:"Đã trao đổi với lead"`
	DueAt     *string `json:"due_at,omitempty" description:"RFC3339 due time; send null to clear" example:"2026-09-21T09:00:00Z"`
	Completed *bool   `json:"completed,omitempty" description:"true completes; false reopens" example:"true"`
}
