package sdi

// CreateAgentSDI is POST /api/v1/orgs/{org}/agents.
type CreateAgentSDI struct {
	Name        string  `json:"name" minLength:"1" description:"Tên hiển thị" example:"UNI"`
	Handle      string  `json:"handle" minLength:"2" maxLength:"32" description:"Định danh @mention, duy nhất trong tổ chức: chữ thường, số, '-' hoặc '_'" example:"uni"`
	Description string  `json:"description" description:"Mô tả vai trò của agent" example:"Đồng nghiệp AI mặc định"`
	AvatarURL   *string `json:"avatar_url" description:"Ảnh đại diện; bỏ trống dùng mặc định" example:"https://cdn.example.com/avatars/uni.png"`
}

// PatchAgentSDI is PATCH /api/v1/agents/{agentID}. Field vắng mặt = không đổi.
type PatchAgentSDI struct {
	Name        *string `json:"name" example:"UNI"`
	Description *string `json:"description" example:"Đồng nghiệp AI mặc định"`
	AvatarURL   *string `json:"avatar_url" example:"https://cdn.example.com/avatars/uni.png"`
	Status      *string `json:"status" description:"active, paused hoặc archived" example:"paused"`
}

// AddWorkspaceAgentSDI is POST /api/v1/workspaces/{workspaceID}/agents.
type AddWorkspaceAgentSDI struct {
	AgentID string `json:"agent_id" minLength:"1" description:"ULID agent cùng tổ chức" example:"01J8X4AGENT0N1P2Q3R4S5T6"`
}
