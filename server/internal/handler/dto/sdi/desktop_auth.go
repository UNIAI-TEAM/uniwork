package sdi

// DesktopStartSDI is the query contract for GET /api/v1/auth/desktop/start.
// The desktop main process owns verifier and state; the server receives the
// derived challenge and validates it against its client/deployment allowlist.
// This file is a draft until the endpoint is registered by G4-02b.
type DesktopStartSDI struct {
	ClientID            string `query:"client_id" minLength:"1" description:"Mã client Office công khai nằm trong allowlist" example:"uniwork-office"`
	CodeChallenge       string `query:"code_challenge" minLength:"43" description:"Challenge S256 base64url không đệm, đúng 43 ký tự (RFC 7636)" example:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"`
	CodeChallengeMethod string `query:"code_challenge_method" description:"Phương thức PKCE; chỉ nhận S256" example:"S256"`
	State               string `query:"state" minLength:"1" description:"State đục do client sinh; callback trả lại nguyên vẹn" example:"dGhlLXN0YXRl"`
	RedirectURI         string `query:"redirect_uri" description:"URI callback đã đăng ký, khớp chính xác từng byte" example:"uniwork-office://auth/callback"`
	DeploymentID        string `query:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	DeviceLabel         string `query:"device_label" description:"Nhãn thiết bị đã sanitize, không phải định danh tài khoản" example:"Mai laptop"`
	Platform            string `query:"platform" description:"Metadata nền tảng host, có giới hạn độ dài" example:"windows"`
	Build               string `query:"build" description:"Metadata bản dựng desktop, có giới hạn độ dài" example:"1.0.0"`
}

// DesktopExchangeSDI is POST /api/v1/auth/desktop/exchange. The verifier is
// sent only over TLS in this request and is never part of the authorize URL.
type DesktopExchangeSDI struct {
	ClientID     string `json:"client_id" minLength:"1" description:"Mã client Office công khai nằm trong allowlist" example:"uniwork-office"`
	Code         string `json:"code" minLength:"1" description:"Code ủy quyền dùng một lần; không phải launch ticket" example:"01J8X4AUTHCODE1P2Q3R4S5T6U7V8"`
	CodeVerifier string `json:"code_verifier" minLength:"43" description:"Verifier RFC 7636 gốc; chỉ gửi qua TLS trong request này" example:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"`
	RedirectURI  string `json:"redirect_uri" description:"URI callback đã đăng ký, khớp chính xác từng byte" example:"uniwork-office://auth/callback"`
	DeploymentID string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	DeviceLabel  string `json:"device_label,omitempty" description:"Nhãn thiết bị đã sanitize" example:"Mai laptop"`
	Platform     string `json:"platform,omitempty" description:"Metadata nền tảng host, có giới hạn độ dài" example:"windows"`
	Build        string `json:"build,omitempty" description:"Metadata bản dựng desktop, có giới hạn độ dài" example:"1.0.0"`
}

// DesktopRefreshSDI is POST /api/v1/auth/desktop/refresh. Raw refresh tokens
// are accepted only by the main process and are never put in a cookie or URL.
type DesktopRefreshSDI struct {
	DeviceSessionID string `json:"device_session_id" minLength:"1" description:"ULID phiên thiết bị native" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
	RefreshToken    string `json:"refresh_token" minLength:"1" description:"Refresh token đục từ kho bí mật của host" example:"r1_opaque_refresh_token"`
	DeploymentID    string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
}

// DesktopLogoutSDI is POST /api/v1/auth/desktop/logout.
type DesktopLogoutSDI struct {
	DeviceSessionID string `json:"device_session_id" minLength:"1" description:"ULID phiên thiết bị native" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
	DeploymentID    string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	Scope           string `json:"scope,omitempty" description:"device (mặc định) hoặc family" example:"device"`
}

// RevokeDesktopDeviceSDI documents the command payload if the eventual
// handler uses a command POST. A DELETE route keeps the identifier in the
// path, as required by docs/api-sdi-sdo.md, and does not decode this body.
type RevokeDesktopDeviceSDI struct {
	DeviceSessionID string `json:"device_session_id" minLength:"1" description:"ULID phiên thiết bị native cần thu hồi" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
}

// DesktopConsentSDI is the same-site browser consent command. A GET never
// approves; this body is accepted only by the POST command after login/MFA.
type DesktopConsentSDI struct {
	AttemptID string `json:"attempt_id" minLength:"1" description:"ULID pending desktop authorization attempt" example:"01J8X4ATTEMPT0000000000000"`
	CSRFToken string `json:"csrf_token" minLength:"1" description:"Single-use same-site consent token" example:"csrf-token"`
	Decision  string `json:"decision" description:"approve or cancel" example:"approve"`
}
