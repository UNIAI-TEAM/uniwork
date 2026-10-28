package sdo

// MembershipInviteLinkDTO is one shareable invite link as a manager sees it.
type MembershipInviteLinkDTO struct {
	ID             string                   `json:"id" description:"ULID liên kết" example:"01J8X4LNK0N1P2Q3R4S5T6U7V"`
	OrganizationID string                   `json:"organization_id" description:"ULID tổ chức" example:"01J8X4ORG0N1P2Q3R4S5T6U7V"`
	WorkspaceID    string                   `json:"workspace_id,omitempty" description:"ULID workspace khi link gắn một workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V"`
	Status         string                   `json:"status" enum:"active,expired,revoked" description:"Trạng thái hiệu lực" example:"active"`
	ExpiresAt      string                   `json:"expires_at" format:"date-time" description:"Hết hạn (UTC)" example:"2026-11-03T00:00:00Z"`
	Secret         string                   `json:"secret,omitempty" description:"Secret để ghép URL; chỉ có khi link còn Active và server có HMAC key" example:"abc…"`
	Workspaces     []InvitationWorkspaceDTO `json:"workspaces" description:"Workspace gắn với link"`
	CreatedAt      string                   `json:"created_at" format:"date-time" description:"Thời điểm tạo" example:"2026-10-27T00:00:00Z"`
}

// MembershipInviteLinkSDO is create/list/revoke/regenerate response item.
type MembershipInviteLinkSDO struct {
	InviteLink MembershipInviteLinkDTO `json:"invite_link"`
}

// MembershipInviteLinkListSDO is GET invite-links.
type MembershipInviteLinkListSDO struct {
	InviteLinks []MembershipInviteLinkDTO `json:"invite_links"`
}

// MembershipInviteWorkspaceStateDTO is one workspace on the join preview.
type MembershipInviteWorkspaceStateDTO struct {
	ID     string `json:"id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V"`
	Slug   string `json:"slug" description:"Slug workspace" example:"team"`
	Name   string `json:"name" description:"Tên workspace" example:"Team"`
	Joined bool   `json:"joined" description:"Người gọi đã là thành viên workspace này"`
}

// MembershipInvitePreviewSDO is POST membership-invite-links/preview.
type MembershipInvitePreviewSDO struct {
	LinkID        string                              `json:"link_id"`
	Status        string                              `json:"status" enum:"active,expired,revoked"`
	Organization  InvitationOrgDTO                    `json:"organization"`
	Workspaces    []MembershipInviteWorkspaceStateDTO `json:"workspaces"`
	NeedsJoin     bool                                `json:"needs_join"`
	AlreadyMember bool                                `json:"already_member"`
	Conflicts     []MembershipConflictDTO             `json:"conflicts"`
}

// MembershipInviteJoinSDO is POST membership-invite-links/join.
type MembershipInviteJoinSDO struct {
	Organization OrganizationDTO `json:"organization"`
	Workspace    *WorkspaceDTO   `json:"workspace,omitempty"`
	JoinedIDs    []string        `json:"joined_ids" description:"Workspace vừa được thêm membership"`
	AlreadyAll   bool            `json:"already_all" description:"Đã tham gia đủ trước khi gọi join"`
}
