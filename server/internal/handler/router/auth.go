package router

import (
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
)

// tag: auth — public session routes (no Bearer).
//
//	POST   /api/v1/auth/register   (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/login      (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/password/forgot  (credential rate limit)
//	POST   /api/v1/auth/password/reset   (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/mfa/verify   (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/refresh
//	POST   /api/v1/auth/logout
//	GET    /api/v1/auth/providers
//	GET    /api/v1/auth/google/start     (credential rate limit)
//	GET    /api/v1/auth/google/callback  (credential rate limit)
//	GET    /api/v1/auth/sign-in-ticket                    (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/create             (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/claim-email        (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/claim-email/verify (same-site JSON, credential rate limit)
//	DELETE /api/v1/auth/sign-in-ticket                    (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/apple/native     (credential rate limit)
//
// Same-site JSON (mw.SameSiteJSON) is the login-CSRF guard of every public
// route that opens a session or spends a sign-in cookie (ADR 0047 §9). It
// runs before the budget, so what another site makes a browser send never
// spends that browser's address's budget.
func registerAuth(v1 api, h Routes, credentialLimit, refreshLimit func(http.Handler) http.Handler) {
	sessionDoor := v1.With(mw.SameSiteJSON, credentialLimit)
	sessionDoor.Post("/auth/register", h.Register, apiOp{
		summary:     "Register",
		description: "Tạo tài khoản. Ghi cookie refresh HttpOnly trên /api/v1/auth và xoá cookie vé uniwork_sign_in_ticket. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site (chống login CSRF).",
		tags:        []string{"auth"},
		sdi:         sdi.RegisterSDI{},
		sdo:         sdo.SessionSDO{},
	})
	sessionDoor.Post("/auth/login", h.Login, apiOp{
		summary:     "Login",
		description: "Đổi email và mật khẩu lấy access token cùng cookie refresh. Tài khoản bật MFA nhận {mfa_required:true, mfa_token} thay cho phiên. Đăng nhập thành công xoá cookie vé uniwork_sign_in_ticket, trừ khi keep_sign_in_ticket (đăng nhập để liên kết Google/Apple đang chờ). Chỉ nhận body application/json và từ chối Sec-Fetch-Site: cross-site (403 cross_site_request; body khác JSON → 415 unsupported_media_type) để chống login CSRF.",
		tags:        []string{"auth"},
		sdi:         sdi.LoginSDI{},
		sdo:         sdo.SessionSDO{},
	})
	v1.With(credentialLimit).Post("/auth/password/forgot", h.ForgotPassword, apiOp{
		summary:     "Forgot password",
		description: "Gửi link đặt lại mật khẩu qua email nếu tồn tại. Phản hồi giống nhau dù email có tồn tại hay không.",
		tags:        []string{"auth"},
		sdi:         sdi.ForgotPasswordSDI{},
		sdo:         sdo.StatusSDO{},
	})
	sessionDoor.Post("/auth/password/reset", h.ResetPassword, apiOp{
		summary:     "Reset password",
		description: "Đổi mật khẩu bằng token trong link email, thu hồi mọi refresh token và trả về phiên mới. Tài khoản chưa xác minh email thì link là bằng chứng hộp thư: lấy lại tài khoản (xoá xác thực hai lớp, mã khôi phục, liên kết Google/Apple và mọi phiên của người đăng ký trước, đánh dấu email đã xác minh), phiên không hỏi bước hai và mang reclaimed: true (ADR 0047). Xoá cookie vé uniwork_sign_in_ticket trừ khi keep_sign_in_ticket. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site.",
		tags:        []string{"auth"},
		sdi:         sdi.ResetPasswordSDI{},
		sdo:         sdo.SessionSDO{},
	})
	sessionDoor.Post("/auth/mfa/verify", h.MFAVerify, apiOp{
		summary:     "Verify MFA",
		description: "Bước hai của đăng nhập trên web: đổi mfa_token (body hoặc cookie uniwork_mfa) cùng mã TOTP hoặc mã khôi phục lấy phiên. Chỉ nhận token thử thách của kênh web (token của app → 401 invalid_credentials). Mười lần sai liên tiếp khoá bước hai 15 phút và gửi mail cho chủ tài khoản; trong lúc khoá → 429 second_factor_locked kèm retry_after. Token mang liên kết Google/Apple đang chờ thì liên kết được ghi cùng giao dịch mở phiên; không ghi được thì vẫn đăng nhập và trả link_skipped (ADR 0047). Xoá cookie vé uniwork_sign_in_ticket trừ khi keep_sign_in_ticket. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site.",
		tags:        []string{"auth"},
		sdi:         sdi.MFAVerifySDI{},
		sdo:         sdo.SessionSDO{},
	})
	v1.Post("/auth/refresh", h.Refresh, apiOp{
		summary:     "Refresh session",
		description: "Cấp access token mới từ cookie uniwork_refresh.",
		tags:        []string{"auth"},
		sdo:         sdo.SessionSDO{},
	})
	v1.Post("/auth/logout", h.Logout, apiOp{
		summary:     "Logout",
		description: "Thu hồi refresh token, xoá cookie refresh và cookie vé uniwork_sign_in_ticket.",
		tags:        []string{"auth"},
		sdo:         sdo.StatusSDO{},
	})
	v1.Get("/auth/providers", h.AuthProviders, apiOp{
		summary:     "Auth providers",
		description: "Các phương thức đăng nhập bên thứ ba đang bật trên deployment này: google (web), apple (Sign in with Apple native trên iPhone, nghĩa cũ app đã phát hành đọc), apple_web, google_native (ADR 0047; chỉ thêm cờ, không đổi nghĩa cờ cũ).",
		tags:        []string{"auth"},
		sdo:         sdo.AuthProvidersSDO{},
	})
	v1.With(credentialLimit).Get("/auth/google/start", h.GoogleStart, apiOp{
		summary:     "Start Google sign-in",
		description: "Ghi cookie niêm phong uniwork_oauth_state (state, nonce, PKCE verifier, next, intent) rồi chuyển tới Google với PKCE S256, nonce và prompt=select_account (ADR 0047). Query next là đường dẫn cùng origin sau khi đăng nhập; intent=sign_up (trang đăng ký) tạo tài khoản ngay khi không khớp tài khoản nào.",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleStartSDI{},
		status:      302,
	})
	v1.With(credentialLimit).Get("/auth/google/callback", h.GoogleCallback, apiOp{
		summary:     "Google sign-in callback",
		description: "Kiểm state, đổi mã Google kèm PKCE verifier, kiểm nonce của ID token, khớp tài khoản theo quy tắc chung (ADR 0047) rồi 303: phiên → cookie refresh và /auth/callback?next= (reclaimed=1 khi vừa lấy lại tài khoản; xoá cookie vé trừ khi next là /auth/continue?step=link); cần MFA → cookie uniwork_mfa (token mang liên kết đang chờ khi email khớp tài khoản đã xác minh; liên kết chỉ ghi sau bước hai) và /login?mfa=1&next=; không khớp tài khoản nào (intent sign_in) hoặc email đã có tài khoản mà danh tính chưa được tự liên kết → cookie vé uniwork_sign_in_ticket (15 phút) và màn chọn /auth/continue?next=, không tạo tài khoản; lỗi → /login?error=<mã>&next= (google_denied, google_failed, google_unverified, sign_in_conflict, sign_in_account_unverified).",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleCallbackSDI{},
		status:      303,
	})
	sessionDoor.Get("/auth/sign-in-ticket", h.SignInTicket, apiOp{
		summary:     "Read the pending sign-in",
		description: "Màn chọn /auth/continue đọc lượt đăng nhập Google/Apple đang chờ từ cookie vé uniwork_sign_in_ticket (HttpOnly, 15 phút): nhà cung cấp, loại (unmatched | link_required), email, tên, email ẩn của Apple. Không có vé, vé hết hạn hay hỏng → 404 sign_in_ticket_missing và xoá cookie (ADR 0047).",
		tags:        []string{"auth"},
		sdo:         sdo.SignInTicketSDO{},
	})
	sessionDoor.Post("/auth/sign-in-ticket/create", h.SignInTicketCreate, apiOp{
		summary:     "Create an account from the pending sign-in",
		description: "\"Tạo tài khoản mới\" trên màn chọn: chỉ với vé unmatched; tài khoản mang email nhà cung cấp (đã xác minh khi nhà cung cấp sở hữu domain, không thì gửi mã xác minh) và liên kết sẵn danh tính. display_name bắt buộc khi vé không có tên. Email vừa có tài khoản (hay vé link_required) → 409 sign_in_account_conflict; danh tính đã mở một tài khoản (tạo ở tab khác) thì đăng nhập vào đó. Trả như đăng nhập (cookie refresh + phiên) và xoá cookie vé.",
		tags:        []string{"auth"},
		sdi:         sdi.SignInTicketCreateSDI{},
		sdo:         sdo.SessionSDO{},
	})
	sessionDoor.Post("/auth/sign-in-ticket/claim-email", h.SignInTicketClaim, apiOp{
		summary:     "Mail a code to another address",
		description: "\"Tôi được mời bằng email khác\": gửi mã 6 số (15 phút, 5 lần thử) tới địa chỉ nhập. Luôn 200 {status: sent} dù địa chỉ có tài khoản hay không; một vé gửi tối đa một mã mỗi 60 giây (429 rate_limited kèm retry_after).",
		tags:        []string{"auth"},
		sdi:         sdi.SignInEmailClaimSDI{},
		sdo:         sdo.StatusSDO{},
	})
	sessionDoor.Post("/auth/sign-in-ticket/claim-email/verify", h.SignInTicketVerify, apiOp{
		summary:     "Prove the other address",
		description: "Kiểm mã gửi tới địa chỉ đã nhập: địa chỉ có tài khoản đã xác minh → liên kết danh tính vào đó (tài khoản bật xác thực hai lớp nhận {mfa_required, mfa_token}, liên kết ghi sau bước hai); tài khoản chưa xác minh → lấy lại tài khoản (reclaimed: true); không có tài khoản → tạo tài khoản với địa chỉ đó (đã xác minh) rồi liên kết. Sai mã → 400 invalid_code; danh tính đã mở tài khoản khác → 409 sign_in_method_taken; tài khoản đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked. Trả như đăng nhập và xoá cookie vé; audit via email_claim.",
		tags:        []string{"auth"},
		sdi:         sdi.SignInEmailClaimVerifySDI{},
		sdo:         sdo.SessionSDO{},
	})
	sessionDoor.Delete("/auth/sign-in-ticket", h.SignInTicketDiscard, apiOp{
		summary:     "Drop the pending sign-in",
		description: "\"Hủy\" trên màn chọn: xoá cookie vé; token Apple vé mang (nếu có) được trả lại Apple. Luôn 204.",
		tags:        []string{"auth"},
		status:      http.StatusNoContent,
	})
	v1.With(credentialLimit).Post("/auth/apple/native", h.AppleSignIn, apiOp{
		summary:     "Sign in with Apple (native)",
		description: "App iPhone gửi identity token của Sign in with Apple (kèm nonce gốc, authorization code và tên ở lần đầu); server kiểm theo JWKS của Apple (iss, aud là bundle id, exp, nonce), khớp tài khoản theo quy tắc chung (ADR 0047) rồi trả phiên thiết bị native như exchange (ADR 0041). Giữ mã cũ cho bản app đã phát hành: tài khoản bật MFA nhận 403 mfa_required; email không dùng được nhận 401 apple_token_invalid; email thuộc tài khoản mà danh tính này không được tự gộp nhận 409 apple_account_conflict.",
		tags:        []string{"auth"},
		sdi:         sdi.AppleSignInSDI{},
		sdo:         sdo.DesktopSessionSDO{},
	})
	v1.With(credentialLimit).Get("/auth/desktop/start", h.DesktopStart, apiOp{
		summary: "Start desktop authorization", description: "Khởi tạo pending attempt PKCE; không phát code hoặc phê duyệt thiết bị. provider (google | apple, tuỳ chọn) được nối vào authorization_url để trang web đưa người chưa đăng nhập thẳng tới nhà cung cấp; giá trị khác → 400 invalid_request.", tags: []string{"auth"}, sdi: sdi.DesktopStartSDI{}, sdo: sdo.DesktopStartSDO{},
	})
	v1.With(credentialLimit).Post("/auth/desktop/exchange", h.DesktopExchange, apiOp{
		summary: "Exchange desktop code", description: "Đổi authorization code một lần lấy phiên thiết bị và token xoay vòng.", tags: []string{"auth"}, sdi: sdi.DesktopExchangeSDI{}, sdo: sdo.DesktopSessionSDO{},
	})
	v1.With(refreshLimit).Post("/auth/desktop/refresh", h.DesktopRefresh, apiOp{
		summary: "Refresh desktop session", description: "Xoay refresh token native; phát hiện replay và thu hồi thiết bị. Gửi header `X-UniWork-Device` = `device_session_id` để được ngân sách riêng theo thiết bị (60/phút) dưới trần theo IP (600/phút); không header thì theo IP.", tags: []string{"auth"}, sdi: sdi.DesktopRefreshSDI{}, sdo: sdo.DesktopSessionSDO{},
	})
}

