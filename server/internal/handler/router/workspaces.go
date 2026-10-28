package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: workspaces — workspace, members, invitations. Requires Bearer.
//
//	GET    /api/v1/orgs/{org}/workspaces/{wsSlug}
//	GET    /api/v1/workspaces
//	PATCH  /api/v1/workspaces/{workspaceID}
//	GET    /api/v1/workspaces/{workspaceID}/me
//	GET    /api/v1/workspaces/{workspaceID}/trash
//	GET    /api/v1/workspaces/{workspaceID}/members
//	PATCH  /api/v1/workspaces/{workspaceID}/members/{userID}
//	DELETE /api/v1/workspaces/{workspaceID}/members/{userID}
//	POST   /api/v1/workspaces/{workspaceID}/invitations
//	GET    /api/v1/invitations/{token}
//	POST   /api/v1/invitations/{token}/accept
//
// stepUpLimit is the step-up budget (signInBudgets) of the two joins that
// may switch organizations: their resolve takes the owner's proof of a
// hand-over (a step-up token, or the legacy password), so a guess at that
// password rides the same per-person budget as every other proof route.
func registerWorkspaces(r api, h Routes, stepUpLimit func(http.Handler) http.Handler) {
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
		description: "Đổi tên, mô tả, icon emoji, tiền tố mã task hoặc slug của workspace (mã và slug cũ vẫn tra được); trường không gửi giữ nguyên. Cần admin workspace (hoặc owner/admin tổ chức).",
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
	r.Get("/workspaces/{workspaceID}/trash", h.ListTrash, apiOp{
		summary: "List shared trash",
		description: "Thùng rác chung của workspace: lô công việc (chỉ công việc gốc), dự án và tài liệu đã xóa, mới xóa trước, 50 mỗi trang. " +
			"Mỗi loại giữ luật quyền của nó; dòng tài liệu là đúng những gì thùng rác tài liệu trả cho người gọi, và vắng khi cờ documents tắt. " +
			"Query: kind và trashed_by lặp được (các giá trị trong một tham số cộng nhau, các tham số và q thu hẹp nhau), q, cursor; " +
			"kind lạ hoặc rỗng, trashed_by rỗng hoặc quá 100 giá trị -> 400 invalid_filter, cursor hỏng -> 400. Người ngoài workspace -> 404.",
		tags: []string{"workspaces"},
		sdi:  sdi.ListSharedTrashSDI{},
		sdo:  sdo.TrashPageSDO{},
		auth: true,
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
	r.Get("/workspaces/{workspaceID}/invite-links", h.ListWorkspaceInviteLinks, apiOp{
		summary:     "List workspace invite links",
		description: "Danh sách liên kết mời shareable của workspace. Chỉ owner/admin. Secret chỉ có khi link còn Active.",
		tags:        []string{"workspaces"},
		sdo:         sdo.MembershipInviteLinkListSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/invite-links", h.CreateWorkspaceInviteLink, apiOp{
		summary:     "Create workspace invite link",
		description: "Tạo liên kết mời vào đúng workspace này, vai trò Member, mặc định hết hạn sau 7 ngày (1–30).",
		tags:        []string{"workspaces"},
		sdi:         sdi.CreateMembershipInviteLinkSDI{},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/invite-links/regenerate", h.RegenerateWorkspaceInviteLink, apiOp{
		summary:     "Regenerate workspace invite link",
		description: "Thu hồi link Active hiện có (nếu có) và tạo link mới cho workspace.",
		tags:        []string{"workspaces"},
		sdi:         sdi.CreateMembershipInviteLinkSDI{},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/invite-links/{linkID}/revoke", h.RevokeWorkspaceInviteLink, apiOp{
		summary:     "Revoke workspace invite link",
		description: "Thu hồi một liên kết Active. Thành viên đã gia nhập không bị ảnh hưởng.",
		tags:        []string{"workspaces"},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Post("/membership-invite-links/preview", h.PreviewMembershipInviteLink, apiOp{
		summary:     "Preview membership invite link",
		description: "Xem tổ chức/workspace gắn với link và trạng thái thành viên của người gọi. Không tạo membership.",
		tags:        []string{"workspaces"},
		sdi:         sdi.PreviewMembershipInviteLinkSDI{},
		sdo:         sdo.MembershipInvitePreviewSDO{},
		auth:        true,
	})
	r.With(stepUpLimit).Post("/membership-invite-links/join", h.JoinMembershipInviteLink, apiOp{
		summary: "Join via membership invite link",
		description: "Gia nhập tổ chức và các workspace còn thiếu trong phạm vi link. Body resolve giống accept invitation khi cần chuyển tổ chức: " +
			"bước transfer chứng minh bằng resolve[].step_up_token (hoặc password cũ, xem lại 2027-01-31); thiếu bằng chứng → 403 proof_required kèm proofs.",
		tags: []string{"workspaces"},
		sdi:  sdi.JoinMembershipInviteLinkSDI{},
		sdo:  sdo.MembershipInviteJoinSDO{},
		auth: true,
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
	r.With(stepUpLimit).Post("/invitations/{token}/accept", h.AcceptInvitation, apiOp{
		summary: "Accept invitation",
		description: "Vào tổ chức và các workspace lời mời cấp (workspace gửi lời mời, hoặc các workspace admin đã chọn; " +
			"workspace đã bị xóa thì bỏ qua). workspace trong kết quả là nơi hạ cánh, vắng mặt khi chưa có workspace nào. Body tùy chọn: resolve phải khớp đúng conflicts " +
			"của bản xem trước; mọi bước rời / chuyển quyền / đóng tổ chức cũ và tham gia tổ chức mới chạy trong một transaction. " +
			"409 organization_switch_required kèm conflicts mới nhất; 410 invitation_expired | invitation_revoked | invitation_accepted; " +
			"403 organization_suspended | organization_deletion_scheduled khi tổ chức mời không nhận thêm người; " +
			"bước chuyển quyền cần step_up_token của phiên này (POST /me/step-up, action transfer_ownership khi chứng minh bằng mã email), app đã phát hành còn gửi password (xem lại 2027-01-31); " +
			"thiếu bằng chứng → 403 proof_required kèm proofs (thay password_required), sai mật khẩu → 403 password_incorrect (tính vào khoá bước hai); " +
			"gọi lại sau khi đã thành công trả 200 như lần đầu.",
		tags: []string{"workspaces"},
		sdi:  sdi.AcceptInvitationSDI{},
		sdo:  sdo.AcceptInviteSDO{},
		auth: true,
	})
}
