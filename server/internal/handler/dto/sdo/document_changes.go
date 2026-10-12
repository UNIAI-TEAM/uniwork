package sdo

// DocumentChangeSDO is one change-feed row: ids, kind, revision and the
// version pointer only - never a title, path or content (spec §4.1).
type DocumentChangeSDO struct {
	DocumentID     string  `json:"document_id" description:"Id tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7V8"`
	Kind           string  `json:"kind" description:"Loại tài liệu: page, file hoặc folder" example:"file"`
	Revision       int64   `json:"revision" description:"Revision của tài liệu tại high-water mark của snapshot" example:"7"`
	CurrentVersion int32   `json:"current_version" description:"Số thứ tự phiên bản mới nhất" example:"3"`
	VersionID      *string `json:"version_id" description:"Id bản ghi phiên bản đang là head (file); null với page/folder" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
}

// DocumentChangeListSDO is one page of GET
// /api/v1/workspaces/{workspaceID}/documents/changes. next_cursor is always
// present: a snapshot cursor while has_more, then on the last snapshot page
// the feed cursor carrying the snapshot's high-water mark (G5-01b continues
// from it). An expired cursor answers 410 change_cursor_expired, never a
// short page.
type DocumentChangeListSDO struct {
	Phase      string              `json:"phase" description:"Pha của trang: snapshot (cold start)" example:"snapshot"`
	Changes    []DocumentChangeSDO `json:"changes"`
	HasMore    bool                `json:"has_more" description:"Còn trang snapshot sau; false ở trang cuối" example:"true"`
	NextCursor string              `json:"next_cursor" description:"Cursor kế tiếp, opaque; ở trang cuối là cursor feed mang high-water mark" example:"dcc1.eyJwIjoib2ZmaWNlLWNoYW5nZS1mZWVkLzEifQ.c2lnbmF0dXJl"`
	ExpiresAt  string              `json:"expires_at" description:"Hạn của next_cursor; quá hạn -> 410 change_cursor_expired" example:"2026-10-13T10:15:00Z"`
}
