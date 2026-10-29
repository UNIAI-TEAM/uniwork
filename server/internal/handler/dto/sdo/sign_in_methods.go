package sdo

// StepUpSDO is POST /api/v1/me/step-up.
type StepUpSDO struct {
	StepUpToken string `json:"step_up_token" description:"Token niêm phong, gửi trong body step_up_token của lệnh nhạy cảm; gắn với phiên đang gọi, chết khi phiên bị thu hồi hay đăng xuất" example:"q1h8u3WbF0tA…"`
	ExpiresAt   string `json:"expires_at" description:"Hết hạn (RFC3339), 10 phút sau khi cấp; trong cửa sổ này lệnh khác không cần hỏi lại" example:"2026-10-27T08:10:00Z"`
	Method      string `json:"method" enum:"totp,password,email_code,apple,google" description:"Bằng chứng đã dùng" example:"password"`
}

// AuthorizationURLSDO is POST /api/v1/me/sign-in-methods/{provider}/link:
// where the browser goes to link the provider.
type AuthorizationURLSDO struct {
	AuthorizationURL string `json:"authorization_url" description:"URL bắt đầu liên kết qua nhà cung cấp, mang link_token 5 phút gắn với phiên trình duyệt này; mở bằng window.location.assign" example:"https://api.uniworkos.com/api/v1/auth/google/start?intent=link&link_token=…"`
}
