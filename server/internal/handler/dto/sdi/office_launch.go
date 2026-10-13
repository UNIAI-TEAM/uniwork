package sdi

// CreateOfficeLaunchSessionSDI is POST
// /api/v1/documents/{documentID}/office/sessions. documentID remains a Chi
// path parameter and is intentionally absent from this body type.
type CreateOfficeLaunchSessionSDI struct {
	Operation    string `json:"operation" description:"Thao tác yêu cầu: view hoặc edit" example:"edit"`
	Version      *int32 `json:"version,omitempty" description:"Version lịch sử dương; bỏ trống = hiện tại" example:"3"`
	DeploymentID string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	ClientID     string `json:"client_id" minLength:"1" description:"Mã client Office công khai nằm trong allowlist" example:"uniwork-office"`
	ReturnHint   string `json:"return_hint,omitempty" description:"Handoff: office hoặc none (không offer)" example:"office"`
	// CommentID is the comment the page was opened on (G8-07 §3). Optional;
	// absent keeps the pre-G8 behaviour. The service proves it belongs to the
	// document before it is stored.
	CommentID string `json:"comment_id,omitempty" description:"ULID bình luận cần mở trong tài liệu; bỏ trống = mở tài liệu" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
}

// ExchangeOfficeLaunchSessionSDI is POST /api/v1/office/sessions/exchange.
// It is a desktop-main request authenticated by the device bearer session.
type ExchangeOfficeLaunchSessionSDI struct {
	LaunchTicket    string `json:"launch_ticket" minLength:"1" description:"Launch ticket đục dùng một lần; không phải code đăng nhập" example:"ticket_opaque_ticket"`
	DeploymentID    string `json:"deployment_id" minLength:"1" description:"Mã deployment profile đã cấu hình" example:"production-eu"`
	ClientID        string `json:"client_id" minLength:"1" description:"Mã client Office công khai nằm trong allowlist" example:"uniwork-office"`
	DeviceSessionID string `json:"device_session_id" minLength:"1" description:"ULID phiên thiết bị native hiện tại" example:"01J8X4DEVN1P2Q3R4S5T6U7V8"`
}

// RevokeOfficeLaunchSessionSDI documents an optional explicit cancel/revoke
// command for a future POST route. A path-based DELETE keeps its path
// parameter out of the domain SDI.
type RevokeOfficeLaunchSessionSDI struct {
	LaunchSessionID string `json:"launch_session_id" minLength:"1" description:"ULID biên nhận launch session" example:"01J8X4LAUNCHN1P2Q3R4S5T6U7V8"`
}
