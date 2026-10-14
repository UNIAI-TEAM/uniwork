package sdo

// WorkspaceSDO wraps one workspace.
type WorkspaceSDO struct {
	Workspace WorkspaceDTO `json:"workspace"`
}

// WorkspaceListSDO is a list of workspaces the caller can see.
type WorkspaceListSDO struct {
	Workspaces []WorkspaceDTO `json:"workspaces"`
}

type WorkspaceDTO struct {
	ID               string `json:"id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Slug             string `json:"slug" example:"team"`
	Name             string `json:"name" example:"Team"`
	OrganizationID   string `json:"organization_id" example:"01J8X4ORG0N1P2Q3R4S5T6U7V"`
	OrganizationSlug string `json:"organization_slug" example:"acme"`
	OrganizationName string `json:"organization_name" example:"Acme"`
	Description      string `json:"description" description:"Mô tả workspace, rỗng nếu chưa có" example:"Nhóm làm sản phẩm"`
	IconEmoji        string `json:"icon_emoji" description:"Emoji icon, rỗng nếu không dùng" example:"🚀"`
	IconURL          string `json:"icon_url" description:"URL ảnh icon đã ký, rỗng nếu không có ảnh" example:"https://cdn.example.com/workspace-icons/01J8X4.png"`
	TaskPrefix       string `json:"task_prefix" description:"Tiền tố mã task, ví dụ TASK trong TASK-12" example:"TASK"`
}

type MembershipDTO struct {
	UserID string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Role   string `json:"role" description:"Vai trò hiệu lực: owner, admin hoặc member" example:"admin"`
	Source string `json:"source" description:"membership tường minh hoặc org_admin ngầm" example:"membership"`
}

// MembershipSDO is GET /api/v1/workspaces/{workspaceID}/me.
type MembershipSDO struct {
	Membership MembershipDTO `json:"membership"`
}

type MemberDTO struct {
	WorkspaceID string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	UserID      string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Role        string `json:"role" description:"Vai trò tường minh trên workspace_members" example:"admin"`
	CreatedAt   string `json:"created_at" example:"2026-08-01T09:00:00Z"`
	Email       string `json:"email" format:"email" example:"an@acme.vn"`
	DisplayName string `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
}

// MemberListSDO is GET /api/v1/workspaces/{workspaceID}/members.
type MemberListSDO struct {
	Members []MemberDTO `json:"members"`
}

type WorkspaceMemberDTO struct {
	WorkspaceID string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	UserID      string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Role        string `json:"role" example:"member"`
	CreatedAt   string `json:"created_at" example:"2026-08-01T09:00:00Z"`
}

// MemberSDO is PATCH /api/v1/workspaces/{workspaceID}/members/{userID}.
type MemberSDO struct {
	Member WorkspaceMemberDTO `json:"member"`
}

type InvitationCreatedDTO struct {
	ID    string `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Email string `json:"email" format:"email" example:"binh@acme.vn"`
	Role  string `json:"role" example:"member"`
}

// InvitationCreateSDO is POST /api/v1/workspaces/{workspaceID}/invitations.
type InvitationCreateSDO struct {
	Invitations []InvitationCreatedDTO `json:"invitations"`
	Skipped     []string               `json:"skipped" description:"Email đã là thành viên hoặc không hợp lệ" example:"[\"an@acme.vn\"]"`
}

type InvitationWorkspaceDTO struct {
	ID   string `json:"id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Slug string `json:"slug" example:"team"`
	Name string `json:"name" example:"Team"`
}

type InvitationOrgDTO struct {
	ID   string `json:"id" example:"01J8X4ORG0N1P2Q3R4S5T6U7V"`
	Slug string `json:"slug" example:"acme"`
	Name string `json:"name" example:"Acme"`
}

type InvitationInvitedByDTO struct {
	DisplayName string `json:"display_name" example:"Nguyễn Văn An"`
}

type PendingInvitationDTO struct {
	ID           string                  `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Role         string                  `json:"role" example:"member"`
	Token        string                  `json:"token" example:"inv_01J8X4TOKEN"`
	ExpiresAt    string                  `json:"expires_at" example:"2026-09-01T09:00:00Z"`
	OrgRole      string                  `json:"org_role" description:"Vai trò tổ chức khi chấp nhận" example:"member"`
	Workspace    *InvitationWorkspaceDTO `json:"workspace,omitempty" description:"Vắng mặt với lời mời cấp tổ chức"`
	Organization InvitationOrgDTO        `json:"organization"`
	InvitedBy    InvitationInvitedByDTO  `json:"invited_by"`
}

// PendingInvitationListSDO is GET /api/v1/me/invitations.
type PendingInvitationListSDO struct {
	Invitations []PendingInvitationDTO `json:"invitations"`
}

// AcceptInviteSDO is POST /api/v1/invitations/{token}/accept. `workspace` is
// absent for an invitation to the organization itself (F-03).
type AcceptInviteSDO struct {
	Organization OrganizationDTO `json:"organization"`
	Workspace    *WorkspaceDTO   `json:"workspace,omitempty"`
}

// InvitationPreviewDTO is the invitation as its invitee sees it, in any state.
type InvitationPreviewDTO struct {
	ID           string                  `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Status       string                  `json:"status" enum:"pending,expired,revoked,accepted" description:"pending | expired | revoked | accepted" example:"pending"`
	ExpiresAt    string                  `json:"expires_at" example:"2026-09-01T09:00:00Z"`
	Organization InvitationOrgDTO        `json:"organization"`
	Workspace    *InvitationWorkspaceDTO `json:"workspace,omitempty" description:"Vắng mặt với lời mời cấp tổ chức"`
	OrgRole      string                  `json:"org_role" description:"Vai trò tổ chức khi chấp nhận" example:"member"`
	InviterName  string                  `json:"inviter_name,omitempty" description:"Tên hiển thị của người mời" example:"Nguyễn Văn An"`
}

// MembershipConflictDTO is one organization the caller belongs to that stands
// between them and the invitation, with what it needs (ADR 0032). The 409
// organization_switch_required carries the same shape in error.fields.conflicts.
type MembershipConflictDTO struct {
	Organization            InvitationOrgDTO `json:"organization"`
	Role                    string           `json:"role" description:"Vai trò hiện tại trong tổ chức đó" example:"owner"`
	RequiredAction          string           `json:"required_action" enum:"leave,transfer,close,blocked" description:"leave | transfer | close | blocked" example:"transfer"`
	BlockedReason           string           `json:"blocked_reason,omitempty" description:"Với blocked: lý do" example:"owner_of_suspended_organization"`
	TransferCandidatesCount int64            `json:"transfer_candidates_count" description:"Số thành viên active khác có thể nhận quyền chủ sở hữu" example:"3"`
}

// InvitationPreviewSDO is GET /api/v1/invitations/{token}. `conflicts` is
// empty unless the invitation is pending.
type InvitationPreviewSDO struct {
	Invitation InvitationPreviewDTO    `json:"invitation"`
	Conflicts  []MembershipConflictDTO `json:"conflicts"`
}
