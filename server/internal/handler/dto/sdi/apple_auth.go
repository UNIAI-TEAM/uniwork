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
