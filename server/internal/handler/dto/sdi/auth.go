package sdi

// RegisterSDI is POST /api/v1/auth/register.
type RegisterSDI struct {
	Email       string `json:"email" format:"email" minLength:"1" description:"Email đăng nhập, không trùng" example:"an@acme.vn"`
	Password    string `json:"password" minLength:"8" description:"Mật khẩu, tối thiểu 8 ký tự" example:"password123"`
	DisplayName string `json:"display_name" minLength:"1" description:"Tên hiển thị với thành viên khác" example:"Nguyễn Văn An"`
}

// LoginSDI is POST /api/v1/auth/login.
type LoginSDI struct {
	Email    string `json:"email" format:"email" minLength:"1" description:"Email tài khoản" example:"an@acme.vn"`
	Password string `json:"password" minLength:"1" description:"Mật khẩu tài khoản" example:"password123"`
}

// PatchMeSDI is PATCH /api/v1/me.
type PatchMeSDI struct {
	DisplayName *string `json:"display_name" description:"Tên hiển thị mới" example:"Nguyễn Văn An"`
	Locale      *string `json:"locale" description:"Ngôn ngữ email: vi hoặc en" example:"vi"`
	Timezone    *string `json:"timezone" description:"Múi giờ IANA cho email digest 08:00" example:"Asia/Ho_Chi_Minh"`
}

// UploadAvatarSDI is POST /api/v1/me/avatar (multipart).
type UploadAvatarSDI struct {
	File []byte `formData:"file" description:"Ảnh PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB"`
}

// VerifyEmailSDI is POST /api/v1/me/email/verify.
type VerifyEmailSDI struct {
	Code string `json:"code" minLength:"6" description:"Mã 6 số gửi qua email" example:"123456"`
}

// ForgotPasswordSDI is POST /api/v1/auth/password/forgot.
type ForgotPasswordSDI struct {
	Email string `json:"email" format:"email" minLength:"1" description:"Email tài khoản; phản hồi giống nhau dù tồn tại hay không" example:"an@acme.vn"`
}

// ResetPasswordSDI is POST /api/v1/auth/password/reset.
type ResetPasswordSDI struct {
	Token    string `json:"token" minLength:"1" description:"Token trong link email" example:"01J8X4…"`
	Password string `json:"password" minLength:"8" description:"Mật khẩu mới, tối thiểu 8 ký tự" example:"password123"`
}

// GoogleStartSDI is GET /api/v1/auth/google/start.
type GoogleStartSDI struct {
	Next string `query:"next" description:"Đường dẫn cùng origin sau khi đăng nhập" example:"/acme/team"`
}

// GoogleCallbackSDI is GET /api/v1/auth/google/callback.
type GoogleCallbackSDI struct {
	Code  string `query:"code" description:"Mã ủy quyền Google trả về"`
	State string `query:"state" description:"CSRF state khớp cookie uniwork_oauth_state"`
	Error string `query:"error" description:"Lỗi OAuth khi người dùng từ chối, ví dụ access_denied"`
}

// MFAVerifySDI is POST /api/v1/auth/mfa/verify. mfa_token may be omitted
// when the challenge arrived as the uniwork_mfa cookie (Google, reset).
type MFAVerifySDI struct {
	MFAToken string `json:"mfa_token" description:"Token thử thách từ bước đăng nhập; bỏ trống nếu đã có cookie uniwork_mfa" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mfa"`
	Code     string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực, hoặc mã khôi phục dạng xxxxx-xxxxx" example:"123456"`
}

// MFACodeSDI is POST /api/v1/me/mfa/confirm and /me/mfa/disable.
type MFACodeSDI struct {
	Code string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực (disable cũng nhận mã khôi phục)" example:"123456"`
}

// DeleteAccountSDI is POST /api/v1/me/delete. Exactly one proof is read:
// password when the account has one, else code when MFA is on, else the
// typed email address.
type DeleteAccountSDI struct {
	Password          string `json:"password" description:"Mật khẩu hiện tại (tài khoản có mật khẩu)" example:"password123"`
	Code              string `json:"code" description:"Mã TOTP hoặc mã khôi phục (tài khoản chỉ Google, có MFA)" example:"123456"`
	EmailConfirmation string `json:"email_confirmation" description:"Gõ lại email (tài khoản chỉ Google, không MFA)" example:"an@acme.vn"`
}
