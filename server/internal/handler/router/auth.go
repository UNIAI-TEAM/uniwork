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
//	POST   /api/v1/auth/login      (same-site JSON, sign-in-password budget)
//	POST   /api/v1/auth/password/forgot  (credential rate limit)
//	POST   /api/v1/auth/password/reset   (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/mfa/verify   (same-site JSON, sign-in-mfa budget)
//	POST   /api/v1/auth/refresh
//	POST   /api/v1/auth/logout
//	GET    /api/v1/auth/providers
//	GET    /api/v1/auth/google/start     (credential rate limit)
//	GET    /api/v1/auth/google/callback  (credential rate limit)
//	GET    /api/v1/auth/apple/start      (credential rate limit)
//	POST   /api/v1/auth/apple/callback   (credential rate limit; Apple's cross-site form post)
//	GET    /api/v1/auth/apple/finish     (credential rate limit)
//	GET    /api/v1/auth/sign-in-ticket                    (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/create             (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/claim-email        (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/sign-in-ticket/claim-email/verify (same-site JSON, credential rate limit)
//	DELETE /api/v1/auth/sign-in-ticket                    (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/apple/native     (credential rate limit)
//	POST   /api/v1/auth/native/password  (same-site JSON, sign-in-password budget)
//	POST   /api/v1/auth/native/mfa       (same-site JSON, sign-in-mfa budget)
//	POST   /api/v1/auth/native/google    (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/native/apple     (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/native/register  (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/native/sign-in-ticket/create             (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/native/sign-in-ticket/claim-email        (same-site JSON, credential rate limit)
//	POST   /api/v1/auth/native/sign-in-ticket/claim-email/verify (same-site JSON, credential rate limit)
//
// Same-site JSON (mw.SameSiteJSON) is the login-CSRF guard of every public
// route that opens a session or spends a sign-in cookie (ADR 0047 §9). It
// runs before the budget, so what another site makes a browser send never
// spends that browser's address's budget. A password and a second factor
// are guessed on their named budgets (signInBudgets), the rest of the doors
// on the credential budget.
func registerAuth(v1 api, h Routes, credentialLimit, refreshLimit func(http.Handler) http.Handler, budgets signInBudgets) {
	sessionDoor := v1.With(mw.SameSiteJSON, credentialLimit)
	sessionDoor.Post("/auth/register", h.Register, apiOp{
		summary:     "Register",
		description: "Tạo tài khoản. Ghi cookie refresh HttpOnly trên /api/v1/auth và xoá cookie vé uniwork_sign_in_ticket. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site (chống login CSRF).",
		tags:        []string{"auth"},
		sdi:         sdi.RegisterSDI{},
		sdo:         sdo.SessionSDO{},
	})
	v1.With(mw.SameSiteJSON, budgets.password).Post("/auth/login", h.Login, apiOp{
		summary:     "Login",
		description: "Đổi email và mật khẩu lấy access token cùng cookie refresh. Tài khoản bật MFA nhận {mfa_required:true, mfa_token} thay cho phiên. Đăng nhập thành công xoá cookie vé uniwork_sign_in_ticket, trừ khi keep_sign_in_ticket (đăng nhập để liên kết Google/Apple đang chờ). Chỉ nhận body application/json và từ chối Sec-Fetch-Site: cross-site (403 cross_site_request; body khác JSON → 415 unsupported_media_type) để chống login CSRF. Ngân sách sign-in-password: 20 lần/phút theo địa chỉ + email, dưới trần 600/phút theo địa chỉ (429 rate_limited).",
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
	v1.With(mw.SameSiteJSON, budgets.mfa).Post("/auth/mfa/verify", h.MFAVerify, apiOp{
		summary:     "Verify MFA",
		description: "Bước hai của đăng nhập trên web: đổi mfa_token (body hoặc cookie uniwork_mfa) cùng mã TOTP hoặc mã khôi phục lấy phiên. Chỉ nhận token thử thách của kênh web (token của app → 401 invalid_credentials). Mười lần sai liên tiếp khoá bước hai 15 phút và gửi mail cho chủ tài khoản; trong lúc khoá → 429 second_factor_locked kèm retry_after. Token mang liên kết Google/Apple đang chờ thì liên kết được ghi cùng giao dịch mở phiên; không ghi được thì vẫn đăng nhập và trả link_skipped (ADR 0047). Xoá cookie vé uniwork_sign_in_ticket trừ khi keep_sign_in_ticket. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site. Ngân sách sign-in-mfa: 10 lần/phút theo địa chỉ + tài khoản của token thử thách, dưới trần 600/phút theo địa chỉ.",
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
		description: "Ghi cookie niêm phong uniwork_oauth_state (state, nonce, PKCE verifier, next, intent) rồi chuyển tới Google với PKCE S256, nonce và prompt=select_account (ADR 0047). Query next là đường dẫn cùng origin sau khi đăng nhập; intent=sign_up (trang đăng ký) tạo tài khoản ngay khi không khớp tài khoản nào. intent=link kèm link_token (từ POST /me/sign-in-methods/google/link): chỉ bắt đầu khi cookie refresh của trình duyệt thuộc đúng phiên đã xin token, không thì 303 về return_to với sign_in_method=google&result=session_mismatch (token hỏng/hết hạn: result=failed).",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleStartSDI{},
		status:      302,
	})
	v1.With(credentialLimit).Get("/auth/google/callback", h.GoogleCallback, apiOp{
		summary:     "Google sign-in callback",
		description: "Kiểm state, đổi mã Google kèm PKCE verifier, kiểm nonce của ID token, khớp tài khoản theo quy tắc chung (ADR 0047) rồi 303: phiên → cookie refresh và /auth/callback?next= (reclaimed=1 khi vừa lấy lại tài khoản; xoá cookie vé trừ khi next là /auth/continue?step=link); cần MFA → cookie uniwork_mfa (token mang liên kết đang chờ khi email khớp tài khoản đã xác minh; liên kết chỉ ghi sau bước hai) và /login?mfa=1&next=; không khớp tài khoản nào (intent sign_in) hoặc email đã có tài khoản mà danh tính chưa được tự liên kết → cookie vé uniwork_sign_in_ticket (15 phút) và màn chọn /auth/continue?next=, không tạo tài khoản; lỗi → /login?error=<mã>&next= (google_denied, google_failed, google_unverified, sign_in_conflict, sign_in_account_unverified). Liên kết từ Cài đặt (intent=link): kiểm lại cookie refresh thuộc đúng phiên đã bắt đầu, liên kết vào tài khoản đó (audit via settings) rồi 303 về return_to với sign_in_method=google&result=linked|denied|failed|taken|movable|already_linked|session_mismatch (taken/movable kèm masked_email; movable còn để cookie vé để Cài đặt xác nhận chuyển qua POST /auth/sign-in-ticket/link {move:true, step_up_token}).",
		tags:        []string{"auth"},
		sdi:         sdi.GoogleCallbackSDI{},
		status:      303,
	})
	registerAppleWeb(v1, h, credentialLimit)
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
		description: "\"Tôi được mời bằng email khác\": gửi mã 6 số (15 phút, 5 lần thử) tới địa chỉ nhập. Luôn 200 {status: sent} dù địa chỉ có tài khoản hay không; một vé gửi tối đa một mã mỗi 60 giây, một địa chỉ nhận tối đa 5 mã mỗi 24 giờ và không nhận thêm khi đã có 10 lần đoán sai, dù vé nào xin (429 rate_limited kèm retry_after).",
		tags:        []string{"auth"},
		sdi:         sdi.SignInEmailClaimSDI{},
		sdo:         sdo.StatusSDO{},
	})
	sessionDoor.Post("/auth/sign-in-ticket/claim-email/verify", h.SignInTicketVerify, apiOp{
		summary:     "Prove the other address",
		description: "Kiểm mã gửi tới địa chỉ đã nhập: địa chỉ có tài khoản đã xác minh → liên kết danh tính vào đó (tài khoản bật xác thực hai lớp nhận {mfa_required, mfa_token}, liên kết ghi sau bước hai); tài khoản chưa xác minh → lấy lại tài khoản (reclaimed: true); không có tài khoản → tạo tài khoản với địa chỉ đó (đã xác minh) rồi liên kết. Sai mã → 400 invalid_code; địa chỉ đã chịu 10 lần đoán sai trong 24 giờ → 429 rate_limited kèm retry_after (không kiểm mã); danh tính đã mở tài khoản khác → 409 sign_in_method_taken; tài khoản đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked. Trả như đăng nhập và xoá cookie vé; audit via email_claim.",
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
	registerNativeAuth(v1, h, credentialLimit, budgets)
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

// registerAppleWeb is Sign in with Apple on the web (ADR 0047 §7): the
// start, Apple's form post, and the same-site finish. None takes
// mw.SameSiteJSON: Apple posts a form from its own site, and the finish
// follows that post. The state Apple echoes, bound to a sealed cookie, and
// the nonce in the identity token stop a forged sign-in instead.
func registerAppleWeb(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	v1.With(credentialLimit).Get("/auth/apple/start", h.AppleStart, apiOp{
		summary:     "Start Sign in with Apple on the web",
		description: "Ghi cookie niêm phong uniwork_apple_state (state, nonce gốc, next, intent; HttpOnly, SameSite=None; Secure, Path /api/v1/auth/apple, 10 phút) rồi 302 tới trang ủy quyền của Apple với Services ID, response_mode=form_post, scope name email và nonce là SHA-256 (hex) của nonce gốc (ADR 0047). intent=sign_up (trang đăng ký) tạo tài khoản ngay khi không khớp tài khoản nào. intent=link kèm link_token (từ POST /me/sign-in-methods/apple/link): chỉ bắt đầu khi cookie refresh của trình duyệt thuộc đúng phiên đã xin token, không thì 303 về return_to với sign_in_method=apple&result=session_mismatch (token hỏng/hết hạn: result=failed). Chưa cấu hình (APPLE_SIWA_WEB_CLIENT_ID và khoá Sign in with Apple) → 503 apple_not_configured. Chỉ chạy trên https.",
		tags:        []string{"auth"},
		sdi:         sdi.AppleStartSDI{},
		status:      302,
	})
	v1.With(credentialLimit).Post("/auth/apple/callback", h.AppleCallback, apiOp{
		summary:     "Sign in with Apple callback",
		description: "Apple POST form (application/x-www-form-urlencoded, tối đa 64 KiB; không phải JSON) về return URL. Luôn xoá cookie state; kiểm state với cookie uniwork_apple_state; error=user_cancelled_authorize → /login?error=apple_denied; đổi code kèm redirect_uri lấy identity token và refresh token; kiểm identity token bằng verifier của web (aud chỉ là Services ID, nonce của lượt này); email chỉ lấy từ token, tên từ trường user chỉ là gợi ý. Không đăng nhập ở đây (POST từ site khác không mang cookie Lax): ghi kết quả vào cookie niêm phong uniwork_apple_result (SameSite=None; Secure, 2 phút) rồi 303 tới GET /api/v1/auth/apple/finish. Lỗi → 303 /login?error=apple_failed|apple_denied&next= (liên kết từ Cài đặt: return_to với result=failed|denied).",
		tags:        []string{"auth"},
		sdi:         sdi.AppleCallbackSDI{},
		status:      303,
	})
	v1.With(credentialLimit).Get("/auth/apple/finish", h.AppleFinish, apiOp{
		summary:     "Finish Sign in with Apple on the web",
		description: "Điều hướng cùng site sau callback, nên cookie Lax (uniwork_refresh, vé) có mặt. Xoá cookie uniwork_apple_result rồi kết thúc như callback Google (ADR 0047): phiên → cookie refresh và 303 /auth/callback?next= (reclaimed=1 khi vừa lấy lại tài khoản); cần MFA → cookie uniwork_mfa (liên kết đang chờ chỉ ghi sau bước hai) và /login?mfa=1&next=; không khớp tài khoản nào hay email đã có tài khoản mà danh tính chưa được tự liên kết → cookie vé uniwork_sign_in_ticket và /auth/continue?next=; lỗi → /login?error=<mã>&next= (apple_failed, sign_in_unverified, sign_in_conflict, sign_in_account_unverified). Liên kết từ Cài đặt: kiểm lại cookie refresh thuộc đúng phiên đã bắt đầu, liên kết vào tài khoản đó (audit via settings) rồi 303 về return_to với sign_in_method=apple&result=linked|failed|taken|movable|already_linked|session_mismatch. Tài khoản tạo hay liên kết giữ token Apple (client là Services ID) để thu hồi khi xoá tài khoản; lượt bị từ chối trả token lại Apple trừ khi Apple ID đó đã mở một tài khoản. Thiếu hay hết hạn cookie kết quả → /login?error=apple_failed.",
		tags:        []string{"auth"},
		status:      303,
	})
}

// nativeAnswer is what every door of the app's sign-in screen answers, as
// the descriptions below say once.
const nativeAnswer = " Trả NativeSignInSDO: status signed_in (session là phiên thiết bị native, như /auth/desktop/exchange), mfa_required (mfa_token gắn với client và deployment này, gửi ở POST /auth/native/mfa), identity_unmatched hay link_required (ticket 15 phút cho màn chọn, chỉ dùng được cùng nonce gốc, kèm identity). Chỉ nhận client_id trong NATIVE_SIGN_IN_CLIENTS (mặc định uniwork-chat-mobile) với deployment đã cấu hình, không thì 400 invalid_request; desktop và Office đăng nhập qua trang web. Phiên mới ghi audit auth.login_succeeded (via) trong cùng giao dịch; tài khoản đã từng có phiên hay thiết bị nhận mail báo đăng nhập mới. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site. Cache-Control: no-store."

// registerNativeAuth is the app's own sign-in screen (ADR 0047 §8, spec
// §3.6): public doors under /auth/native that take only the native sign-in
// clients and answer NativeSignInSDO. They hold to same-site JSON like the
// browser's session doors (the app sends JSON and no Sec-Fetch-Site), so a
// form another site posts spends no budget. The password and the second
// factor share the browser's named budgets (signInBudgets), so no mix of
// doors buys more guesses; the rest ride the credential budget.
func registerNativeAuth(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler, budgets signInBudgets) {
	door := v1.With(mw.SameSiteJSON, credentialLimit)
	v1.With(mw.SameSiteJSON, budgets.password).Post("/auth/native/password", h.NativePassword, apiOp{
		summary:     "Sign in with a password (app)",
		description: "Email và mật khẩu từ màn đăng nhập trong app. Tài khoản bật xác thực hai lớp nhận mfa_required. Sai email hay mật khẩu → 401 invalid_credentials (như nhau). Ngân sách sign-in-password dùng chung với POST /auth/login: 20 lần/phút theo địa chỉ + email, dưới trần 600/phút theo địa chỉ." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativePasswordSDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	v1.With(mw.SameSiteJSON, budgets.mfa).Post("/auth/native/mfa", h.NativeMFA, apiOp{
		summary:     "Verify the second factor (app)",
		description: "Bước hai trong app: mfa_token của app cùng mã TOTP hoặc mã khôi phục. Chỉ nhận token thử thách phát cho đúng client và deployment của body (token của web hay app khác → 401 invalid_credentials, không tính là một lần đoán). Mười lần sai liên tiếp (cộng chung với web và step-up) khoá bước hai 15 phút và gửi mail cho chủ tài khoản: 429 second_factor_locked kèm retry_after. Token mang liên kết Google/Apple đang chờ thì liên kết được ghi cùng giao dịch mở phiên; không ghi được thì vẫn đăng nhập và trả link_skipped. Ngân sách sign-in-mfa dùng chung với POST /auth/mfa/verify: 10 lần/phút theo địa chỉ + tài khoản của token." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeMFASDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	door.Post("/auth/native/google", h.NativeGoogle, apiOp{
		summary:     "Sign in with Google (app)",
		description: "ID token SDK Google trả cho app: kiểm chữ ký theo khoá Google, aud là client web hay client app, azp bắt buộc là client iOS/Android của app (GOOGLE_NATIVE_CLIENT_IDS; token phát cho web bị từ chối), iat không quá 10 phút, nonce bắt buộc là SHA-256 (hex) của nonce gốc; sai → 401 provider_token_invalid. Khớp tài khoản theo quy tắc chung (ADR 0047): không khớp → identity_unmatched (intent=sign_up thì tạo tài khoản ngay); email đã có tài khoản mà danh tính chưa được tự liên kết → link_required; tài khoản chưa xác minh mà Google sở hữu email → lấy lại tài khoản (reclaimed); lỗi của bộ khớp giữ mã (403 sign_in_email_unverified, 403 sign_in_account_unverified, 409 sign_in_account_conflict). Chưa cấu hình → 503 google_not_configured." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeGoogleSDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	door.Post("/auth/native/apple", h.NativeApple, apiOp{
		summary:     "Sign in with Apple (app)",
		description: "Identity token sheet Apple trả cho app iPhone: kiểm theo JWKS của Apple (iss, aud là bundle id, exp, nonce là SHA-256 của nonce gốc); sai → 401 provider_token_invalid. Khớp tài khoản theo quy tắc chung như Google native (không tạo tài khoản ngầm: identity_unmatched, link_required, reclaimed; intent=sign_up tạo ngay). Tài khoản mở được giữ token Apple đổi từ authorization_code để thu hồi khi xoá tài khoản; lượt bị từ chối trả token lại Apple trừ khi Apple ID đã mở một tài khoản. Chưa cấu hình (APPLE_SIWA_AUDIENCES) → 503 apple_auth_unavailable. Bản app cũ dùng POST /auth/apple/native." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeAppleSDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	door.Post("/auth/native/register", h.NativeRegister, apiOp{
		summary:     "Register (app)",
		description: "Đăng ký bằng email từ màn đăng ký trong app: cùng kiểm tra như POST /auth/register (400 invalid_request, 409 conflict khi email đã có tài khoản); trả signed_in trên tài khoản chưa xác minh và gửi mã xác minh email." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeRegisterSDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	door.Post("/auth/native/sign-in-ticket/create", h.NativeTicketCreate, apiOp{
		summary:     "Create an account from the pending sign-in (app)",
		description: "\"Tạo tài khoản mới\" trên màn chọn của app: như POST /auth/sign-in-ticket/create trên vé của app (chỉ vé unmatched; email vừa có tài khoản hay vé link_required → 409 sign_in_account_conflict; display_name bắt buộc khi vé không có tên; danh tính đã mở một tài khoản thì đăng nhập vào đó). Vé thiếu, hết hạn hay hỏng → 404 sign_in_ticket_missing; nonce, client_id hay deployment_id khác lúc cấp vé, hay vé của web → 400 sign_in_ticket_channel. Audit via ticket." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeTicketCreateSDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
	door.Post("/auth/native/sign-in-ticket/claim-email", h.NativeTicketClaim, apiOp{
		summary:     "Mail a code to another address (app)",
		description: "\"Tôi được mời bằng email khác\" trong app: như POST /auth/sign-in-ticket/claim-email trên vé của app. Luôn 200 {status: sent} dù địa chỉ có tài khoản hay không; một vé gửi tối đa một mã mỗi 60 giây, một địa chỉ nhận tối đa 5 mã mỗi 24 giờ và không nhận thêm khi đã có 10 lần đoán sai (429 rate_limited kèm retry_after). Vé thiếu hay hỏng → 404 sign_in_ticket_missing; nonce, client hay deployment lệch → 400 sign_in_ticket_channel. Chỉ nhận client_id trong NATIVE_SIGN_IN_CLIENTS. Chỉ nhận body application/json, từ chối Sec-Fetch-Site: cross-site.",
		tags:        []string{"auth"},
		sdi:         sdi.NativeEmailClaimSDI{},
		sdo:         sdo.StatusSDO{},
	})
	door.Post("/auth/native/sign-in-ticket/claim-email/verify", h.NativeTicketVerify, apiOp{
		summary:     "Prove the other address (app)",
		description: "Kiểm mã gửi tới địa chỉ đã nhập, như POST /auth/sign-in-ticket/claim-email/verify trên vé của app: liên kết vào tài khoản đã xác minh của địa chỉ (bật xác thực hai lớp thì mfa_required, liên kết ghi sau bước hai), lấy lại tài khoản chưa xác minh (reclaimed), hay tạo tài khoản với địa chỉ đó. Sai mã → 400 invalid_code; địa chỉ đã chịu 10 lần đoán sai trong 24 giờ → 429 rate_limited kèm retry_after; danh tính đã mở tài khoản khác → 409 sign_in_method_taken; tài khoản đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked. Audit via email_claim." + nativeAnswer,
		tags:        []string{"auth"},
		sdi:         sdi.NativeEmailClaimVerifySDI{},
		sdo:         sdo.NativeSignInSDO{},
	})
}

// registerSignInTicketLink is the choice screen's "I already have an
// account" once the person signed in: a bearer route that also spends the
// ticket cookie, so it is held to same-site JSON like the public ones; and
// the app's, which spends the app's ticket from its JSON body.
//
//	POST /api/v1/auth/sign-in-ticket/link        (bearer, same-site JSON, credential rate limit)
//	POST /api/v1/auth/native/sign-in-ticket/link (bearer of the app, same-site JSON, credential rate limit)
func registerSignInTicketLink(authed api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	authed.With(mw.SameSiteJSON, credentialLimit).Post("/auth/native/sign-in-ticket/link", h.NativeTicketLink, apiOp{
		summary:     "Link the pending sign-in (app)",
		description: "\"Tôi đã có tài khoản\" trong app sau khi đăng nhập: liên kết danh tính Google/Apple của vé app vào tài khoản đang đăng nhập (bearer của phiên thiết bị). Vé chỉ mở được cùng nonce gốc, client_id và deployment_id lúc cấp (lệch, hay bearer của trình duyệt → 400 sign_in_ticket_channel; vé thiếu hay hỏng → 404 sign_in_ticket_missing). Phiên thiết bị phải bắt đầu sau khi vé được cấp, cùng client và deployment, hoặc gửi step_up_token của phiên này, không thì 403 proof_required; phiên đã thu hồi → 401 invalid_token. Danh tính đang mở tài khoản khác: tài khoản trống → 409 sign_in_method_movable kèm masked_email (gửi lại move: true), không thì 409 sign_in_method_taken; đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked; email chưa xác minh → 403 email_unverified. Audit via ticket (hoặc move). Chỉ nhận client_id trong NATIVE_SIGN_IN_CLIENTS.",
		tags:        []string{"auth"},
		sdi:         sdi.NativeTicketLinkSDI{},
		sdo:         sdo.SignInMethodsChangeSDO{},
		auth:        true,
	})
	authed.With(mw.SameSiteJSON, credentialLimit).Post("/auth/sign-in-ticket/link", h.SignInTicketLink, apiOp{
		summary:     "Link the pending sign-in",
		description: "Liên kết danh tính Google/Apple của vé (cookie uniwork_sign_in_ticket) vào tài khoản đang đăng nhập (bearer web). Phiên của bearer phải bắt đầu sau khi vé được cấp, hoặc gửi step_up_token của phiên này (POST /me/step-up), không thì 403 proof_required; bearer khác kênh vé → 400 sign_in_ticket_channel; token web cũ hơn lần đổi thông tin đăng nhập → 401 invalid_token. Danh tính đang mở tài khoản khác: tài khoản chưa từng vào tổ chức nào → 409 sign_in_method_movable kèm masked_email (gửi lại move: true để chuyển sang đây, tài khoản trống bị xoá), không thì 409 sign_in_method_taken kèm masked_email; tài khoản đã liên kết tài khoản khác của nhà cung cấp → 409 sign_in_method_already_linked; email tài khoản chưa xác minh → 403 email_unverified. Thành công trả user và phương thức đăng nhập, xoá cookie vé; audit via ticket (hoặc move).",
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
