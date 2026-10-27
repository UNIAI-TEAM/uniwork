package sdi

// StepUpSDI is POST /api/v1/me/step-up: one proof, of a kind the account
// takes (sign_in_methods.proofs).
type StepUpSDI struct {
	Password      string            `json:"password,omitempty" description:"Mật khẩu hiện tại; nhận khi proofs có password (tài khoản có mật khẩu, không bật xác thực hai lớp)" example:"password123"`
	Code          string            `json:"code,omitempty" description:"Mã TOTP hoặc mã khôi phục khi bật xác thực hai lớp (proofs chỉ có totp); không thì mã 6 số gửi qua POST /me/step-up/email-code, kèm action" example:"482913"`
	Action        string            `json:"action,omitempty" enum:"set_password,change_password,link_google,link_apple,unlink_google,unlink_apple,enable_mfa,delete_account,transfer_ownership" description:"Với mã gửi qua email: đúng action đã xin mã; mã của việc khác không nhận" example:"delete_account"`
	ProviderToken *ProviderTokenSDI `json:"provider_token,omitempty" description:"Chỉ trên app: identity token Apple/Google vừa lấy từ sheet của nhà cung cấp cho danh tính đã liên kết (proofs có apple/google)"`
}

// ProviderTokenSDI is a fresh provider identity token offered as a proof.
type ProviderTokenSDI struct {
	Provider string `json:"provider" enum:"apple,google" description:"Nhà cung cấp của token" example:"apple"`
	Token    string `json:"token" minLength:"1" description:"Identity token vừa lấy (phát không quá 5 phút trước), của đúng danh tính đã liên kết" example:"eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ.e30.sig"`
	Nonce    string `json:"nonce" minLength:"1" description:"Nonce gốc app đã đưa sheet (token mang SHA-256 hex của nó)" example:"q8Zt0rM2n5"`
}

// StepUpEmailCodeSDI is POST /api/v1/me/step-up/email-code.
type StepUpEmailCodeSDI struct {
	Action string `json:"action" enum:"set_password,change_password,link_google,link_apple,unlink_google,unlink_apple,enable_mfa,delete_account,transfer_ownership" description:"Việc mã cho phép; email nêu việc này và mã chỉ dùng được cho nó" example:"set_password"`
}

// StepUpTokenSDI is a command whose only input is the owner's proof:
// POST /me/mfa/setup, POST /me/sign-in-methods/{provider}/unlink.
type StepUpTokenSDI struct {
	StepUpToken string `json:"step_up_token" description:"Token từ POST /me/step-up (10 phút, gắn với phiên đang gọi); thiếu hay hết hạn → 403 proof_required" example:"q1h8u3WbF0tA…"`
}

// SetPasswordSDI is PUT /api/v1/me/password.
type SetPasswordSDI struct {
	NewPassword     string `json:"new_password" minLength:"8" description:"Mật khẩu mới, tối thiểu 8 ký tự" example:"new-password-2026"`
	CurrentPassword string `json:"current_password,omitempty" description:"Đổi mật khẩu của tài khoản không bật xác thực hai lớp: mật khẩu hiện tại là bằng chứng (bật hai lớp thì 403 proof_required, dùng step_up_token từ mã TOTP)" example:"password123"`
	StepUpToken     string `json:"step_up_token,omitempty" description:"Đặt mật khẩu lần đầu (tài khoản chưa có mật khẩu) hay đổi mật khẩu khi bật xác thực hai lớp: token từ POST /me/step-up; đổi mật khẩu cũng nhận thay cho current_password" example:"q1h8u3WbF0tA…"`
}

// LinkSignInMethodSDI is POST /api/v1/me/sign-in-methods/{provider}/link.
type LinkSignInMethodSDI struct {
	StepUpToken string `json:"step_up_token" description:"Token từ POST /me/step-up của phiên trình duyệt đang gọi" example:"q1h8u3WbF0tA…"`
	ReturnTo    string `json:"return_to,omitempty" description:"Đường dẫn cùng origin trình duyệt quay về sau khi liên kết, kèm sign_in_method và result; mặc định /settings?tab=security" example:"/settings?tab=security"`
}

// MFAConfirmSDI is POST /api/v1/me/mfa/confirm.
type MFAConfirmSDI struct {
	Code        string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực vừa thêm" example:"123456"`
	StepUpToken string `json:"step_up_token" description:"Token từ POST /me/step-up (cùng token đã dùng cho /me/mfa/setup trong 10 phút)" example:"q1h8u3WbF0tA…"`
}
