package sdo

// Document edit lock (UNI-1645, addendum 2026-10-15 §3.2). Ids are ULID
// strings, times RFC 3339 UTC strings, *_ms integers. lock_id is the
// holder's key: only DocumentEditLockSDO carries it, plus the summary of a
// manager who is not the holder (contract v2 C2-1); never the 423 body or a
// list row.

// DocumentEditLockSDO is the holder's own tenure (R2, R5, R6, R7).
type DocumentEditLockSDO struct {
	LockID              string  `json:"lock_id" description:"ULID nhiệm kỳ khóa; chìa của người giữ, gửi lại ở heartbeat/nhả/giữ offline và edit_lock_id của lệnh ghi" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
	DocumentID          string  `json:"document_id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	HolderID            string  `json:"holder_id" description:"ULID người giữ (chính người gọi)" example:"01J8X4USR0N1P2Q3R4S5T6U7"`
	Client              string  `json:"client" description:"web_page | web_office | desktop" example:"web_page"`
	AcquiredAt          string  `json:"acquired_at" description:"Lúc nhiệm kỳ bắt đầu (RFC3339, giờ server)" example:"2026-10-15T03:12:00Z"`
	ExpiresAt           string  `json:"expires_at" description:"Hạn theo heartbeat (RFC3339, giờ server)" example:"2026-10-15T03:14:00Z"`
	OfflineHoldUntil    *string `json:"offline_hold_until,omitempty" description:"Hạn giữ quyền sửa offline (RFC3339); vắng khi không giữ" example:"2026-10-15T11:12:00Z"`
	HoldMaxUntil        *string `json:"hold_max_until,omitempty" description:"Trần chuỗi giữ offline của nhiệm kỳ (RFC3339); vắng khi chưa giữ" example:"2026-10-16T03:12:00Z"`
	GrantedVia          string  `json:"granted_via" description:"acquire | take_over | handover | move_here" example:"acquire"`
	HeartbeatIntervalMS int64   `json:"heartbeat_interval_ms" description:"Chu kỳ heartbeat client (ms)" example:"30000"`
	TTLMS               int64   `json:"ttl_ms" description:"Hạn từ heartbeat cuối (ms)" example:"120000"`
	ServerTime          string  `json:"server_time" description:"Giờ server lúc trả lời (RFC3339)" example:"2026-10-15T03:12:00Z"`
}

// DocumentEditLockSummarySDO is who edits a document and until when (R1).
type DocumentEditLockSummarySDO struct {
	LockID           string  `json:"lock_id,omitempty" description:"Chỉ có khi người gọi có quyền manage và không phải người giữ (để điền expected_lock_id khi lấy quyền)" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
	HolderID         string  `json:"holder_id" description:"ULID người giữ" example:"01J8X4USR0N1P2Q3R4S5T6U7"`
	HolderName       string  `json:"holder_name" description:"Tên hiển thị người giữ" example:"Nguyễn Văn A"`
	HolderAvatarURL  *string `json:"holder_avatar_url,omitempty" description:"Avatar người giữ" example:"https://cdn.example.com/a.png"`
	Since            string  `json:"since" description:"Lúc nhiệm kỳ bắt đầu (RFC3339)" example:"2026-10-15T03:12:00Z"`
	ExpiresAt        string  `json:"expires_at" description:"Hạn theo heartbeat (RFC3339)" example:"2026-10-15T03:14:00Z"`
	OfflineHoldUntil *string `json:"offline_hold_until,omitempty" description:"Người giữ giữ quyền sửa offline đến (RFC3339); vắng khi không giữ" example:"2026-10-15T11:12:00Z"`
	Reserved         bool    `json:"reserved" description:"true = khóa đã được nhường, đang chờ người được nhường nhận bằng POST .../edit-lock" example:"false"`
	HeldByMe         bool    `json:"held_by_me" description:"true = chính người gọi giữ (có thể ở tab/thiết bị khác)" example:"false"`
}

// DocumentEditLockStateSDO is GET /api/v1/documents/{documentID}/edit-lock.
type DocumentEditLockStateSDO struct {
	Lock            *DocumentEditLockSummarySDO `json:"lock" description:"Nhiệm kỳ đang sống; null khi không ai giữ"`
	MyRequest       *DocumentEditRequestSDO     `json:"my_request" description:"Yêu cầu đang chờ của người gọi; null khi không có"`
	PendingRequests []DocumentEditRequestSDO    `json:"pending_requests" description:"Yêu cầu đang chờ gửi người gọi; chỉ khi người gọi là người giữ, ngược lại rỗng"`
	CanTakeOver     bool                        `json:"can_take_over" description:"Người gọi có quyền manage và có khóa sống" example:"false"`
	CanRequest      bool                        `json:"can_request" description:"Người gọi có quyền edit, không giữ và chưa có yêu cầu đang chờ" example:"true"`
	ServerTime      string                      `json:"server_time" description:"Giờ server lúc trả lời (RFC3339)" example:"2026-10-15T03:12:00Z"`
}

// DocumentEditHeartbeatSDO is POST .../edit-lock/{lockID}/heartbeat.
type DocumentEditHeartbeatSDO struct {
	LockID           string  `json:"lock_id" description:"ULID nhiệm kỳ" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
	ExpiresAt        string  `json:"expires_at" description:"Hạn mới (RFC3339, giờ server)" example:"2026-10-15T03:16:00Z"`
	OfflineHoldUntil *string `json:"offline_hold_until,omitempty" description:"Hạn giữ offline (RFC3339); vắng khi không giữ" example:"2026-10-15T11:12:00Z"`
	ServerTime       string  `json:"server_time" description:"Giờ server lúc trả lời (RFC3339)" example:"2026-10-15T03:14:00Z"`
}

// DocumentEditRequestSDO is one request for the lock (R8, R9, R1).
type DocumentEditRequestSDO struct {
	RequestID     string  `json:"request_id" description:"ULID yêu cầu" example:"01J8X4REQ0N1P2Q3R4S5T6U7V8"`
	DocumentID    string  `json:"document_id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	RequesterID   string  `json:"requester_id" description:"ULID người yêu cầu" example:"01J8X4USR1N1P2Q3R4S5T6U7"`
	RequesterName string  `json:"requester_name" description:"Tên hiển thị người yêu cầu" example:"Trần Thị B"`
	HolderID      string  `json:"holder_id" description:"ULID người giữ khóa lúc yêu cầu" example:"01J8X4USR0N1P2Q3R4S5T6U7"`
	Status        string  `json:"status" description:"pending | accepted | declined | cancelled | superseded | expired" example:"pending"`
	CreatedAt     string  `json:"created_at" description:"Lúc tạo (RFC3339)" example:"2026-10-15T03:13:00Z"`
	ExpiresAt     string  `json:"expires_at" description:"Hạn yêu cầu (RFC3339)" example:"2026-10-15T03:28:00Z"`
	AnsweredAt    *string `json:"answered_at,omitempty" description:"Lúc trả lời (RFC3339); vắng khi chưa trả lời" example:"2026-10-15T03:14:00Z"`
}
