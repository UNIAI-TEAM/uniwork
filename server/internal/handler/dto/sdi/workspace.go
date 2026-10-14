package sdi

// CreateWorkspaceSDI is POST /api/v1/orgs/{org}/workspaces.
type CreateWorkspaceSDI struct {
	Name string `json:"name" minLength:"1" description:"Tên hiển thị của workspace" example:"Team"`
	Slug string `json:"slug" minLength:"1" description:"Slug trên URL, không trùng trong cùng tổ chức" example:"team"`
}

// PatchWorkspaceSDI is PATCH /api/v1/workspaces/{workspaceID}. A field left
// out keeps its value.
type PatchWorkspaceSDI struct {
	Name        *string `json:"name" description:"Tên workspace mới" example:"Team"`
	Description *string `json:"description" description:"Mô tả ngắn, tối đa 500 ký tự; chuỗi rỗng để xoá" example:"Nhóm làm sản phẩm"`
	IconEmoji   *string `json:"icon_emoji" description:"Emoji làm icon; chuỗi rỗng để xoá. Đặt emoji sẽ bỏ ảnh icon" example:"🚀"`
	TaskPrefix  *string `json:"task_prefix" description:"Tiền tố mã task mới, 2–10 ký tự A-Z/0-9, bắt đầu bằng chữ; mã cũ vẫn tra được" example:"MKT"`
	Slug        *string `json:"slug" description:"Slug mới trên URL, 2–40 ký tự a-z, 0-9, gạch ngang; slug cũ tự chuyển sang slug mới" example:"team-moi"`
}

// UploadWorkspaceIconSDI is POST /api/v1/workspaces/{workspaceID}/icon (multipart).
type UploadWorkspaceIconSDI struct {
	File []byte `formData:"file" description:"Ảnh PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB"`
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
