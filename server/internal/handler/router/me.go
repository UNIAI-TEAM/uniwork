package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: me — current user. Requires Bearer.
//
//	GET   /api/v1/me
//	PATCH /api/v1/me
//	POST  /api/v1/me/email/verify   (credential rate limit)
//	POST  /api/v1/me/email/resend   (credential rate limit)
//	POST  /api/v1/me/avatar
//	PATCH /api/v1/me/onboarding
//	POST  /api/v1/me/onboarding/complete
//	GET   /api/v1/me/invitations
//	POST  /api/v1/me/mfa/setup
//	POST  /api/v1/me/mfa/confirm    (credential rate limit)
//	POST  /api/v1/me/mfa/disable    (credential rate limit)
//	GET   /api/v1/me/sessions
//	DELETE /api/v1/me/sessions/{sessionId}
//	POST  /api/v1/me/sessions/revoke-others
//	POST  /api/v1/me/delete         (credential rate limit)
//	PUT   /api/v1/me/ai-consent
//	DELETE /api/v1/me/ai-consent
//	PUT   /api/v1/me/ask-uni-mode
func registerMe(r api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	r.Get("/me", h.Me, apiOp{
		summary:     "Current user",
		description: "Trả người dùng đang đăng nhập, gồm trạng thái onboarding.",
		tags:        []string{"me"},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Patch("/me", h.PatchMe, apiOp{
		summary:     "Update profile",
		description: "Đổi tên hiển thị hoặc ngôn ngữ email.",
		tags:        []string{"me"},
		sdi:         sdi.PatchMeSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/email/verify", h.VerifyEmail, apiOp{
		summary:     "Verify email",
		description: "Xác nhận địa chỉ email bằng mã 6 số đã gửi.",
		tags:        []string{"me"},
		sdi:         sdi.VerifyEmailSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/email/resend", h.ResendVerification, apiOp{
		summary:     "Resend verification code",
		description: "Gửi lại mã xác nhận email. Tối đa một lần mỗi 60 giây.",
		tags:        []string{"me"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/me/avatar", h.UploadAvatar, apiOp{
		summary:     "Upload avatar",
		description: "Thay avatar. Tên field multipart là file. PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB.",
		tags:        []string{"me"},
		sdi:         sdi.UploadAvatarSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Patch("/me/onboarding", h.PatchOnboarding, apiOp{
		summary:     "Save onboarding questionnaire",
		description: "Lưu câu trả lời onboarding, chưa đánh dấu hoàn thành.",
		tags:        []string{"me"},
		sdi:         sdi.PatchOnboardingSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Post("/me/onboarding/complete", h.CompleteOnboarding, apiOp{
		summary:     "Complete onboarding",
		description: "Ghi onboarded_at. Bắt buộc trước khi vào workspace.",
		tags:        []string{"me"},
		sdi:         sdi.CompleteOnboardingSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Get("/me/invitations", h.MyInvitations, apiOp{
		summary:     "List pending invitations",
		description: "Lời mời gửi tới email hiện tại và vẫn còn hiệu lực.",
		tags:        []string{"me"},
		sdo:         sdo.PendingInvitationListSDO{},
		auth:        true,
	})
	r.Post("/me/mfa/setup", h.MFASetup, apiOp{
		summary:     "Start MFA enrolment",
		description: "Sinh bí mật TOTP mới; chưa bật cho đến khi confirm. 409 khi MFA đang bật.",
		tags:        []string{"me"},
		sdo:         sdo.MFASetupSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/mfa/confirm", h.MFAConfirm, apiOp{
		summary:     "Confirm MFA",
		description: "Xác nhận mã từ ứng dụng, bật MFA và trả 8 mã khôi phục (chỉ một lần).",
		tags:        []string{"me"},
		sdi:         sdi.MFACodeSDI{},
		sdo:         sdo.MFARecoveryCodesSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/mfa/disable", h.MFADisable, apiOp{
		summary:     "Disable MFA",
		description: "Tắt MFA bằng mã TOTP hoặc mã khôi phục.",
		tags:        []string{"me"},
		sdi:         sdi.MFACodeSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Get("/me/sessions", h.ListSessions, apiOp{
		summary:     "List sessions",
		description: "Các phiên đang mở của người dùng hiện tại; current đánh dấu phiên đang gọi.",
		tags:        []string{"me"},
		sdo:         sdo.SessionListSDO{},
		auth:        true,
	})
	r.Delete("/me/sessions/{sessionId}", h.RevokeSession, apiOp{
		summary:     "Revoke session",
		description: "Thu hồi một phiên. Access token của phiên đó còn hiệu lực tối đa 15 phút.",
		tags:        []string{"me"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/me/sessions/revoke-others", h.RevokeOtherSessions, apiOp{
		summary:     "Revoke other sessions",
		description: "Thu hồi mọi phiên trừ phiên đang gọi.",
		tags:        []string{"me"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/delete", h.DeleteAccount, apiOp{
		summary: "Delete account",
		description: "Ẩn danh hóa tài khoản theo Nghị định 13: cần mật khẩu, hoặc mã MFA, hoặc gõ lại email. " +
			"Sai bằng chứng không bao giờ là 401 (client sẽ làm mới phiên rồi gửi lại): 403 password_incorrect khi sai mật khẩu, " +
			"403 mfa_code_incorrect khi sai mã MFA, 400 email_confirmation_mismatch khi email gõ lại không khớp. " +
			"409 owner_must_transfer khi còn là chủ sở hữu tổ chức; error.fields nêu tổ chức đó (organization_name, organization_slug) " +
			"và can_close khi chủ sở hữu là thành viên duy nhất của tổ chức đang hoạt động: gửi lại kèm close_organization = slug đó " +
			"để đóng tổ chức và xóa tài khoản trong một giao dịch (400 close_confirm_mismatch khi slug không khớp, " +
			"409 organization_has_members khi tổ chức vừa có thêm thành viên).",
		tags: []string{"me"},
		sdi:  sdi.DeleteAccountSDI{},
		sdo:  sdo.StatusSDO{},
		auth: true,
	})
	r.Put("/me/ai-consent", h.SetAIConsent, apiOp{
		summary: "Agree to AI processing",
		description: "Ghi lại người dùng đã đồng ý thông báo xử lý AI (Apple 5.1.2(i)): tên nhà cung cấp và dữ liệu được gửi. " +
			"version là phiên bản thông báo; đồng ý lại cùng phiên bản không đổi gì. Ghi audit user.ai_consent_granted.",
		tags: []string{"me"},
		sdi:  sdi.SetAIConsentSDI{},
		sdo:  sdo.UserSDO{},
		auth: true,
	})
	r.Put("/me/push-previews", h.SetPushPreviews, apiOp{
		summary: "Show or hide previews in pushes",
		description: "Người dùng chọn push có hiện nội dung hay không (show bắt buộc). Ẩn thì push chỉ nói loại việc vừa xảy ra (tin riêng, lượt nhắc tên, cuộc gọi nhỡ…), không tên người, phòng, việc, tài liệu hay chữ trong tin; chuông cuộc gọi đến vẫn hiện tên người gọi. " +
			"Chính sách ẩn của tổ chức (PUT /orgs/{org}/push-preview-policy) thắng lựa chọn này. Không đổi gì thì không ghi audit; có đổi thì ghi user.push_previews_changed.",
		tags: []string{"me"},
		sdi:  sdi.SetPushPreviewsSDI{},
		sdo:  sdo.UserSDO{},
		auth: true,
	})
	r.Put("/me/ask-uni-mode", h.SetAskUniMode, apiOp{
		summary: "Set my Ask UNI mode",
		description: "Chế độ Hỏi UNI của người dùng, nhớ theo người: ask (Hỏi trước), plan (Kế hoạch) hoặc auto (Tự động); giá trị khác -> 400. " +
			"Mỗi lượt hỏi gửi mode của nó, và server hạ xuống trần của tổ chức. Là cài đặt hiển thị nên không ghi audit. Cờ ask_uni_actions tắt thì 403 ai_actions_disabled.",
		tags: []string{"me"},
		sdi:  sdi.AskUniModeSDI{},
		sdo:  sdo.AskUniModeSDO{},
		auth: true,
	})
	r.Delete("/me/ai-consent", h.WithdrawAIConsent, apiOp{
		summary:     "Withdraw AI processing consent",
		description: "Rút lại đồng ý xử lý AI; lần dùng AI tiếp theo trên UniChat mobile hỏi lại. Ghi audit user.ai_consent_withdrawn.",
		tags:        []string{"me"},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
}
