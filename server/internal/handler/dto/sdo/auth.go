package sdo

import "encoding/json"

// SessionSDO is the body of register, login and refresh.
type SessionSDO struct {
	User        UserDTO `json:"user"`
	AccessToken string  `json:"access_token" description:"JWT access token, gửi kèm Authorization Bearer" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.example"`
	// LinkSkipped is set only by POST /auth/mfa/verify when the challenge
	// carried a pending provider link that could not be written (ADR 0047).
	LinkSkipped string `json:"link_skipped,omitempty" description:"Chỉ có ở /auth/mfa/verify: đăng nhập thành công nhưng chưa liên kết được Google/Apple đang chờ, kèm mã lý do (sign_in_method_taken, link_required, sign_in_account_conflict, sign_in_account_unverified, sign_in_email_unverified, sign_in_failed); client gợi ý liên kết lại trong Cài đặt" example:"sign_in_method_taken"`
	// Reclaimed is set only when this session took the account back from
	// whoever registered the address before proving it (a reset link).
	Reclaimed bool `json:"reclaimed,omitempty" description:"Chỉ có khi true: phiên này vừa lấy lại tài khoản đăng ký trước khi email được xác minh (mật khẩu cũ, xác thực hai lớp và mọi phiên của người đăng ký trước đã bị xoá); client báo một lần" example:"true"`
}

// UserSDO wraps the current user.
type UserSDO struct {
	User UserDTO `json:"user"`
}

