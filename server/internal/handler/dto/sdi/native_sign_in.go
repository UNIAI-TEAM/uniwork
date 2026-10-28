package sdi

// NativeClientSDI is what every door of the app's own sign-in screen carries
// about the app (ADR 0049 §8): its public client id (only the native sign-in
// clients, NATIVE_SIGN_IN_CLIENTS, are taken), the deployment profile, and
// the device's own description for the session list and the owner's mails.
// Every native SDI embeds it; tokens and codes are sent once, over TLS, and
// never logged.
type NativeClientSDI struct {
	ClientID     string `json:"client_id" minLength:"1" description:"Mã client native công khai; chỉ nhận client trong NATIVE_SIGN_IN_CLIENTS (mặc định uniwork-chat-mobile), không thì 400 invalid_request" example:"uniwork-chat-mobile"`
	DeploymentID string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"default"`
	DeviceLabel  string `json:"device_label,omitempty" description:"Nhãn thiết bị đã sanitize, hiện trong danh sách thiết bị và mail báo đăng nhập" example:"iPhone của An"`
	Platform     string `json:"platform,omitempty" description:"Metadata nền tảng, có giới hạn độ dài" example:"ios"`
	Build        string `json:"build,omitempty" description:"Metadata bản dựng, có giới hạn độ dài" example:"2.1.0"`
}

// NativePasswordSDI is POST /api/v1/auth/native/password.
type NativePasswordSDI struct {
	NativeClientSDI
	Email    string `json:"email" format:"email" minLength:"1" description:"Email tài khoản" example:"an@acme.vn"`
	Password string `json:"password" minLength:"1" description:"Mật khẩu tài khoản; chỉ giữ trong bộ nhớ của app" example:"password123"`
}

// NativeMFASDI is POST /api/v1/auth/native/mfa.
type NativeMFASDI struct {
	NativeClientSDI
	MFAToken string `json:"mfa_token" minLength:"1" description:"Token thử thách từ bước đầu của app (status mfa_required); chỉ nhận token phát cho đúng client và deployment này" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mfa"`
	Code     string `json:"code" minLength:"6" description:"Mã 6 số từ ứng dụng xác thực, hoặc mã khôi phục dạng xxxxx-xxxxx" example:"123456"`
}

// NativeGoogleSDI is POST /api/v1/auth/native/google: what the app holds
// after Google's SDK.
type NativeGoogleSDI struct {
	NativeClientSDI
	IDToken string `json:"id_token" minLength:"1" description:"ID token SDK Google trả về: azp là client iOS/Android của app (GOOGLE_NATIVE_CLIENT_IDS), phát không quá 10 phút trước" example:"eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.c2ln"`
	Nonce   string `json:"nonce" minLength:"1" description:"Nonce gốc app đưa SDK; token phải mang SHA-256 (hex) của nó. Bắt buộc" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	Intent  string `json:"intent,omitempty" enum:"sign_in,sign_up" description:"sign_in (mặc định) từ màn đăng nhập: không khớp tài khoản nào thì ra vé cho màn chọn; sign_up từ màn đăng ký: không khớp thì tạo tài khoản ngay" example:"sign_in"`
}

// NativeAppleSDI is POST /api/v1/auth/native/apple: what the iPhone app
// holds after Apple's sheet.
type NativeAppleSDI struct {
	NativeClientSDI
	IdentityToken     string `json:"identity_token" minLength:"1" description:"Identity token (JWT) Apple trả về sau sheet native; aud là bundle id của app" example:"eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIn0.c2ln"`
	Nonce             string `json:"nonce" minLength:"1" description:"Nonce gốc app sinh; token phải mang SHA-256 (hex) của nó" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	AuthorizationCode string `json:"authorization_code,omitempty" description:"Authorization code dùng một lần của lần đăng nhập này; server đổi lấy refresh token để thu hồi khi xoá tài khoản" example:"c1a2b3c4d5e6f.0.mrzq.AbCdEfGhIjKlMnOp"`
	GivenName         string `json:"given_name,omitempty" description:"Tên Apple chia sẻ, chỉ có ở lần đăng nhập đầu; chỉ là gợi ý cho hồ sơ mới" example:"Ngọc"`
	FamilyName        string `json:"family_name,omitempty" description:"Họ Apple chia sẻ, chỉ có ở lần đăng nhập đầu" example:"Trần"`
	Intent            string `json:"intent,omitempty" enum:"sign_in,sign_up" description:"sign_in (mặc định) hoặc sign_up (màn đăng ký: không khớp tài khoản nào thì tạo ngay)" example:"sign_in"`
}

// NativeRegisterSDI is POST /api/v1/auth/native/register.
type NativeRegisterSDI struct {
	NativeClientSDI
	Email       string `json:"email" format:"email" minLength:"1" description:"Email đăng nhập, không trùng" example:"an@acme.vn"`
	Password    string `json:"password" minLength:"8" description:"Mật khẩu, tối thiểu 8 ký tự" example:"password123"`
	DisplayName string `json:"display_name" minLength:"1" description:"Tên hiển thị với thành viên khác" example:"Nguyễn Văn An"`
}

