package sdi

// CreateMembershipInviteLinkSDI is POST workspace/org invite-links.
type CreateMembershipInviteLinkSDI struct {
	ExpiresInDays *int     `json:"expires_in_days,omitempty" description:"Số ngày hiệu lực (1–30), mặc định 7" example:"7"`
	WorkspaceIDs  []string `json:"workspace_ids,omitempty" description:"Bắt buộc với org link: một hoặc nhiều workspace thuộc tổ chức" example:"[\"01J8X4WS0N1P2Q3R4S5T6U7V\"]"`
}

// PreviewMembershipInviteLinkSDI is POST /api/v1/membership-invite-links/preview.
type PreviewMembershipInviteLinkSDI struct {
	LinkID string `json:"link_id" minLength:"1" description:"ULID của liên kết mời" example:"01J8X4LNK0N1P2Q3R4S5T6U7V"`
	Secret string `json:"secret" minLength:"1" description:"Secret trong URL liên kết" example:"abc…"`
}

// JoinMembershipInviteLinkSDI is POST /api/v1/membership-invite-links/join.
type JoinMembershipInviteLinkSDI struct {
	LinkID  string                `json:"link_id" minLength:"1" description:"ULID của liên kết mời" example:"01J8X4LNK0N1P2Q3R4S5T6U7V"`
	Secret  string                `json:"secret" minLength:"1" description:"Secret trong URL liên kết" example:"abc…"`
	Resolve []SwitchResolutionSDI `json:"resolve,omitempty" description:"Cách xử lý tổ chức hiện tại trước khi tham gia (giống accept invitation)"`
}
