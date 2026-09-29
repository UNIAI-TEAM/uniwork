package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: auth — public session routes (no Bearer).
//
//	POST /api/v1/auth/register   (credential rate limit)
//	POST /api/v1/auth/login      (credential rate limit)
//	POST /api/v1/auth/password/forgot  (credential rate limit)
//	POST /api/v1/auth/password/reset   (credential rate limit)
//	POST /api/v1/auth/mfa/verify   (credential rate limit)
//	POST /api/v1/auth/refresh
//	POST /api/v1/auth/logout
//	GET  /api/v1/auth/providers
//	GET  /api/v1/auth/google/start     (credential rate limit)
//	GET  /api/v1/auth/google/callback  (credential rate limit)
func registerAuth(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	v1.With(credentialLimit).Post("/auth/register", h.Register, apiOp{
		summary:     "Register",
		description: "Tạo tài khoản. Ghi cookie refresh HttpOnly trên /api/v1/auth.",
		tags:        []string{"auth"},
		sdi:         sdi.RegisterSDI{},
		sdo:         sdo.SessionSDO{},
	})
	v1.With(credentialLimit).Post("/auth/login", h.Login, apiOp{
		summary:     "Login",
		description: "Đổi email và mật khẩu lấy access token cùng cookie refresh. Tài khoản bật MFA nhận {mfa_required:true, mfa_token} thay cho phiên.",
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
	v1.With(credentialLimit).Post("/auth/password/reset", h.ResetPassword, apiOp{
		summary:     "Reset password",
		description: "Đổi mật khẩu bằng token trong link email, thu hồi mọi refresh token và trả về phiên mới.",
		tags:        []string{"auth"},
		sdi:         sdi.ResetPasswordSDI{},
		sdo:         sdo.SessionSDO{},
	})
	v1.With(credentialLimit).Post("/auth/mfa/verify", h.MFAVerify, apiOp{
		summary:     "Verify MFA",
		description: "Bước hai của đăng nhập: đổi mfa_token (body hoặc cookie uniwork_mfa) cùng mã TOTP hoặc mã khôi phục lấy phiên.",
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
		description: "Thu hồi refresh token và xóa cookie.",
		tags:        []string{"auth"},
		sdo:         sdo.StatusSDO{},
	})
	v1.Get("/auth/providers", h.AuthProviders, apiOp{
		summary:     "Auth providers",
		description: "Các phương thức đăng nhập bên thứ ba đang bật trên deployment này.",
		tags:        []string{"auth"},
		sdo:         sdo.AuthProvidersSDO{},
	})
	v1.With(credentialLimit).Get("/auth/google/start", h.GoogleStart, apiOp{
		summary:     "Start Google sign-in",
		description: "Ghi cookie CSRF rồi chuyển tới Google. Query next là đường dẫn cùng origin sau khi đăng nhập.",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleStartSDI{},
		status:      302,
	})
	v1.With(credentialLimit).Get("/auth/google/callback", h.GoogleCallback, apiOp{
		summary:     "Google sign-in callback",
		description: "Đổi mã Google lấy phiên, ghi cookie refresh, rồi chuyển về frontend /auth/callback.",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleCallbackSDI{},
		status:      302,
	})
	v1.With(credentialLimit).Get("/auth/desktop/start", h.DesktopStart, apiOp{
		summary: "Start desktop authorization", description: "Khởi tạo pending attempt PKCE; không phát code hoặc phê duyệt thiết bị.", tags: []string{"auth"}, sdi: sdi.DesktopStartSDI{}, sdo: sdo.DesktopStartSDO{},
	})
	v1.With(credentialLimit).Post("/auth/desktop/exchange", h.DesktopExchange, apiOp{
		summary: "Exchange desktop code", description: "Đổi authorization code một lần lấy phiên thiết bị và token xoay vòng.", tags: []string{"auth"}, sdi: sdi.DesktopExchangeSDI{}, sdo: sdo.DesktopSessionSDO{},
	})
	v1.With(credentialLimit).Post("/auth/desktop/refresh", h.DesktopRefresh, apiOp{
		summary: "Refresh desktop session", description: "Xoay refresh token native; phát hiện replay và thu hồi thiết bị.", tags: []string{"auth"}, sdi: sdi.DesktopRefreshSDI{}, sdo: sdo.DesktopSessionSDO{},
	})
}

func registerDesktopAuth(v1 api, h Routes) {
	v1.Get("/auth/desktop/authorize", h.DesktopConsent, apiOp{summary: "Show desktop consent", description: "Hiển thị thông tin ứng dụng và thiết bị sau khi đăng nhập; GET không phê duyệt.", tags: []string{"auth"}, sdo: sdo.DesktopConsentSDO{}, auth: true})
	v1.Post("/auth/desktop/authorize", h.DesktopConsentCommand, apiOp{summary: "Approve desktop authorization", description: "Phê duyệt hoặc hủy pending attempt bằng CSRF token same-site.", tags: []string{"auth"}, sdi: sdi.DesktopConsentSDI{}, sdo: sdo.DesktopConsentResultSDO{}, auth: true})
	v1.Post("/auth/desktop/logout", h.DesktopLogout, apiOp{summary: "Logout desktop session", description: "Thu hồi phiên desktop hoặc session family.", tags: []string{"auth"}, sdi: sdi.DesktopLogoutSDI{}, sdo: sdo.StatusSDO{}, auth: true})
	v1.Get("/auth/desktop/devices", h.DesktopDevices, apiOp{summary: "List desktop devices", description: "Liệt kê metadata các thiết bị native của tài khoản hiện tại.", tags: []string{"auth"}, sdo: sdo.DesktopDeviceListSDO{}, auth: true})
	v1.Delete("/auth/desktop/devices/{deviceSessionID}", h.DesktopRevokeDevice, apiOp{summary: "Revoke desktop device", description: "Thu hồi một thiết bị native của chính tài khoản.", tags: []string{"auth"}, sdo: sdo.StatusSDO{}, auth: true})
}
