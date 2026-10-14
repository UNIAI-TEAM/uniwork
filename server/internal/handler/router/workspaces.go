package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: workspaces — workspace, members, invitations. Requires Bearer.
//
//	GET    /api/v1/orgs/{org}/workspaces/{wsSlug}
//	GET    /api/v1/workspaces
//	PATCH  /api/v1/workspaces/{workspaceID}
//	GET    /api/v1/workspaces/{workspaceID}/me
//	GET    /api/v1/workspaces/{workspaceID}/members
//	PATCH  /api/v1/workspaces/{workspaceID}/members/{userID}
//	DELETE /api/v1/workspaces/{workspaceID}/members/{userID}
//	POST   /api/v1/workspaces/{workspaceID}/invitations
//	GET    /api/v1/invitations/{token}
//	POST   /api/v1/invitations/{token}/accept
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
		description: "Đổi tên, mô tả, icon emoji hoặc tiền tố mã task của workspace; trường không gửi giữ nguyên. Cần admin workspace (hoặc owner/admin tổ chức).",
		tags:        []string{"workspaces"},
		sdi:         sdi.PatchWorkspaceSDI{},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/icon", h.UploadWorkspaceIcon, apiOp{
		summary:     "Upload workspace icon",
		description: "Đặt ảnh làm icon workspace, bỏ emoji nếu có. Tên field multipart là file. PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB. Cần admin workspace.",
		tags:        []string{"workspaces"},
		sdi:         sdi.UploadWorkspaceIconSDI{},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/icon", h.RemoveWorkspaceIcon, apiOp{
		summary:     "Remove workspace icon",
		description: "Bỏ icon workspace (emoji hoặc ảnh); workspace hiện lại chữ cái đầu của tên. Cần admin workspace.",
		tags:        []string{"workspaces"},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/me", h.GetWorkspaceMe, apiOp{
		summary:     "Get current membership",
		description: "Vai trò hiệu lực của người gọi trong workspace (membership tường minh hoặc admin ngầm từ tổ chức).",
		tags:        []string{"workspaces"},
		sdo:         sdo.MembershipSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/members", h.ListMembers, apiOp{
		summary:     "List workspace members",
		description: "Thành viên tường minh trên workspace_members (không gồm admin ngầm từ tổ chức).",
		tags:        []string{"workspaces"},
		sdo:         sdo.MemberListSDO{},
		auth:        true,
	})
	r.Patch("/workspaces/{workspaceID}/members/{userID}", h.PatchMember, apiOp{
		summary:     "Update member role",
		description: "Đổi role admin ↔ member. Không đổi owner tường minh; không PATCH thành owner. Cần admin workspace.",
		tags:        []string{"workspaces"},
		sdi:         sdi.PatchMemberSDI{},
		sdo:         sdo.MemberSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/members/{userID}", h.DeleteMember, apiOp{
		summary:     "Remove workspace member",
		description: "Xóa dòng workspace_members. Không xóa owner tường minh. Người gọi được tự rời nếu không phải owner.",
		tags:        []string{"workspaces"},
		sdo:         sdo.StatusSDO{},
		status:      204,
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
	r.Get("/invitations/{token}", h.PreviewInvitation, apiOp{
		summary: "Preview invitation",
		description: "Lời mời theo token, ở mọi trạng thái (pending | expired | revoked | accepted), cho đúng tài khoản " +
			"đã xác minh email được mời. Khi pending, conflicts liệt kê các tổ chức người gọi đang thuộc và việc cần làm " +
			"với từng tổ chức trước khi tham gia (leave | transfer | close | blocked). Không thay đổi gì. Lời mời pending vào " +
			"tổ chức không nhận thêm người trả 403 organization_suspended | organization_deletion_scheduled như accept.",
		tags: []string{"workspaces"},
		sdo:  sdo.InvitationPreviewSDO{},
		auth: true,
	})
	r.Post("/invitations/{token}/accept", h.AcceptInvitation, apiOp{
		summary: "Accept invitation",
		description: "Vào tổ chức (và workspace nếu có) ghi trên token lời mời. Body tùy chọn: resolve phải khớp đúng conflicts " +
			"của bản xem trước; mọi bước rời / chuyển quyền / đóng tổ chức cũ và tham gia tổ chức mới chạy trong một transaction. " +
			"409 organization_switch_required kèm conflicts mới nhất; 410 invitation_expired | invitation_revoked | invitation_accepted; " +
			"403 organization_suspended | organization_deletion_scheduled khi tổ chức mời không nhận thêm người; " +
			"gọi lại sau khi đã thành công trả 200 như lần đầu.",
		tags: []string{"workspaces"},
		sdi:  sdi.AcceptInvitationSDI{},
		sdo:  sdo.AcceptInviteSDO{},
		auth: true,
	})
}
