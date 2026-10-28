package sdi

// AppleSignInSDI is POST /api/v1/auth/apple/native: what the iPhone app holds
// after Apple's native sheet (ADR 0041). The identity token and the code are
// sent once, over TLS, and never logged.
type AppleSignInSDI struct {
	IdentityToken     string `json:"identity_token" minLength:"1" description:"Identity token (JWT) Apple trả về sau sheet đăng nhập native; aud là bundle id của app" example:"eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIn0.c2ln"`
	Nonce             string `json:"nonce" minLength:"1" description:"Nonce gốc app sinh; token phải mang SHA-256 (hex) của nó" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	AuthorizationCode string `json:"authorization_code,omitempty" description:"Authorization code dùng một lần của lần đăng nhập này; server đổi lấy refresh token để thu hồi khi xoá tài khoản" example:"c1a2b3c4d5e6f.0.mrzq.AbCdEfGhIjKlMnOp"`
	GivenName         string `json:"given_name,omitempty" description:"Tên Apple chia sẻ, chỉ có ở lần đăng nhập đầu" example:"Ngọc"`
	FamilyName        string `json:"family_name,omitempty" description:"Họ Apple chia sẻ, chỉ có ở lần đăng nhập đầu" example:"Trần"`
	ClientID          string `json:"client_id" minLength:"1" description:"Mã client native công khai nằm trong allowlist" example:"uniwork-chat-mobile"`
	DeploymentID      string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"default"`
	DeviceLabel       string `json:"device_label,omitempty" description:"Nhãn thiết bị đã sanitize" example:"UniChat (iOS)"`
	Platform          string `json:"platform,omitempty" description:"Metadata nền tảng, có giới hạn độ dài" example:"ios"`
	Build             string `json:"build,omitempty" description:"Metadata bản dựng, có giới hạn độ dài" example:"0.3.2"`
}

// AppleStartSDI is GET /api/v1/auth/apple/start: Sign in with Apple on the
// web (ADR 0049 §7), as the Google start.
type AppleStartSDI struct {
	Next      string `query:"next" description:"Đường dẫn cùng origin sau khi đăng nhập; /auth/continue?step=link&… (đăng nhập để liên kết vé đang chờ) giữ cookie vé" example:"/acme/team"`
	Intent    string `query:"intent" description:"sign_in (mặc định) từ trang đăng nhập: không khớp tài khoản nào thì ra vé và màn chọn; sign_up từ trang đăng ký: không khớp thì tạo tài khoản ngay; link (kèm link_token, từ Cài đặt): liên kết vào tài khoản đang đăng nhập; giá trị khác chuyển về /login?error=apple_failed" example:"sign_in"`
	LinkToken string `query:"link_token" description:"Với intent=link: token từ POST /me/sign-in-methods/apple/link (5 phút); cookie refresh của trình duyệt phải thuộc đúng phiên đã xin nó, không thì quay về return_to với result=session_mismatch" example:"Xb2u…"`
}

// AppleCallbackSDI is POST /api/v1/auth/apple/callback: what Apple posts to
// the return URL (response_mode=form_post), never JSON. The code is redeemed
// once and never logged; user is unsigned.
type AppleCallbackSDI struct {
	Code  string `formData:"code" description:"Authorization code dùng một lần Apple trả về (5 phút); server đổi kèm redirect_uri lấy identity token và refresh token" example:"c1a2b3c4d5e6f.0.mrzq.AbCdEfGhIjKlMnOp"`
	State string `formData:"state" description:"CSRF state khớp state trong cookie niêm phong uniwork_apple_state" example:"9f2c4e1ab37d"`
	User  string `formData:"user" description:"JSON Apple gửi ở lần đồng ý đầu ({name:{firstName,lastName}, email}); không ký nên tên chỉ là gợi ý cho hồ sơ mới, email không bao giờ được đọc (email chỉ lấy từ identity token)" example:"{\"name\":{\"firstName\":\"Lan\",\"lastName\":\"Phạm\"}}"`
	Error string `formData:"error" description:"Lỗi Apple trả khi không có code, ví dụ user_cancelled_authorize khi người dùng bấm Hủy" example:"user_cancelled_authorize"`
}
