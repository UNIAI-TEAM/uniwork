package sdo

// OfficeAppCapabilitiesSDO is GET /api/v1/orgs/{orgID}/office/capabilities:
// which Office features are enabled for one organization, for the desktop app
// (plan X-03). It is NOT the per-document OfficeCapabilitySDO
// (GET /documents/{documentID}/office/capabilities), which reports formats and
// operations of one document.
//
// Every boolean is the flag evaluated for the caller (user > organization >
// global overrides), and a flag only hides a capability - it never grants
// permission, which stays in the services. ai_uniwork_formats lists the
// formats whose office_ai_uniwork_<format> is on AND whose office_ai_uniwork
// is on; it is empty when UniWork AI is off.
type OfficeAppCapabilitiesSDO struct {
	SyncFeed         bool     `json:"sync_feed" description:"Đọc feed thay đổi của tổ chức (app desktop và thanh S6 trên web)" example:"true"`
	SyncWrite        bool     `json:"sync_write" description:"Dispatch intent lưu mới; tắt là kill switch, queue/nháp/đối soát giữ nguyên" example:"true"`
	OfflineLibrary   bool     `json:"offline_library" description:"Cấp/gia hạn lease offline và ghim tài liệu để dùng khi không có mạng" example:"false"`
	AIUniwork        bool     `json:"ai_uniwork" description:"Kill switch UniWork AI (BYOK không đổi); tắt thì ai_uniwork_formats rỗng" example:"false"`
	AIUniworkFormats []string `json:"ai_uniwork_formats" description:"Định dạng có UniWork AI: office_ai_uniwork_<format> bật VÀ office_ai_uniwork bật; rỗng khi UniWork AI tắt" example:"[\"docx\"]"`
	TTLSeconds       int      `json:"ttl_seconds" description:"App giữ bản này tối đa bao nhiêu giây trước khi đọc lại; quy tắc cache/TTL ở EXPERIENCE > State Patterns > Capability tắt" example:"300"`
}
