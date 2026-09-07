package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: agents — agent identities in an organization and their workspace
// membership (ADR 0007). Requires Bearer.
//
//	GET   /api/v1/orgs/{org}/agents
//	POST  /api/v1/orgs/{org}/agents
//	PATCH /api/v1/agents/{agentID}
//	GET   /api/v1/workspaces/{workspaceID}/agents
//	POST  /api/v1/workspaces/{workspaceID}/agents
func registerAgents(r api, h Routes) {
	r.Get("/orgs/{org}/agents", h.ListOrgAgents, apiOp{
		summary:     "List agents in an organization",
		description: "Mọi thành viên tổ chức thấy danh sách agent chưa lưu trữ.",
		tags:        []string{"agents"},
		sdo:         sdo.AgentListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/agents", h.CreateOrgAgent, apiOp{
		summary:     "Create agent",
		description: "Owner/admin tổ chức tạo agent; handle duy nhất trong tổ chức.",
		tags:        []string{"agents"},
		sdi:         sdi.CreateAgentSDI{},
		sdo:         sdo.AgentSDO{},
		status:      201,
		auth:        true,
	})
	r.Patch("/agents/{agentID}", h.PatchAgent, apiOp{
		summary:     "Update agent",
		description: "Owner/admin tổ chức hoặc người chịu trách nhiệm đổi tên, mô tả, ảnh, trạng thái.",
		tags:        []string{"agents"},
		sdi:         sdi.PatchAgentSDI{},
		sdo:         sdo.AgentSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/agents", h.ListWorkspaceAgents, apiOp{
		summary:     "List agents in a workspace",
		description: "Agent là thành viên workspace — những agent giao việc được.",
		tags:        []string{"agents"},
		sdo:         sdo.AgentListSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/agents", h.AddWorkspaceAgent, apiOp{
		summary:     "Add agent to workspace",
		description: "Owner/admin workspace thêm một agent active cùng tổ chức với role agent.",
		tags:        []string{"agents"},
		sdi:         sdi.AddWorkspaceAgentSDI{},
		sdo:         sdo.StatusSDO{},
		status:      201,
		auth:        true,
	})
}