// NativeTicketCreateSDI is POST /api/v1/auth/native/sign-in-ticket/create.
type NativeTicketCreateSDI struct {
	NativeClientSDI
	Ticket      string `json:"ticket" minLength:"1" description:"Vé đăng nhập app nhận ở status identity_unmatched (15 phút); chỉ dùng được cùng nonce gốc, client và deployment đã cấp" example:"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw…"`
	Nonce       string `json:"nonce" minLength:"1" description:"Nonce gốc app đã đưa sheet nhà cung cấp ở lần đăng nhập ra vé này" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	DisplayName string `json:"display_name,omitempty" maxLength:"100" description:"Tên hiển thị; bắt buộc khi vé không có tên (identity.name rỗng)" example:"Nguyễn Văn An"`
}

// NativeEmailClaimSDI is POST /api/v1/auth/native/sign-in-ticket/claim-email.
type NativeEmailClaimSDI struct {
	NativeClientSDI
	Ticket string `json:"ticket" minLength:"1" description:"Vé đăng nhập app đang giữ" example:"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw…"`
	Nonce  string `json:"nonce" minLength:"1" description:"Nonce gốc của lần đăng nhập ra vé" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	Email  string `json:"email" format:"email" minLength:"3" maxLength:"254" description:"Email công việc tổ chức đã mời; mã 6 số được gửi tới đây dù địa chỉ có tài khoản hay không" example:"an@acme.vn"`
}

// NativeEmailClaimVerifySDI is POST /api/v1/auth/native/sign-in-ticket/claim-email/verify.
type NativeEmailClaimVerifySDI struct {
	NativeClientSDI
	Ticket      string `json:"ticket" minLength:"1" description:"Vé đăng nhập app đang giữ" example:"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw…"`
	Nonce       string `json:"nonce" minLength:"1" description:"Nonce gốc của lần đăng nhập ra vé" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	Email       string `json:"email" format:"email" minLength:"3" maxLength:"254" description:"Địa chỉ đã nhận mã, như lúc gửi" example:"an@acme.vn"`
	Code        string `json:"code" minLength:"6" description:"Mã 6 số trong email" example:"482913"`
	DisplayName string `json:"display_name,omitempty" maxLength:"100" description:"Tên hiển thị khi địa chỉ chưa có tài khoản và một tài khoản mới được tạo; bỏ trống thì dùng tên nhà cung cấp hoặc phần trước @" example:"Nguyễn Văn An"`
}

// NativeTicketLinkSDI is POST /api/v1/auth/native/sign-in-ticket/link.
type NativeTicketLinkSDI struct {
	NativeClientSDI
	Ticket      string `json:"ticket" minLength:"1" description:"Vé đăng nhập app đang giữ (identity_unmatched hay link_required)" example:"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw…"`
	Nonce       string `json:"nonce" minLength:"1" description:"Nonce gốc của lần đăng nhập ra vé" example:"mQ3Xr9yJm6l2Z1VbE0cK4uVhP7sA8dWf"`
	Move        bool   `json:"move,omitempty" description:"true để chuyển danh tính từ tài khoản trống đang giữ nó (sau 409 sign_in_method_movable) sang tài khoản đang đăng nhập; tài khoản trống bị xoá" example:"false"`
	StepUpToken string `json:"step_up_token,omitempty" description:"Token từ POST /me/step-up của phiên thiết bị này: thay cho phiên mới hơn vé (phiên bắt đầu trước khi vé được cấp)" example:"q1h8u3WbF0tA…"`
}

// LinkGoogleNativeSDI is POST /api/v1/me/sign-in-methods/google/native.
type LinkGoogleNativeSDI struct {
	StepUpToken string `json:"step_up_token" description:"Token từ POST /me/step-up của phiên thiết bị đang gọi (10 phút); thiếu hay hết hạn → 403 proof_required" example:"q1h8u3WbF0tA…"`
	IDToken     string `json:"id_token" minLength:"1" description:"ID token SDK Google vừa trả về: azp là client iOS/Android của app, phát không quá 10 phút trước" example:"eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.c2ln"`
	Nonce       string `json:"nonce" minLength:"1" description:"Nonce gốc app đưa SDK; token phải mang SHA-256 (hex) của nó" example:"q8Zt0rM2n5"`
	Move        bool   `json:"move,omitempty" description:"true để chuyển danh tính từ tài khoản trống đang giữ nó (sau 409 sign_in_method_movable) sang tài khoản này" example:"false"`
}

// LinkAppleNativeSDI is POST /api/v1/me/sign-in-methods/apple/native.
type LinkAppleNativeSDI struct {
	StepUpToken       string `json:"step_up_token" description:"Token từ POST /me/step-up của phiên thiết bị đang gọi (10 phút); thiếu hay hết hạn → 403 proof_required" example:"q1h8u3WbF0tA…"`
	IdentityToken     string `json:"identity_token" minLength:"1" description:"Identity token sheet Apple vừa trả về; aud là bundle id của app" example:"eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIn0.c2ln"`
	Nonce             string `json:"nonce" minLength:"1" description:"Nonce gốc app đưa sheet; token phải mang SHA-256 (hex) của nó" example:"q8Zt0rM2n5"`
	AuthorizationCode string `json:"authorization_code,omitempty" description:"Authorization code dùng một lần; server đổi lấy refresh token để thu hồi khi gỡ liên kết hay xoá tài khoản" example:"c1a2b3c4d5e6f.0.mrzq.AbCdEfGhIjKlMnOp"`
	Move              bool   `json:"move,omitempty" description:"true để chuyển danh tính từ tài khoản trống đang giữ nó (sau 409 sign_in_method_movable) sang tài khoản này" example:"false"`
}
