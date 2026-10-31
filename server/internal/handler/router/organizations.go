package router

import (
	"net/http"

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
//	GET  /api/v1/orgs/{org}/members/{userID}/document-ownership
//	POST /api/v1/orgs/{org}/members/{userID}/document-ownership
//	POST /api/v1/orgs/{org}/leave
//	POST /api/v1/orgs/{org}/close
//	POST /api/v1/orgs/{org}/transfer-ownership   (step-up budget)
//	GET  /api/v1/orgs/{orgID}/office/capabilities
//	GET  /api/v1/orgs/{org}/invitations
//	POST /api/v1/orgs/{org}/invitations
//	DELETE /api/v1/orgs/{org}/invitations/{invitationId}
//
// stepUpLimit is the step-up budget (signInBudgets) of the hand-over, which
// takes the owner's proof.
func registerOrganizations(r api, h Routes, stepUpLimit func(http.Handler) http.Handler) {
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
	r.Get("/orgs/{org}/push-preview-policy", h.OrgPushPreviewPolicy, apiOp{
		summary:     "Read whether pushes hide previews",
		description: "Chính sách của tổ chức: push ẩn nội dung hay không (tên người, phòng, việc, tài liệu và chữ trong tin). Mọi thành viên đọc được (điện thoại nói vì sao nội dung bị ẩn); can_manage cho owner/admin.",
		tags:        []string{"organizations"},
		sdo:         sdo.PushPreviewPolicySDO{},
		auth:        true,
	})
	r.Put("/orgs/{org}/push-preview-policy", h.SetOrgPushPreviewPolicy, apiOp{
		summary:     "Hide or show previews in every push of the organization",
		description: "Owner/admin bật/tắt ẩn nội dung (tên người, phòng, việc, tài liệu, chữ trong tin) trong mọi push của tổ chức trừ chuông cuộc gọi đến (hidden bắt buộc), thắng lựa chọn của từng người. Thành viên thường -> 403. Không đổi gì thì không ghi audit; có đổi thì ghi organization.push_preview_policy_changed.",
		tags:        []string{"organizations"},
		sdi:         sdi.PushPreviewPolicySDI{},
		sdo:         sdo.PushPreviewPolicySDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/mobile-security-policy", h.OrgMobileSecurityPolicy, apiOp{
		summary:     "Read the organization's phone security requirements",
		description: "Chính sách của tổ chức cho UniChat trên điện thoại: bắt buộc khoá app, bắt buộc chặn chụp/quay màn hình. Mọi thành viên đọc được (điện thoại coi là mức tối thiểu và nói vì sao công tắc bị khoá); can_manage cho owner/admin.",
		tags:        []string{"organizations"},
		sdo:         sdo.MobileSecurityPolicySDO{},
		auth:        true,
	})
	r.Put("/orgs/{org}/mobile-security-policy", h.SetOrgMobileSecurityPolicy, apiOp{
		summary:     "Require the app lock or screen-capture blocking on members' phones",
		description: "Owner/admin bật/tắt yêu cầu khoá UniChat và chặn chụp màn hình trên điện thoại của mọi thành viên (ít nhất một trường; trường bỏ trống giữ nguyên). Thành viên thường -> 403. Không đổi gì thì không ghi audit; có đổi thì ghi organization.mobile_security_policy_changed.",
		tags:        []string{"organizations"},
		sdi:         sdi.MobileSecurityPolicySDI{},
		sdo:         sdo.MobileSecurityPolicySDO{},
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
	// DOC-06b (UNI-2092, addendum §2.2, §4.2): the documents a member holds
	// the ACL owner slot of, and their transfer in batches of 500.
	r.Get("/orgs/{org}/members/{userID}/document-ownership", h.GetMemberDocumentOwnership, apiOp{
		summary: "Count an organization member's documents",
		description: "Owner/admin tổ chức xem thành viên (đang hoạt động hoặc đã vô hiệu hóa) là chủ sở hữu bao nhiêu tài liệu, theo workspace; chỉ đếm, không trả tiêu đề. " +
			"Tính cả tài liệu trong thùng rác chưa xóa hẳn; không tính tài liệu thuộc Work Product và thư mục gốc My Folder. " +
			"403 khi người gọi không phải owner/admin, hoặc là admin xem admin khác/owner; 404 khi thành viên không thuộc tổ chức.",
		tags: []string{"organizations"},
		sdo:  sdo.MemberDocumentOwnershipSDO{},
		auth: true,
	})
	r.Post("/orgs/{org}/members/{userID}/document-ownership", h.TransferMemberDocuments, apiOp{
		summary: "Transfer an organization member's documents",
		description: "Owner/admin tổ chức chuyển tối đa 500 tài liệu của thành viên cho một người nhận mỗi lần gọi; còn nữa thì has_more + cursor, gọi tiếp với bulk_id và cursor đó. " +
			"Tài liệu ở workspace người nhận chưa tham gia, và tài liệu hạn chế người gọi tự nhận mà không có quyền quản lý, được bỏ qua và đếm trong skipped. Chủ cũ không giữ quyền. " +
			"400 invalid_request khi thiếu to_user_id hoặc bulk_id/cursor không phải ULID; 403 khi người gọi không phải owner/admin, hoặc là admin thao tác trên admin khác/owner; " +
			"404 khi thành viên không thuộc tổ chức; 422 owner_target_not_member khi người nhận trùng thành viên nguồn hoặc không phải thành viên đang hoạt động của tổ chức.",
		tags: []string{"organizations"},
		sdi:  sdi.TransferMemberDocumentsSDI{},
		sdo:  sdo.MemberDocumentsTransferSDO{},
		auth: true,
	})
	r.With(stepUpLimit).Post("/orgs/{org}/transfer-ownership", h.TransferOrgOwnership, apiOp{
		summary: "Transfer organization ownership",
		description: "Chủ sở hữu chuyển quyền cho một thành viên đang hoạt động; owner cũ thành admin trong cùng transaction. Cần step_up_token của phiên này (POST /me/step-up, action transfer_ownership khi chứng minh bằng mã email: chủ chỉ có Google/Apple dùng cách này); " +
			"app đã phát hành còn gửi password (xem lại 2027-01-31). Thiếu bằng chứng → 403 proof_required kèm proofs (thay password_required); sai mật khẩu → 403 password_incorrect (không phải 401, để client không làm mới phiên rồi gửi lại), tính vào khoá bước hai.",
		tags: []string{"organizations"},
		sdi:  sdi.TransferOwnershipSDI{},
		sdo:  sdo.OrgMemberSDO{},
		auth: true,
	})
	// The Office app capability route (X-03): the features enabled for one
	// organization, evaluated with the same override resolution as
	// GET /api/v1/config. It is not the per-document route of the same name
	// (GET /documents/{documentID}/office/capabilities). A flag hides a
	// capability and grants nothing; a read writes no audit row.
	r.Get("/orgs/{orgID}/office/capabilities", h.OfficeAppCapabilities, apiOp{
		summary:     "Office features enabled for this organization (app)",
		description: "App desktop đọc: các tính năng Office đang bật cho tổ chức này, đánh giá theo override user > organization > global như GET /api/v1/config. Tắt flag chỉ ẩn năng lực, không phải từ chối quyền. ai_uniwork_formats rỗng khi office_ai_uniwork tắt.",
		tags:        []string{"organizations"},
		sdo:         sdo.OfficeAppCapabilitiesSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/invitations", h.ListOrgInvitations, apiOp{
		summary:     "List pending organization invitations",
		description: "Lời mời cấp tổ chức chưa được chấp nhận và chưa thu hồi, kèm các workspace mỗi lời mời cấp.",
		tags:        []string{"organizations"},
		sdo:         sdo.OrgInvitationListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/invitations", h.InviteToOrganization, apiOp{
		summary: "Invite people to the organization",
		description: "Mời vào tổ chức, kèm 0..n workspace của tổ chức (workspace_ids) người được mời sẽ vào với vai trò member khi chấp nhận. " +
			"Workspace ngoài tổ chức trả 400 workspace_not_in_organization. Địa chỉ đã là thành viên bị bỏ qua; địa chỉ đã có lời mời " +
			"giữ nguyên token cũ và nhận lựa chọn workspace mới nhất.",
		tags: []string{"organizations"},
		sdi:  sdi.OrgInviteSDI{},
		sdo:  sdo.OrgInvitationListSDO{},
		auth: true,
	})
	r.Get("/orgs/{org}/invite-links", h.ListOrgInviteLinks, apiOp{
		summary:     "List organization invite links",
		description: "Danh sách liên kết mời shareable của tổ chức (gắn một hoặc nhiều workspace). Chỉ owner/admin.",
		tags:        []string{"organizations"},
		sdo:         sdo.MembershipInviteLinkListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/invite-links", h.CreateOrgInviteLink, apiOp{
		summary:     "Create organization invite link",
		description: "Tạo liên kết mời vào tổ chức và các workspace được chọn (bắt buộc ≥1). Vai trò mặc định Member.",
		tags:        []string{"organizations"},
		sdi:         sdi.CreateMembershipInviteLinkSDI{},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/invite-links/{linkID}/revoke", h.RevokeOrgInviteLink, apiOp{
		summary:     "Revoke organization invite link",
		description: "Thu hồi một liên kết Active của tổ chức.",
		tags:        []string{"organizations"},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/invite-links/{linkID}/regenerate", h.RegenerateOrgInviteLink, apiOp{
		summary:     "Regenerate organization invite link",
		description: "Thu hồi link Active và tạo link mới với cùng danh sách workspace.",
		tags:        []string{"organizations"},
		sdi:         sdi.CreateMembershipInviteLinkSDI{},
		sdo:         sdo.MembershipInviteLinkSDO{},
		auth:        true,
	})
	r.Delete("/orgs/{org}/invitations/{invitationId}", h.RevokeOrgInvitation, apiOp{
		summary:     "Revoke an organization invitation",
		description: "Thu hồi lời mời chưa chấp nhận; dòng dữ liệu vẫn giữ để truy vết.",
		tags:        []string{"organizations"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/leave", h.LeaveOrganization, apiOp{
		summary:     "Leave an organization",
		description: "Tự rời tổ chức; xóa luôn tư cách thành viên mọi workspace trong tổ chức. Owner phải chuyển quyền trước.",
		tags:        []string{"organizations"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/close", h.CloseOrganization, apiOp{
		summary:     "Close an organization",
		description: "Chủ sở hữu là thành viên hoạt động duy nhất đóng tổ chức: tổ chức được lưu trữ (không xóa dữ liệu), lời mời đang chờ bị thu hồi, gói dịch vụ bị hủy và chủ sở hữu được tự do tham gia hoặc tạo tổ chức khác. Phải gõ lại slug để xác nhận.",
		tags:        []string{"organizations"},
		sdi:         sdi.CloseOrganizationSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}
