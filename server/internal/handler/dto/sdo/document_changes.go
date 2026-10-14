package sdo

// DocumentChangeSDO is one snapshot change-feed row: ids, kind, revision and
// the version pointer only - never a title, path or content (spec §4.1).
// Revision is a decimal string on the wire like every other document SDO, so
// a BIGINT revision never loses precision in JSON (spec §3 invariant 2).
type DocumentChangeSDO struct {
	DocumentID     string  `json:"document_id" description:"Id tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7V8"`
	Kind           string  `json:"kind" description:"Loại tài liệu: page, file hoặc folder" example:"file"`
	Revision       string  `json:"revision" description:"Revision làm việc tại high-water mark của snapshot, chuỗi thập phân" example:"41"`
	CurrentVersion int32   `json:"current_version" description:"Số thứ tự phiên bản mới nhất" example:"3"`
	VersionID      *string `json:"version_id" description:"Id bản ghi phiên bản đang là head (file); null với page/folder" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
}

// DocumentChangeFeedSDO is one incremental-feed row (G5-01b): the same ids,
// revision and version pointer as a snapshot row, plus the change kind and, on
// a removal, the ids-only reason. A removal carries no name, no path and no
// metadata (spec §4.1). Every field is always present: on a removal `kind` is
// empty, `version_id` is null, `current_version` is zero and `revision` is the
// last revision the caller saw (zero on a hard-delete tombstone, whose row is
// gone and has none); on an upsert `removal` is empty.
type DocumentChangeFeedSDO struct {
	DocumentID     string  `json:"document_id" description:"Id tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7V8"`
	ChangeKind     string  `json:"change_kind" description:"Loại thay đổi: upsert hoặc removal" example:"upsert"`
	Kind           string  `json:"kind" description:"Loại tài liệu khi upsert: page, file hoặc folder; rỗng khi removal" example:"file"`
	Revision       string  `json:"revision" description:"Revision hiện tại, chuỗi thập phân; 0 khi tombstone bị xoá cứng" example:"42"`
	CurrentVersion int32   `json:"current_version" description:"Số thứ tự phiên bản mới nhất khi upsert; 0 khi removal" example:"3"`
	VersionID      *string `json:"version_id" description:"Id bản ghi phiên bản đang là head (file); null với page/folder và mọi removal" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	Archived       bool    `json:"archived" description:"true khi tài liệu đang được lưu trữ (upsert); archive/restore khác delete" example:"false"`
	Removal        string  `json:"removal" description:"Lý do removal: permission_revoked hoặc moved_workspace; rỗng khi upsert. document_deleted vẫn nằm trong enum cho tương lai nhưng feed hiện không gửi: một purge trả 410 change_cursor_expired (client resync)" example:"permission_revoked"`
}

// DocumentChangeListSDO is one page of GET
// /api/v1/workspaces/{workspaceID}/documents/changes. next_cursor is always
// present: a snapshot cursor while has_more, then on the last snapshot page
// the feed cursor carrying the snapshot's high-water mark. A snapshot page
// fills `changes`; an incremental feed page (G5-01b) fills `feed` and leaves
// `changes` empty. An expired cursor answers 410 change_cursor_expired, never
// a short page.
type DocumentChangeListSDO struct {
	Phase      string                  `json:"phase" description:"Pha của trang: snapshot (cold start) hoặc feed (tăng dần)" example:"snapshot"`
	Changes    []DocumentChangeSDO     `json:"changes" description:"Các dòng snapshot (phase snapshot); rỗng ở trang feed"`
	Feed       []DocumentChangeFeedSDO `json:"feed" description:"Các dòng feed tăng dần (phase feed); rỗng ở trang snapshot"`
	HasMore    bool                    `json:"has_more" description:"Còn trang sau; false ở trang cuối. Trang feed chỉ true khi nó đã tiến cursor (gửi hoặc bỏ qua ít nhất một dòng) VÀ còn dòng hợp lệ: một trang bị giữ lại toàn bộ bởi guard giao dịch đang chạy trả false với vị trí cursor không đổi - keyset (AfterXact/AfterID) giữ nguyên, token có thể được ký lại với hạn mới (client hỏi lại sau)" example:"true"`
	NextCursor string                  `json:"next_cursor" description:"Cursor kế tiếp, opaque; ở trang cuối snapshot là cursor feed mang high-water mark" example:"dcc1.eyJwIjoib2ZmaWNlLWNoYW5nZS1mZWVkLzEifQ.c2lnbmF0dXJl"`
	ExpiresAt  string                  `json:"expires_at" description:"Hạn của next_cursor; quá hạn -> 410 change_cursor_expired" example:"2026-10-13T10:15:00Z"`
}
