package sdo

// ActorDTO is how every API names who did something (ADR 0007). The client
// draws the badge from kind and never infers it from the name or avatar.
type ActorDTO struct {
	ID          string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Kind        string `json:"kind" description:"human, agent hoặc system" example:"agent"`
	DisplayName string `json:"display_name" example:"UNI"`
	AvatarURL   string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/uni.png"`
}

type AgentDTO struct {
	ID             string `json:"id" description:"ULID agent" example:"01J8X4AGENT0N1P2Q3R4S5T6"`
	OrganizationID string `json:"organization_id" example:"01J8X4ORG0N1P2Q3R4S5T6U7"`
	Name           string `json:"name" example:"UNI"`
	Handle         string `json:"handle" example:"uni"`
	Description    string `json:"description" example:"Đồng nghiệp AI mặc định"`
	AvatarURL      string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/uni.png"`
	Status         string `json:"status" description:"active, paused hoặc archived" example:"active"`
	OwnerUserID    string `json:"owner_user_id" description:"Người chịu trách nhiệm" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedAt      string `json:"created_at" example:"2026-09-06T09:00:00Z"`
}

// AgentSDO wraps one agent.
type AgentSDO struct {
	Agent AgentDTO `json:"agent"`
}

// AgentListSDO is GET /api/v1/orgs/{org}/agents and GET /api/v1/workspaces/{workspaceID}/agents.
type AgentListSDO struct {
	Agents []AgentDTO `json:"agents"`
}
