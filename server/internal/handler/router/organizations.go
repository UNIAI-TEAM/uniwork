package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: organizations — org CRUD and workspaces nested under an org. Requires Bearer.
//
//	GET  /api/v1/orgs
//	POST /api/v1/orgs
//	GET  /api/v1/orgs/{org}
//	GET  /api/v1/orgs/{org}/workspaces
//	POST /api/v1/orgs/{org}/workspaces
func registerOrganizations(r api, h Routes) {
	r.Get("/orgs", h.ListOrganizations, apiOp{
		summary:     "List organizations",
		description: "Các tổ chức người gọi thuộc về, kèm vai trò trong tổ chức.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrganizationListSDO{},
		auth:        true,
	})
	r.Post("/orgs", h.CreateOrganization, apiOp{
		summary:     "Create organization",
		description: "Tạo tổ chức và đặt người gọi làm owner.",
		tags:        []string{"organizations"},
		sdi:         sdi.CreateOrganizationSDI{},
		sdo:         sdo.OrganizationSDO{},
		status:      201,
		auth:        true,
	})
	r.Get("/orgs/{org}", h.GetOrganization, apiOp{
		summary:     "Get organization by slug",
		description: "Trả một tổ chức mà người gọi là thành viên.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrganizationSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/workspaces", h.ListOrgWorkspaces, apiOp{
		summary:     "List workspaces in an organization",
		description: "Các workspace trong tổ chức mà người gọi nhìn thấy.",
		tags:        []string{"organizations"},
		sdo:         sdo.WorkspaceListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/workspaces", h.CreateOrgWorkspace, apiOp{
		summary:     "Create workspace in an organization",
		description: "Tạo workspace. Owner và admin của tổ chức được phép.",
		tags:        []string{"organizations"},
		sdi:         sdi.CreateWorkspaceSDI{},
		sdo:         sdo.WorkspaceSDO{},
		status:      201,
		auth:        true,
	})
}