type UserDTO struct {
	ID                      string          `json:"id" description:"ULID người dùng" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email                   string          `json:"email" format:"email" example:"an@acme.vn"`
	DisplayName             string          `json:"display_name" example:"Nguyễn Văn An"`
	Locale                  string          `json:"locale" description:"Ngôn ngữ email của người dùng" example:"vi"`
	Timezone                string          `json:"timezone" description:"Múi giờ IANA, dùng cho email digest" example:"Asia/Ho_Chi_Minh"`
	AvatarURL               string          `json:"avatar_url,omitempty" description:"URL avatar công khai khi đã tải lên" example:"https://cdn.example.com/avatars/an.png"`
	OnboardedAt             *string         `json:"onboarded_at" description:"Thời điểm hoàn thành onboarding (RFC3339); null nếu chưa xong" example:"2026-08-01T09:00:00Z"`
	EmailVerifiedAt         *string         `json:"email_verified_at" description:"Thời điểm xác nhận email (RFC3339); null nếu chưa xác nhận" example:"2026-08-01T09:00:00Z"`
	OnboardingQuestionnaire json.RawMessage `json:"onboarding_questionnaire" description:"JSON câu hỏi onboarding đã lưu" example:"{\"role\":\"lead\"}"`
	MFAEnabledAt            *string         `json:"mfa_enabled_at" description:"Thời điểm bật xác thực hai lớp (RFC3339); null khi tắt" example:"2026-09-07T08:00:00Z"`
	HasPassword             bool            `json:"has_password" description:"true khi tài khoản có mật khẩu (không phải chỉ Google); quyết định cách xác thực lại khi xóa" example:"true"`
	PlatformRole            string          `json:"platform_role,omitempty" description:"admin hoặc support khi là nhân sự nền tảng; nền tảng bắt buộc MFA" example:"support"`
	AIConsentVersion        *string         `json:"ai_consent_version" description:"Phiên bản thông báo xử lý AI người dùng đã đồng ý; null khi chưa đồng ý hoặc đã rút lại" example:"2026-10-anthropic"`
	AIConsentAt             *string         `json:"ai_consent_at" description:"Thời điểm đồng ý xử lý AI (RFC3339); null khi chưa đồng ý" example:"2026-10-21T08:00:00Z"`
	AIOptOutAt              *string         `json:"ai_opt_out_at" description:"Thời điểm người dùng từ chối (hay rút lại) xử lý AI (RFC3339): từ đó tin của họ không vào yêu cầu AI nào, dù ai yêu cầu; null khi không từ chối" example:"2026-10-22T08:00:00Z"`
	PushPreviews            bool            `json:"push_previews" description:"true khi push được hiện nội dung; false khi người dùng ẩn (chính sách của tổ chức có thể ẩn dù đây là true)" example:"true"`
}

// PushPreviewPolicySDO is GET/PUT /api/v1/orgs/{org}/push-preview-policy.
type PushPreviewPolicySDO struct {
	Hidden    bool    `json:"hidden" description:"true khi mọi push của tổ chức (trừ chuông cuộc gọi đến) ẩn nội dung: không tên người, phòng, việc, tài liệu hay chữ trong tin" example:"false"`
	HiddenAt  *string `json:"hidden_at" description:"Thời điểm bật ẩn (RFC3339); null khi đang hiện" example:"2026-10-22T08:00:00Z"`
	CanManage bool    `json:"can_manage" description:"true khi người gọi là owner/admin và đổi được chính sách" example:"true"`
}

// MobileSecurityPolicySDO is GET/PUT /api/v1/orgs/{org}/mobile-security-policy.
type MobileSecurityPolicySDO struct {
	RequireAppLock     bool `json:"require_app_lock" description:"true khi tổ chức bắt buộc khoá UniChat (Face ID, vân tay hay mã máy) trên điện thoại của mọi thành viên; app coi là mức tối thiểu người dùng không hạ được" example:"false"`
	BlockScreenCapture bool `json:"block_screen_capture" description:"true khi tổ chức bắt buộc chặn chụp và quay màn hình UniChat (kèm che nội dung trong trình chuyển ứng dụng) trên điện thoại của mọi thành viên" example:"false"`
	CanManage          bool `json:"can_manage" description:"true khi người gọi là owner/admin và đổi được chính sách" example:"true"`
}

// AuthProvidersSDO is GET /api/v1/auth/providers. Flags are only ever
// added: apple keeps the meaning the shipped iPhone app reads (ADR 0047 §10).
type AuthProvidersSDO struct {
	Google       bool `json:"google" description:"true khi đăng nhập Google trên web được cấu hình trên server" example:"true"`
	Apple        bool `json:"apple" description:"true khi Sign in with Apple native (app iPhone) được cấu hình trên server" example:"true"`
	AppleWeb     bool `json:"apple_web" description:"true khi Sign in with Apple trên web (Services ID) được cấu hình trên server" example:"false"`
	GoogleNative bool `json:"google_native" description:"true khi đăng nhập Google bằng SDK trong app điện thoại được cấu hình trên server" example:"false"`
}

// SignInTicketSDO is GET /api/v1/auth/sign-in-ticket: the pending provider
// sign-in the choice screen shows (ADR 0047).
type SignInTicketSDO struct {
	Provider     string `json:"provider" enum:"google,apple" description:"Nhà cung cấp của lượt đăng nhập đang chờ" example:"apple"`
	Kind         string `json:"kind" enum:"unmatched,link_required" description:"unmatched: không tài khoản nào khớp (ba lựa chọn); link_required: email đã có tài khoản, đăng nhập vào đó để liên kết" example:"unmatched"`
	Email        string `json:"email" description:"Email nhà cung cấp cho; có thể là email ẩn của Apple" example:"an@icloud.com"`
	Name         string `json:"name" description:"Tên nhà cung cấp cho; rỗng thì màn tạo tài khoản hỏi tên hiển thị" example:"Nguyễn Văn An"`
	PrivateRelay bool   `json:"private_relay" description:"true khi email là địa chỉ ẩn của Apple (Hide My Email)" example:"false"`
}

// SignInPasswordSDO is the password row of SignInMethodsSDO.
type SignInPasswordSDO struct {
	Set       bool    `json:"set" description:"true khi tài khoản có mật khẩu" example:"true"`
	ChangedAt *string `json:"changed_at" description:"Lần đặt hay đổi mật khẩu gần nhất (RFC3339); null khi chưa ghi nhận" example:"2026-10-12T08:00:00Z"`
}

// SignInProviderSDO is the Google row of SignInMethodsSDO.
type SignInProviderSDO struct {
	Linked   bool    `json:"linked" description:"true khi nhà cung cấp mở được tài khoản này" example:"true"`
	Email    *string `json:"email" description:"Email nhà cung cấp cho lúc liên kết; null khi chưa liên kết" example:"an@gmail.com"`
	LinkedAt *string `json:"linked_at" description:"Thời điểm liên kết (RFC3339); null khi chưa liên kết hoặc liên kết từ trước khi được ghi nhận" example:"2026-10-27T08:00:00Z"`
}

// SignInAppleSDO is the Apple row of SignInMethodsSDO.
type SignInAppleSDO struct {
	Linked       bool    `json:"linked" description:"true khi Apple mở được tài khoản này" example:"false"`
	Email        *string `json:"email" description:"Email Apple cho lúc liên kết; null khi chưa liên kết" example:"q7x2@privaterelay.appleid.com"`
	LinkedAt     *string `json:"linked_at" description:"Thời điểm liên kết (RFC3339); null khi chưa liên kết hoặc liên kết từ trước khi được ghi nhận" example:"2026-10-27T08:00:00Z"`
	PrivateRelay bool    `json:"private_relay" description:"true khi email Apple là địa chỉ ẩn (Hide My Email)" example:"false"`
}

// SignInMethodsSDO is how an account signs in (spec §3.7).
type SignInMethodsSDO struct {
	Password            SignInPasswordSDO `json:"password"`
	Google              SignInProviderSDO `json:"google"`
	Apple               SignInAppleSDO    `json:"apple"`
	AccountEmailIsRelay bool              `json:"account_email_is_relay" description:"true khi email đăng nhập của tài khoản là địa chỉ ẩn của Apple" example:"false"`
	Proofs              []string          `json:"proofs" description:"Các cách xác nhận là bạn mà lệnh nhạy cảm nhận: totp (khi bật xác thực hai lớp, chỉ cách này), password, email_code, và trên app apple/google" example:"[\"password\",\"email_code\"]"`
}

// SignInMethodsChangeSDO answers a command that changed how the account
// signs in. The client stores user only when it parses; otherwise it reads
// /me again, never a fallback user.
type SignInMethodsChangeSDO struct {
	User          UserDTO          `json:"user"`
	SignInMethods SignInMethodsSDO `json:"sign_in_methods"`
}

// MFAChallengeSDO replaces SessionSDO on login when the account has MFA on.
type MFAChallengeSDO struct {
	MFARequired bool   `json:"mfa_required" description:"Luôn true: cần bước xác thực thứ hai" example:"true"`
	MFAToken    string `json:"mfa_token" description:"Token 5 phút, gửi lại ở POST /auth/mfa/verify" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mfa"`
}

