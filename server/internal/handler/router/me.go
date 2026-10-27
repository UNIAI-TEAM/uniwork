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
//	POST  /api/v1/me/mfa/setup      (step-up token)
//	POST  /api/v1/me/mfa/confirm    (step-up token, credential rate limit)
//	POST  /api/v1/me/mfa/disable    (credential rate limit)
//	GET   /api/v1/me/sessions
//	DELETE /api/v1/me/sessions/{sessionId}
//	POST  /api/v1/me/sessions/revoke-others
//	POST  /api/v1/me/delete         (step-up budget)
//	POST  /api/v1/me/step-up             (step-up budget)
//	POST  /api/v1/me/step-up/email-code  (step-up budget)
//	GET   /api/v1/me/sign-in-methods
//	PUT   /api/v1/me/password            (step-up budget)
//	POST  /api/v1/me/sign-in-methods/google/link    (credential rate limit)
//	POST  /api/v1/me/sign-in-methods/google/unlink  (credential rate limit)
//	POST  /api/v1/me/sign-in-methods/apple/unlink   (credential rate limit)
//	PUT   /api/v1/me/ai-consent
//	DELETE /api/v1/me/ai-consent
//	PUT   /api/v1/me/ask-uni-mode
//	PUT   /api/v1/me/ask-uni-memory
//
// stepUpLimit is the step-up budget (signInBudgets): every route that takes
// a signed-in person's proof, per bearer.
func registerMe(r api, h Routes, credentialLimit, stepUpLimit func(http.Handler) http.Handler) {
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
		summary: "Start MFA enrolment",
		description: "Sinh bí mật TOTP mới; chưa bật cho đến khi confirm. Cần step_up_token của phiên này (POST /me/step-up, action enable_mfa khi chứng minh bằng mã email; thiếu hay hết hạn → 403 proof_required kèm proofs). " +
			"403 email_unverified khi email tài khoản chưa xác minh; 409 khi MFA đang bật.",
		tags: []string{"me"},
		sdi:  sdi.StepUpTokenSDI{},
		sdo:  sdo.MFASetupSDO{},
		auth: true,
	})
	r.With(credentialLimit).Post("/me/mfa/confirm", h.MFAConfirm, apiOp{
		summary:     "Confirm MFA",
		description: "Xác nhận mã từ ứng dụng, bật MFA và trả 8 mã khôi phục (chỉ một lần). Cần step_up_token như /me/mfa/setup (cùng token trong 10 phút).",
		tags:        []string{"me"},
		sdi:         sdi.MFAConfirmSDI{},
		sdo:         sdo.MFARecoveryCodesSDO{},
		auth:        true,
	})
	r.With(credentialLimit).Post("/me/mfa/disable", h.MFADisable, apiOp{
		summary:     "Disable MFA",
		description: "Tắt MFA bằng mã TOTP hoặc mã khôi phục. Mã sai tính vào khoá bước hai: mười lần sai liên tiếp khoá 15 phút (429 second_factor_locked kèm retry_after).",
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
	r.With(stepUpLimit).Post("/me/delete", h.DeleteAccount, apiOp{
		summary: "Delete account",
		description: "Ẩn danh hóa tài khoản theo Nghị định 13: cần step_up_token của phiên này (POST /me/step-up, action delete_account khi chứng minh bằng mã email). " +
			"Không có token thì đọc một bằng chứng cũ cho app đã phát hành (xem lại 2027-01-31): mật khẩu, hoặc mã MFA, hoặc gõ lại email; không có gì → 403 proof_required kèm proofs. " +
			"Sai bằng chứng không bao giờ là 401 (client sẽ làm mới phiên rồi gửi lại): 403 password_incorrect khi sai mật khẩu, " +
			"403 mfa_code_incorrect khi sai mã MFA, 400 email_confirmation_mismatch khi email gõ lại không khớp; mật khẩu và mã sai tính vào khoá bước hai (429 second_factor_locked). " +
			"409 owner_must_transfer khi còn là chủ sở hữu tổ chức; error.fields nêu tổ chức đó (organization_name, organization_slug) " +
			"và can_close khi chủ sở hữu là thành viên duy nhất của tổ chức đang hoạt động: gửi lại kèm close_organization = slug đó " +
			"để đóng tổ chức và xóa tài khoản trong một giao dịch (400 close_confirm_mismatch khi slug không khớp, " +
			"409 organization_has_members khi tổ chức vừa có thêm thành viên).",
		tags: []string{"me"},
		sdi:  sdi.DeleteAccountSDI{},
		sdo:  sdo.StatusSDO{},
		auth: true,
	})
	registerSignInMethods(r, h, credentialLimit, stepUpLimit)
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
	r.Put("/me/ask-uni-memory", h.SetAskUniMemory, apiOp{
		summary: "Switch my Ask UNI memory on or off",
		description: "Công tắc Dùng bộ nhớ của người dùng, một công tắc cho mọi tổ chức; tắt thì UNI không đọc và không đề xuất bộ nhớ, các mục vẫn giữ. " +
			"Cờ ask_uni_memory phải bật ở ít nhất một tổ chức người dùng đang là thành viên, không thì 403 ai_memory_disabled. Là cài đặt của chính người dùng nên không ghi audit.",
		tags:   []string{"me"},
		sdi:    sdi.AiMemorySwitchSDI{},
		status: http.StatusNoContent,
		auth:   true,
	})
	r.Delete("/me/ai-consent", h.WithdrawAIConsent, apiOp{
		summary:     "Withdraw AI processing consent",
		description: "Rút lại đồng ý xử lý AI; lần dùng AI tiếp theo trên UniChat mobile hỏi lại. Ghi audit user.ai_consent_withdrawn.",
		tags:        []string{"me"},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
}

// registerSignInMethods is step-up and Settings › Sign-in methods (ADR 0047
// §5-6, spec §3.7). The proof routes ride the step-up budget; the link and
// unlink commands take a step-up token and ride the credential budget.
func registerSignInMethods(r api, h Routes, credentialLimit, stepUpLimit func(http.Handler) http.Handler) {
	r.With(stepUpLimit).Post("/me/step-up", h.StepUp, apiOp{
		summary: "Confirm it is you",
		description: "Đổi một bằng chứng lấy step_up_token 10 phút, gắn với phiên đang gọi (phiên web hay thiết bị; phiên bị thu hồi hay đăng xuất là token chết), dùng cho mọi lệnh nhạy cảm: đặt/đổi mật khẩu, liên kết, gỡ liên kết, bật MFA, xoá tài khoản, chuyển quyền sở hữu. " +
			"Bằng chứng nhận (sign_in_methods.proofs): bật xác thực hai lớp → chỉ code là mã TOTP hay mã khôi phục; không thì password (nếu có), code + action (mã từ POST /me/step-up/email-code; không bao giờ nhận mã dev), và trên app provider_token (Apple/Google vừa lấy, của đúng danh tính đã liên kết). " +
			"Sai → 403 password_incorrect / mfa_code_incorrect / step_up_code_incorrect / provider_token_invalid; bằng chứng tài khoản không nhận hay thiếu → 403 proof_required kèm proofs; mười lần sai (cộng chung với bước hai khi đăng nhập) → 429 second_factor_locked kèm retry_after. " +
			"Token web cũ hơn lần đổi thông tin đăng nhập, hay phiên đã kết thúc → 401 invalid_token. Không bao giờ 401 cho bằng chứng sai.",
		tags: []string{"me"},
		sdi:  sdi.StepUpSDI{},
		sdo:  sdo.StepUpSDO{},
		auth: true,
	})
	r.With(stepUpLimit).Post("/me/step-up/email-code", h.StepUpEmailCode, apiOp{
		summary: "Mail a confirmation code",
		description: "Gửi mã 6 số (10 phút, 5 lần thử) tới email tài khoản, nêu việc (action), thiết bị, địa chỉ IP và \"Không chia sẻ mã\"; chỉ dùng được cho đúng action ở POST /me/step-up. " +
			"Một mã mỗi 60 giây và tối đa 5 mã mỗi ngày (429 rate_limited kèm retry_after). Tài khoản bật xác thực hai lớp không nhận mã email: 403 proof_required kèm proofs. action lạ → 400 invalid_request.",
		tags: []string{"me"},
		sdi:  sdi.StepUpEmailCodeSDI{},
		sdo:  sdo.StatusSDO{},
		auth: true,
	})
	r.Get("/me/sign-in-methods", h.SignInMethods, apiOp{
		summary:     "List sign-in methods",
		description: "Các cách vào tài khoản: mật khẩu (đã đặt, lần đổi gần nhất), Google, Apple (email, ngày liên kết, email ẩn của Apple), email tài khoản có phải email ẩn của Apple, và các bằng chứng lệnh nhạy cảm nhận trên kênh đang gọi (proofs).",
		tags:        []string{"me"},
		sdo:         sdo.SignInMethodsSDO{},
		auth:        true,
	})
	r.With(stepUpLimit).Put("/me/password", h.SetPassword, apiOp{
		summary: "Set or change the password",
		description: "Có mật khẩu: current_password là bằng chứng (hay step_up_token); chưa có: cần step_up_token (action set_password khi chứng minh bằng mã email). new_password tối thiểu 8 ký tự (400 invalid_request). " +
			"Đổi mật khẩu luôn đăng xuất mọi phiên khác (web, thiết bị, kết nối AI qua MCP) và từ chối token web cũ hơn trên lệnh nhạy cảm; đặt lần đầu không đăng xuất ai. Ghi audit auth.password_set / auth.password_changed (via settings) và gửi mail. " +
			"Sai mật khẩu hiện tại → 403 password_incorrect (tính vào khoá bước hai); thiếu bằng chứng → 403 proof_required kèm proofs.",
		tags: []string{"me"},
		sdi:  sdi.SetPasswordSDI{},
		sdo:  sdo.SignInMethodsChangeSDO{},
		auth: true,
	})
	r.With(credentialLimit).Post("/me/sign-in-methods/google/link", h.LinkGoogle, apiOp{
		summary: "Start linking Google",
		description: "Từ trình duyệt đang đăng nhập, với step_up_token: trả authorization_url (GET /auth/google/start?intent=link&link_token=…, token 5 phút gắn với tài khoản và phiên này). Trình duyệt đi qua Google rồi về return_to kèm sign_in_method=google&result=…. " +
			"403 email_unverified khi email tài khoản chưa xác minh; 409 sign_in_method_already_linked khi đã liên kết Google; bearer của app → 400 invalid_request (app liên kết bằng SDK); 503 google_not_configured.",
		tags: []string{"me"},
		sdi:  sdi.LinkSignInMethodSDI{},
		sdo:  sdo.AuthorizationURLSDO{},
		auth: true,
	})
	r.With(credentialLimit).Post("/me/sign-in-methods/apple/link", h.LinkApple, apiOp{
		summary: "Start linking Apple",
		description: "Từ trình duyệt đang đăng nhập, với step_up_token: trả authorization_url (GET /auth/apple/start?intent=link&link_token=…, token 5 phút gắn với tài khoản và phiên này). Trình duyệt đi qua Apple rồi về return_to kèm sign_in_method=apple&result=…; tài khoản giữ token Apple của Services ID để thu hồi khi xoá tài khoản. " +
			"403 email_unverified khi email tài khoản chưa xác minh; 409 sign_in_method_already_linked khi đã liên kết Apple; bearer của app → 400 invalid_request (app liên kết bằng sheet Apple); 503 apple_not_configured khi Sign in with Apple trên web chưa cấu hình.",
		tags: []string{"me"},
		sdi:  sdi.LinkSignInMethodSDI{},
		sdo:  sdo.AuthorizationURLSDO{},
		auth: true,
	})
	for _, p := range []struct {
		path, provider string
		handler        http.HandlerFunc
	}{
		{"/me/sign-in-methods/google/unlink", "Google", h.UnlinkGoogle},
		{"/me/sign-in-methods/apple/unlink", "Apple", h.UnlinkApple},
	} {
		r.With(credentialLimit).Post(p.path, p.handler, apiOp{
			summary: "Unlink " + p.provider,
			description: "Gỡ " + p.provider + " khỏi tài khoản, với step_up_token. Không gỡ cách đăng nhập cuối cùng (409 sign_in_method_last); không gỡ Apple khi email tài khoản là email ẩn của Apple (409 sign_in_method_relay_email). " +
				"Danh tính đã gỡ không tự liên kết lại theo email. Đăng xuất mọi phiên khác (web, thiết bị, kết nối AI qua MCP); gỡ Apple trả lại quyền Apple của tài khoản. Ghi audit auth.sign_in_method_unlinked (via settings) và gửi mail. Chưa liên kết thì trả trạng thái hiện tại, không ghi gì.",
			tags: []string{"me"},
			sdi:  sdi.StepUpTokenSDI{},
			sdo:  sdo.SignInMethodsChangeSDO{},
			auth: true,
		})
	}
}
