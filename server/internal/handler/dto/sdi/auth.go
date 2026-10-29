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
	// KeepSignInTicket is the choice screen's "I already have an account":
	// this sign-in is the one the pending Google/Apple identity links into.
	KeepSignInTicket bool `json:"keep_sign_in_ticket,omitempty" description:"true khi đăng nhập để liên kết Google/Apple đang chờ (màn chọn, /login?link=1): giữ cookie vé uniwork_sign_in_ticket; mặc định đăng nhập thành công xoá vé" example:"false"`
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
	Token            string `json:"token" minLength:"1" description:"Token trong link email" example:"01J8X4…"`
	Password         string `json:"password" minLength:"8" description:"Mật khẩu mới, tối thiểu 8 ký tự" example:"password123"`
	KeepSignInTicket bool   `json:"keep_sign_in_ticket,omitempty" description:"true khi đặt lại mật khẩu giữa lúc liên kết Google/Apple đang chờ: giữ cookie vé uniwork_sign_in_ticket; mặc định xoá vé" example:"false"`
}

// GoogleStartSDI is GET /api/v1/auth/google/start.
type GoogleStartSDI struct {
	Next      string `query:"next" description:"Đường dẫn cùng origin sau khi đăng nhập; /auth/continue?step=link&… (đăng nhập để liên kết vé đang chờ) giữ cookie vé" example:"/acme/team"`
	Intent    string `query:"intent" description:"sign_in (mặc định) từ trang đăng nhập: không khớp tài khoản nào thì ra vé và màn chọn; sign_up từ trang đăng ký: không khớp thì tạo tài khoản ngay; link (kèm link_token, từ Cài đặt): liên kết vào tài khoản đang đăng nhập; giá trị khác chuyển về /login?error=google_failed" example:"sign_in"`
	LinkToken string `query:"link_token" description:"Với intent=link: token từ POST /me/sign-in-methods/google/link (5 phút); cookie refresh của trình duyệt phải thuộc đúng phiên đã xin nó, không thì quay về return_to với result=session_mismatch" example:"Xb2u…"`
}

// SignInTicketCreateSDI is POST /api/v1/auth/sign-in-ticket/create.
type SignInTicketCreateSDI struct {
	DisplayName string `json:"display_name,omitempty" maxLength:"100" description:"Tên hiển thị; bắt buộc khi nhà cung cấp không cho tên (vé có name rỗng), bỏ trống thì dùng tên nhà cung cấp" example:"Nguyễn Văn An"`
}

// SignInEmailClaimSDI is POST /api/v1/auth/sign-in-ticket/claim-email.
type SignInEmailClaimSDI struct {
	Email string `json:"email" format:"email" minLength:"3" maxLength:"254" description:"Email công việc tổ chức đã mời; mã 6 số được gửi tới đây dù địa chỉ có tài khoản hay không" example:"an@acme.vn"`
}

// SignInEmailClaimVerifySDI is POST /api/v1/auth/sign-in-ticket/claim-email/verify.
type SignInEmailClaimVerifySDI struct {
	Email       string `json:"email" format:"email" minLength:"3" maxLength:"254" description:"Địa chỉ đã nhận mã, như lúc gửi" example:"an@acme.vn"`
	Code        string `json:"code" minLength:"6" description:"Mã 6 số trong email" example:"482913"`
	DisplayName string `json:"display_name,omitempty" maxLength:"100" description:"Tên hiển thị khi địa chỉ chưa có tài khoản và một tài khoản mới được tạo; bỏ trống thì dùng tên nhà cung cấp hoặc phần trước @" example:"Nguyễn Văn An"`
}

// SignInTicketLinkSDI is POST /api/v1/auth/sign-in-ticket/link.
type SignInTicketLinkSDI struct {
	Move        bool   `json:"move,omitempty" description:"true để chuyển danh tính từ tài khoản trống đang giữ nó (sau 409 sign_in_method_movable) sang tài khoản đang đăng nhập; tài khoản trống bị xoá" example:"false"`
	StepUpToken string `json:"step_up_token,omitempty" description:"Token từ POST /me/step-up: thay cho phiên mới hơn vé (phiên bắt đầu trước khi vé được cấp, hay Cài đặt xác nhận chuyển sau khi liên kết trả movable)" example:"q1h8u3WbF0tA…"`
}