// MFASetupSDO is POST /api/v1/me/mfa/setup.
type MFASetupSDO struct {
	Secret     string `json:"secret" description:"Bí mật base32 để nhập tay" example:"JBSWY3DPEHPK3PXP"`
	OTPAuthURL string `json:"otpauth_url" description:"URI otpauth:// để hiện mã QR" example:"otpauth://totp/UniWork:an%40acme.vn?secret=JBSWY3DPEHPK3PXP&issuer=UniWork"`
}

// MFARecoveryCodesSDO is POST /api/v1/me/mfa/confirm: shown once.
type MFARecoveryCodesSDO struct {
	RecoveryCodes []string `json:"recovery_codes" description:"8 mã dùng một lần; chỉ hiện lúc này" example:"[\"abcde-fghij\"]"`
}

// UserSessionDTO is one live session of the current user.
type UserSessionDTO struct {
	ID         string `json:"id" description:"ULID phiên" example:"01J8X4SESS0N1P2Q3R4S5T6U7"`
	UserAgent  string `json:"user_agent" description:"User-Agent lúc đăng nhập" example:"Mozilla/5.0 (Macintosh) Chrome/128"`
	IP         string `json:"ip" description:"Địa chỉ IP lần hoạt động gần nhất" example:"203.0.113.7"`
	CreatedAt  string `json:"created_at" description:"Thời điểm đăng nhập (RFC3339)" example:"2026-09-07T08:00:00Z"`
	LastSeenAt string `json:"last_seen_at" description:"Lần làm mới token gần nhất (RFC3339)" example:"2026-09-07T09:30:00Z"`
	Current    bool   `json:"current" description:"true cho phiên đang gọi API" example:"true"`
}

// SessionListSDO is GET /api/v1/me/sessions.
type SessionListSDO struct {
	Sessions []UserSessionDTO `json:"sessions"`
}
