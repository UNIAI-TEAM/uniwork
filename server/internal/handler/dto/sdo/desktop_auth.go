package sdo

// DesktopStartSDO is returned by GET /api/v1/auth/desktop/start. The URL is
// no-store and contains no verifier or secret.
type DesktopStartSDO struct {
	AuthorizationURL string `json:"authorization_url" description:"URL ủy quyền mở bằng browser hệ thống" example:"https://app.example.test/auth/desktop/authorize?..."`
	AttemptExpiresAt string `json:"attempt_expires_at" description:"Hạn pending attempt (RFC3339)" example:"2026-09-29T10:10:00Z"`
}

// DesktopSessionSDO is the native token response. It is delivered to desktop
// main over TLS; the renderer receives only non-secret session metadata.
type DesktopSessionSDO struct {
	AccountID        string `json:"account_id" description:"ULID chủ tài khoản" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DeviceSessionID  string `json:"device_session_id" description:"ULID phiên thiết bị native" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
	SessionID        string `json:"session_id" description:"ID thành viên session-family auth hiện có" example:"01J8X4SESSN1P2Q3R4S5T6U7V8"`
	AccessToken      string `json:"access_token" description:"Bearer access token; không bao giờ gửi tới renderer" example:"eyJhbGciOiJIUzI1NiJ9..."`
	TokenType        string `json:"token_type" description:"Scheme ủy quyền" example:"Bearer"`
	ExpiresIn        int32  `json:"expires_in" description:"Thời hạn access token tính bằng giây" example:"900"`
	RefreshToken     string `json:"refresh_token" description:"Token đục xoay vòng; chỉ lưu trong kho bí mật host" example:"r1_opaque_refresh_token"`
	RefreshExpiresIn int32  `json:"refresh_expires_in" description:"Thời hạn refresh token tính bằng giây" example:"2592000"`
	RefreshRotates   bool   `json:"refresh_rotates" description:"Mỗi lần refresh có trả token thay thế hay không" example:"true"`
}

// DesktopDeviceDTO is metadata for one device session. Token digests and raw
// user-agent/IP values are never returned by the list endpoint.
type DesktopDeviceDTO struct {
	ID           string  `json:"id" description:"ULID phiên thiết bị" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
	ClientID     string  `json:"client_id" description:"Mã client Office công khai" example:"uniwork-office"`
	DeploymentID string  `json:"deployment_id" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	DeviceLabel  string  `json:"device_label" description:"Nhãn thiết bị đã sanitize" example:"Mai laptop"`
	Platform     string  `json:"platform" description:"Nền tảng host" example:"windows"`
	Build        string  `json:"build" description:"Bản dựng desktop" example:"1.0.0"`
	CreatedAt    string  `json:"created_at" description:"Thời điểm tạo (RFC3339)" example:"2026-09-29T09:00:00Z"`
	LastUsedAt   string  `json:"last_used_at" description:"Request được chấp nhận gần nhất (RFC3339)" example:"2026-09-29T09:30:00Z"`
	ExpiresAt    string  `json:"expires_at" description:"Hạn phiên thiết bị (RFC3339)" example:"2026-10-29T09:00:00Z"`
	RevokedAt    *string `json:"revoked_at" description:"Thời điểm thu hồi; null khi còn hiệu lực" example:"2026-09-29T10:00:00Z"`
	Current      bool    `json:"current" description:"True nếu là phiên thiết bị đang gọi" example:"true"`
}

// DesktopDeviceListSDO is GET /api/v1/auth/desktop/devices.
type DesktopDeviceListSDO struct {
	Devices    []DesktopDeviceDTO `json:"devices"`
	NextCursor *string            `json:"next_cursor" description:"Con trỏ đục; null ở trang cuối" example:"eyJ2IjozfQ"`
}
