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
}

type MemberDTO struct {
	WorkspaceID string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	UserID      string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Role        string `json:"role" description:"Vai trò trong workspace, hoặc admin ngầm từ tổ chức" example:"admin"`
	CreatedAt   string `json:"created_at" example:"2026-08-01T09:00:00Z"`
	Email       string `json:"email" format:"email" example:"an@acme.vn"`
	DisplayName string `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
}

// MemberListSDO is GET /api/v1/workspaces/{workspaceID}/members.
type MemberListSDO struct {
	Members []MemberDTO `json:"members"`
}

type InvitationCreatedDTO struct {
	ID    string `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Email string `json:"email" format:"email" example:"binh@acme.vn"`
	Role  string `json:"role" example:"member"`
	Token string `json:"token" description:"Token lời mời dùng trên URL chấp nhận" example:"inv_01J8X4TOKEN"`
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
	ID           string                 `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Role         string                 `json:"role" example:"member"`
	Token        string                 `json:"token" example:"inv_01J8X4TOKEN"`
	ExpiresAt    string                 `json:"expires_at" example:"2026-09-01T09:00:00Z"`
	Workspace    InvitationWorkspaceDTO `json:"workspace"`
	Organization InvitationOrgDTO       `json:"organization"`
	InvitedBy    InvitationInvitedByDTO `json:"invited_by"`
}

// PendingInvitationListSDO is GET /api/v1/me/invitations.
type PendingInvitationListSDO struct {
	Invitations []PendingInvitationDTO `json:"invitations"`
}
