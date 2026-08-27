package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: workspaces — workspace, members, invitations. Requires Bearer.
//
//	GET   /api/v1/orgs/{org}/workspaces/{wsSlug}
//	GET   /api/v1/workspaces
//	PATCH /api/v1/workspaces/{workspaceID}
//	GET   /api/v1/workspaces/{workspaceID}/members
//	POST  /api/v1/workspaces/{workspaceID}/invitations
//	POST  /api/v1/invitations/{token}/accept
func registerWorkspaces(r api, h Routes) {
	r.Get("/orgs/{org}/workspaces/{wsSlug}", h.GetWorkspaceBySlugs, apiOp{
		summary:     "Get workspace by slugs",
		description: "Đổi /{orgSlug}/{workspaceSlug} thành workspace người gọi được vào.",
		tags:        []string{"workspaces"},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Get("/workspaces", h.ListWorkspaces, apiOp{
		summary:     "List workspaces",
		description: "Mọi workspace người gọi được vào, trên mọi tổ chức.",
		tags:        []string{"workspaces"},
		sdo:         sdo.WorkspaceListSDO{},
		auth:        true,
	})
	r.Patch("/workspaces/{workspaceID}", h.PatchWorkspace, apiOp{
		summary:     "Update workspace",
		description: "Đổi tên workspace. Cần admin workspace (hoặc owner/admin tổ chức).",
		tags:        []string{"workspaces"},
		sdi:         sdi.PatchWorkspaceSDI{},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/members", h.ListMembers, apiOp{
		summary:     "List workspace members",
		description: "Thành viên workspace, gồm cả admin ngầm từ tổ chức.",
		tags:        []string{"workspaces"},
		sdo:         sdo.MemberListSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/invitations", h.CreateInvitation, apiOp{
		summary:     "Invite members",
		description: "Gửi lời mời theo email. Email đã là thành viên hoặc không hợp lệ bị bỏ qua.",
		tags:        []string{"workspaces"},
		sdi:         sdi.CreateInvitationSDI{},
		sdo:         sdo.InvitationCreateSDO{},
		auth:        true,
	})
	r.Post("/invitations/{token}/accept", h.AcceptInvitation, apiOp{
		summary:     "Accept invitation",
		description: "Vào workspace ghi trên token lời mời.",
		tags:        []string{"workspaces"},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
}
