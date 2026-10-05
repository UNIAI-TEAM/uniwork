package sdo

// Saved signatures (UNI-925 B6): the caller's own reusable signature
// images. `image` travels with every row because the picker draws one
// thumbnail per signature and there is no read-one route.

// SavedSignatureDTO is one saved signature of the caller.
type SavedSignatureDTO struct {
	ID          string `json:"id" description:"ULID chữ ký đã lưu" example:"01K6SIGN1P2Q3R4S5T6U7V8YA"`
	Label       string `json:"label" description:"Nhãn người dùng đặt" example:"Chữ ký của tôi"`
	ContentType string `json:"content_type" description:"image/png hoặc image/jpeg" example:"image/png"`
	Image       string `json:"image" description:"Ảnh mã hoá base64, không kèm tiền tố data:" example:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="`
	ByteSize    int    `json:"byte_size" description:"Số byte ảnh sau khi giải mã" example:"2048"`
	CreatedAt   string `json:"created_at" description:"Thời điểm lưu (RFC 3339)" example:"2026-10-03T08:00:00Z"`
}

// SavedSignatureSDO is the create answer: the row as it was stored.
type SavedSignatureSDO struct {
	Signature SavedSignatureDTO `json:"signature"`
}

// SavedSignatureListSDO is GET /api/v1/orgs/{orgID}/signatures: every
// signature of the caller in that organization, newest first.
type SavedSignatureListSDO struct {
	Signatures []SavedSignatureDTO `json:"signatures"`
}
