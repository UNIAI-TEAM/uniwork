package sdi

// PutOfficeOfflineLeaseSDI is PUT
// /api/v1/documents/{documentID}/office/offline-lease (G5-08s). documentID
// stays a Chi path parameter, and the device is the bearer's session, never
// a body field (contract-p0 §2).
type PutOfficeOfflineLeaseSDI struct {
	Lease string `json:"lease,omitempty" description:"Lease đã ký thiết bị đang giữ, để gia hạn; bỏ trống = cấp mới (hoặc gia hạn lease sống của chính thiết bị trên tài liệu này)" example:"ofl1.eyJ2IjoxfQ.c2lnbmF0dXJl"`
}
