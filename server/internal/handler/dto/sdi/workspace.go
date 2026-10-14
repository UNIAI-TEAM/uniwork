package sdi

// CreateWorkspaceSDI is POST /api/v1/orgs/{org}/workspaces.
type CreateWorkspaceSDI struct {
	Name string `json:"name" minLength:"1" description:"Tên hiển thị của workspace" example:"Team"`
	Slug string `json:"slug" minLength:"1" description:"Slug trên URL, không trùng trong cùng tổ chức" example:"team"`
}

// PatchWorkspaceSDI is PATCH /api/v1/workspaces/{workspaceID}.
type PatchWorkspaceSDI struct {
	Name *string `json:"name" description:"Tên workspace mới" example:"Team"`
}

// PatchMemberSDI is PATCH /api/v1/workspaces/{workspaceID}/members/{userID}.
type PatchMemberSDI struct {
	Role string `json:"role" description:"Vai trò mới: admin hoặc member, không phải owner" example:"member"`
}

// CreateInvitationSDI is POST /api/v1/workspaces/{workspaceID}/invitations.
type CreateInvitationSDI struct {
	Email  string   `json:"email" format:"email" description:"Một email mời; cũng nhận qua emails[0]" example:"binh@acme.vn"`
	Emails []string `json:"emails" description:"Danh sách email mời; trùng hoặc đã là thành viên sẽ bị bỏ qua" example:"[\"binh@acme.vn\"]"`
	Role   string   `json:"role" description:"Vai trò khi chấp nhận: member hoặc admin" example:"member"`
}

// AcceptInvitationSDI is POST /api/v1/invitations/{token}/accept. The body is
// optional: somebody with no organization to give up sends nothing.
type AcceptInvitationSDI struct {
	Resolve []SwitchResolutionSDI `json:"resolve,omitempty" description:"Cách xử lý từng tổ chức hiện tại trước khi tham gia; phải khớp đúng conflicts của GET /invitations/{token}"`
}

// SwitchResolutionSDI resolves one organization the caller belongs to.
type SwitchResolutionSDI struct {
	OrganizationID   string `json:"organization_id" description:"ULID tổ chức hiện tại, lấy từ conflicts" example:"01J8X4ORG0N1P2Q3R4S5T6U7V"`
	Action           string `json:"action" enum:"leave,transfer,close" description:"Đúng required_action của tổ chức đó: leave | transfer | close" example:"leave"`
	TransferToUserID string `json:"transfer_to_user_id,omitempty" description:"Với transfer: ULID thành viên active nhận quyền chủ sở hữu" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Password         string `json:"password,omitempty" description:"Với transfer: mật khẩu hiện tại của chủ sở hữu" example:"••••••••"`
	ConfirmSlug      string `json:"confirm_slug,omitempty" description:"Với close: slug của tổ chức, gõ lại để xác nhận đóng" example:"acme"`
}