// registerSignInTicketLink is the choice screen's "I already have an
// account" once the person signed in: a bearer route that also spends the
// ticket cookie, so it is held to same-site JSON like the public ones.
//
//	POST /api/v1/auth/sign-in-ticket/link (bearer, same-site JSON, credential rate limit)
func registerSignInTicketLink(authed api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	authed.With(mw.SameSiteJSON, credentialLimit).Post("/auth/sign-in-ticket/link", h.SignInTicketLink, apiOp{
		summary:     "Link the pending sign-in",
		description: "Liên kết danh tính Google/Apple của vé (cookie uniwork_sign_in_ticket) vào tài khoản đang đăng nhập (bearer web). Phiên của bearer phải bắt đầu sau khi vé được cấp, không thì 403 proof_required; bearer khác kênh vé → 400 sign_in_ticket_channel; token web cũ hơn lần đổi thông tin đăng nhập → 401 invalid_token. Danh tính đang mở tài khoản khác: tài khoản chưa từng vào tổ chức nào → 409 sign_in_method_movable kèm masked_email (gửi lại move: true để chuyển sang đây, tài khoản trống bị xoá), không thì 409 sign_in_method_taken kèm masked_email; tài khoản đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked; email tài khoản chưa xác minh → 403 email_unverified. Thành công trả user và phương thức đăng nhập, xoá cookie vé; audit via ticket (hoặc move).",
		tags:        []string{"auth"},
		sdi:         sdi.SignInTicketLinkSDI{},
		sdo:         sdo.SignInMethodsChangeSDO{},
		auth:        true,
	})
}

