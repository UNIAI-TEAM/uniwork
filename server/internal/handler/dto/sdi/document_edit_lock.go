package sdi

// Document edit lock (UNI-1645, addendum 2026-10-15 §3). documentID, lockID
// and requestID stay Chi path parameters; the login session that holds a
// tenure is the bearer's own (sid), never a body field.

// AcquireDocumentEditLockSDI is POST
// /api/v1/documents/{documentID}/edit-lock: take the free lock, claim a
// handed-over one, or move the caller's own tenure here ("Edit here").
type AcquireDocumentEditLockSDI struct {
	EditorID     string `json:"editor_id" description:"ULID do client sinh mỗi lần mở editor; cùng người + cùng editor_id -> 200 (idempotent)" example:"01J8X4ED1T0R0000000000000A"`
	Client       string `json:"client" description:"web_page | web_office | desktop" example:"web_page"`
	MoveFromSelf bool   `json:"move_from_self,omitempty" description:"true = chuyển khóa người gọi đang giữ ở tab/thiết bị khác về editor này (Sửa ở đây); chỉ hợp lệ khi chính người gọi đang giữ" example:"false"`
}

// TakeOverDocumentEditLockSDI is POST
// /api/v1/documents/{documentID}/edit-lock/take-over: a manager ends the
// live tenure and holds the lock. expected_lock_id is the tenure the
// confirmation dialog showed; another one answers 409 edit_lock_changed.
type TakeOverDocumentEditLockSDI struct {
	EditorID       string `json:"editor_id" description:"ULID do client sinh cho editor sẽ giữ khóa" example:"01J8X4ED1T0R0000000000000A"`
	Client         string `json:"client" description:"web_page | web_office | desktop" example:"web_page"`
	ExpectedLockID string `json:"expected_lock_id" description:"lock_id nhiệm kỳ đang sống mà hộp xác nhận đã đọc từ GET .../edit-lock; khác -> 409 edit_lock_changed" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
}

// PutDocumentEditHoldSDI is PUT
// /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold: start or
// renew the offline hold of the caller's tenure from a desktop device
// session. The body is an empty object; the device is the bearer's session.
type PutDocumentEditHoldSDI struct{}

// CreateDocumentEditRequestSDI is POST
// /api/v1/documents/{documentID}/edit-requests: ask the holder for the lock.
// The body is an empty object.
type CreateDocumentEditRequestSDI struct{}

// AnswerDocumentEditRequestSDI is POST
// /api/v1/documents/{documentID}/edit-requests/{requestID}/answer: the
// holder accepts (hands the lock over) or declines a request.
type AnswerDocumentEditRequestSDI struct {
	Decision string `json:"decision" description:"accept | decline" example:"accept"`
	LockID   string `json:"lock_id" description:"lock_id nhiệm kỳ người trả lời đang giữ; khác nhiệm kỳ của yêu cầu -> 409 edit_lock_changed" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
}
