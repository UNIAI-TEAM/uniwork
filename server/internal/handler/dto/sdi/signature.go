package sdi

// Saved signatures (UNI-925 B6). The path carries the organization; the
// body carries the image the editor drew and the label the person chose.

// CreateSavedSignatureSDI is the body of
// POST /api/v1/orgs/{orgID}/signatures.
type CreateSavedSignatureSDI struct {
	Label       string `json:"label" minLength:"1" description:"Nhãn người dùng đặt cho chữ ký" example:"Chữ ký của tôi"`
	ContentType string `json:"content_type" description:"Định dạng ảnh: image/png hoặc image/jpeg" example:"image/png"`
	Image       string `json:"image" description:"Ảnh chữ ký mã hoá base64 (không kèm tiền tố data:), tối đa 512 KiB sau khi giải mã" example:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="`
}