func registerDesktopAuth(v1 api, h Routes) {
	v1.Get("/auth/desktop/authorize", h.DesktopConsent, apiOp{summary: "Show desktop consent", description: "Hiển thị thông tin ứng dụng và thiết bị sau khi đăng nhập; GET không phê duyệt.", tags: []string{"auth"}, sdo: sdo.DesktopConsentSDO{}, auth: true})
	v1.Post("/auth/desktop/authorize", h.DesktopConsentCommand, apiOp{summary: "Approve desktop authorization", description: "Phê duyệt hoặc hủy pending attempt bằng CSRF token same-site.", tags: []string{"auth"}, sdi: sdi.DesktopConsentSDI{}, sdo: sdo.DesktopConsentResultSDO{}, auth: true})
	v1.Post("/auth/desktop/logout", h.DesktopLogout, apiOp{summary: "Logout desktop session", description: "Thu hồi phiên desktop hoặc session family.", tags: []string{"auth"}, sdi: sdi.DesktopLogoutSDI{}, sdo: sdo.StatusSDO{}, auth: true})
	v1.Get("/auth/desktop/devices", h.DesktopDevices, apiOp{summary: "List desktop devices", description: "Liệt kê metadata các thiết bị native của tài khoản hiện tại.", tags: []string{"auth"}, sdo: sdo.DesktopDeviceListSDO{}, auth: true})
	v1.Delete("/auth/desktop/devices/{deviceSessionID}", h.DesktopRevokeDevice, apiOp{summary: "Revoke desktop device", description: "Thu hồi một thiết bị native của chính tài khoản.", tags: []string{"auth"}, sdo: sdo.StatusSDO{}, auth: true})
}

// desktopDevice keys the native refresh budget by the X-UniWork-Device header
// (the device_session_id, a ULID). The router does not verify it; the address
// ceiling (desktop-refresh-ip) stops a caller rotating ids. Anything that is
// not 26 alphanumerics falls back to the client address.
func desktopDevice(r *http.Request) string {
	id := strings.TrimSpace(r.Header.Get("X-UniWork-Device"))
	if len(id) != 26 {
		return ""
	}
	for _, c := range id {
		if !('0' <= c && c <= '9' || 'A' <= c && c <= 'Z' || 'a' <= c && c <= 'z') {
			return ""
		}
	}
	return "device:" + id
}
