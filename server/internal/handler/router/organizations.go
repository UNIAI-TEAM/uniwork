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
//	GET  /api/v1/orgs/{org}/members
//	GET  /api/v1/orgs/{org}/members/me
//	PATCH /api/v1/orgs/{org}/members/{userID}
//	POST /api/v1/orgs/{org}/members/{userID}/deactivate
//	POST /api/v1/orgs/{org}/members/{userID}/reactivate
//	POST /api/v1/orgs/{org}/leave
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
	r.Get("/orgs/{org}/members", h.ListOrgMembers, apiOp{
		summary:     "List organization members",
		description: "Danh sách thành viên tổ chức. Mọi thành viên đọc được; lọc theo status (active mặc định, deactivated, all) và phân trang bằng cursor.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrgMemberListSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/members/me", h.GetOrgMembershipMe, apiOp{
		summary:     "Get my membership in an organization",
		description: "Vai trò của người gọi trong tổ chức. Trả cả khi tài khoản đã bị vô hiệu hóa để client hiện màn chặn.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrgMembershipSDO{},
		auth:        true,
	})
	r.Patch("/orgs/{org}/members/{userID}", h.PatchOrgMember, apiOp{
		summary:     "Change an organization member's role",
		description: "Owner/admin đổi giữa admin và member. Không đổi được vai trò owner: dùng chuyển quyền chủ sở hữu.",
		tags:        []string{"organizations"},
		sdi:         sdi.OrgMemberRoleSDI{},
		sdo:         sdo.OrgMemberSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/members/{userID}/deactivate", h.DeactivateOrgMember, apiOp{
		summary:     "Deactivate an organization member",
		description: "Khóa lối vào tổ chức mà không xóa dữ liệu. Admin chỉ vô hiệu hóa được member; owner vô hiệu hóa được cả admin.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrgMemberSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/members/{userID}/reactivate", h.ReactivateOrgMember, apiOp{
		summary:     "Reactivate an organization member",
		description: "Mở lại lối vào; chiếm lại một ghế trong hạn mức members.max.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrgMemberSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/leave", h.LeaveOrganization, apiOp{
		summary:     "Leave an organization",
		description: "Tự rời tổ chức; xóa luôn tư cách thành viên mọi workspace trong tổ chức. Owner phải chuyển quyền trước.",
		tags:        []string{"organizations"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}
