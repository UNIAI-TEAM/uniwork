package sdo

// OfficeOfflineLeaseSDO is a granted or renewed offline lease (G5-08s,
// decision G5-D1 row 3): the signed lease the desktop app keeps in the OS
// keystore plus the plain values it shows. Ids, levels and times only: no
// title, path or byte of the document.
type OfficeOfflineLeaseSDO struct {
	Lease          string `json:"lease" description:"Lease đã ký (HMAC), app giữ trong kho khóa hệ điều hành và gửi lại khi gia hạn" example:"ofl1.eyJ2IjoxfQ.c2lnbmF0dXJl"`
	LeaseID        string `json:"lease_id" description:"ULID lease" example:"01J8X4LEASE1P2Q3R4S5T6U7V8"`
	DocumentID     string `json:"document_id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID string `json:"organization_id" description:"ULID tổ chức của tài liệu" example:"01J8X4ORG0N1P2Q3R4S5T6U7"`
	WorkspaceID    string `json:"workspace_id" description:"ULID workspace của tài liệu" example:"01J8X4WS00N1P2Q3R4S5T6U7"`
	VersionID      string `json:"version_id" description:"ULID version (snapshot) lease phủ: bản head lúc cấp/gia hạn" example:"01J8X4VER0N1P2Q3R4S5T6U7"`
	Version        int32  `json:"version" description:"Số thứ tự version lease phủ" example:"3"`
	Revision       string `json:"revision" description:"Revision tài liệu lúc cấp/gia hạn (chuỗi thập phân)" example:"12"`
	Level          string `json:"level" description:"Quyền offline: view hoặc edit (manage hạ xuống edit)" example:"edit"`
	PolicyEpoch    int64  `json:"policy_epoch" description:"Policy epoch của tổ chức lúc cấp" example:"0"`
	Generation     int32  `json:"generation" description:"Lần gia hạn của lease, tăng 1 mỗi lần" example:"1"`
	Renewed        bool   `json:"renewed" description:"true = gia hạn lease sẵn có (cùng lease_id); false = cấp mới" example:"false"`
	IssuedAt       string `json:"issued_at" description:"Giờ server cấp/gia hạn (RFC3339)" example:"2026-10-13T08:00:00Z"`
	ExpiresAt      string `json:"expires_at" description:"Hạn lease theo giờ server (RFC3339), tối đa 24 giờ và không quá hạn phiên thiết bị" example:"2026-10-14T08:00:00Z"`
	RenewAfter     string `json:"renew_after" description:"Mốc nên gia hạn khi online (nửa thời hạn, RFC3339)" example:"2026-10-13T20:00:00Z"`
	ServerTime     string `json:"server_time" description:"Giờ server lúc trả lời (RFC3339); app neo đồng hồ đơn điệu vào mốc này" example:"2026-10-13T08:00:00Z"`
}
