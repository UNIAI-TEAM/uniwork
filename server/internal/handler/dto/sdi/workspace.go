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

// CreateInvitationSDI is POST /api/v1/workspaces/{workspaceID}/invitations.
type CreateInvitationSDI struct {
	Email  string   `json:"email" format:"email" description:"Một email mời; cũng nhận qua emails[0]" example:"binh@acme.vn"`
	Emails []string `json:"emails" description:"Danh sách email mời; trùng hoặc đã là thành viên sẽ bị bỏ qua" example:"[\"binh@acme.vn\"]"`
	Role   string   `json:"role" description:"Vai trò khi chấp nhận: member hoặc admin" example:"member"`
}

// PatchMemberSDI is PATCH /api/v1/workspaces/{workspaceID}/members/{userID}.
type PatchMemberSDI struct {
	Role string `json:"role" description:"Vai trò mới: admin hoặc member" example:"admin"`
}