// GoogleCallbackSDI is GET /api/v1/auth/google/callback.
type GoogleCallbackSDI struct {
	Code  string `query:"code" description:"Mã ủy quyền Google trả về" example:"4/0AeanS0b"`
	State string `query:"state" description:"CSRF state khớp state trong cookie niêm phong uniwork_oauth_state" example:"9f2c4e1ab37d"`
	Error string `query:"error" description:"Lỗi OAuth khi người dùng từ chối, ví dụ access_denied" example:"access_denied"`
}

// MFAVerifySDI is POST /api/v1/auth/mfa/verify. mfa_token may be omitted
// when the challenge arrived as the uniwork_mfa cookie (Google, reset).
type MFAVerifySDI struct {
	MFAToken         string `json:"mfa_token" description:"Token thử thách từ bước đăng nhập; bỏ trống nếu đã có cookie uniwork_mfa" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mfa"`
	Code             string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực, hoặc mã khôi phục dạng xxxxx-xxxxx" example:"123456"`
	KeepSignInTicket bool   `json:"keep_sign_in_ticket,omitempty" description:"true khi bước hai này thuộc lần đăng nhập để liên kết Google/Apple đang chờ: giữ cookie vé uniwork_sign_in_ticket; mặc định xoá vé" example:"false"`
}

// MFACodeSDI is POST /api/v1/me/mfa/disable.
type MFACodeSDI struct {
	Code string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực hoặc mã khôi phục" example:"123456"`
}

// DeleteAccountSDI is POST /api/v1/me/delete. The proof is step_up_token;
// without it exactly one legacy proof is read (shipped apps, reviewed
// 2027-01-31): password when the account has one, else code when MFA is on,
// else the typed email address.
type DeleteAccountSDI struct {
	StepUpToken       string `json:"step_up_token,omitempty" description:"Token từ POST /me/step-up (action delete_account khi chứng minh bằng mã email); có thì ba trường cũ bên dưới bị bỏ qua" example:"q1h8u3WbF0tA…"`
	Password          string `json:"password" description:"Cũ (app đã phát hành, xem lại 2027-01-31): mật khẩu hiện tại (tài khoản có mật khẩu)" example:"password123"`
	Code              string `json:"code" description:"Cũ: mã TOTP hoặc mã khôi phục (tài khoản không mật khẩu, có MFA)" example:"123456"`
	EmailConfirmation string `json:"email_confirmation" description:"Cũ: gõ lại email (tài khoản không mật khẩu, không MFA)" example:"an@acme.vn"`
	CloseOrganization string `json:"close_organization,omitempty" description:"Địa chỉ (slug) của tổ chức mà tài khoản là chủ sở hữu và thành viên duy nhất, gõ lại: tổ chức được đóng (lưu trữ) cùng giao dịch với việc xóa tài khoản" example:"cong-ty-mot-minh"`
}

// SetPushPreviewsSDI is PUT /api/v1/me/push-previews.
type SetPushPreviewsSDI struct {
	Show *bool `json:"show" description:"true hiện nội dung trong push, false chỉ nói loại việc vừa xảy ra, không tên hay chữ trong tin; bắt buộc" example:"false"`
}

// PushPreviewPolicySDI is PUT /api/v1/orgs/{org}/push-preview-policy.
type PushPreviewPolicySDI struct {
	Hidden *bool `json:"hidden" description:"true ẩn nội dung (tên, tiêu đề, chữ trong tin) trong mọi push của tổ chức; bắt buộc" example:"true"`
}

// MobileSecurityPolicySDI is PUT /api/v1/orgs/{org}/mobile-security-policy:
// at least one field; a field left out keeps its value.
type MobileSecurityPolicySDI struct {
	RequireAppLock     *bool `json:"require_app_lock,omitempty" description:"true bắt buộc khoá UniChat trên điện thoại của mọi thành viên, false bỏ yêu cầu; bỏ trống thì giữ nguyên" example:"true"`
	BlockScreenCapture *bool `json:"block_screen_capture,omitempty" description:"true bắt buộc chặn chụp/quay màn hình UniChat, false bỏ yêu cầu; bỏ trống thì giữ nguyên" example:"true"`
}

// SetAIConsentSDI is PUT /api/v1/me/ai-consent.
type SetAIConsentSDI struct {
	Version string `json:"version" description:"Phiên bản thông báo xử lý AI người dùng vừa đồng ý (tối đa 64 ký tự, không khoảng trắng)" example:"2026-10-anthropic"`
}
