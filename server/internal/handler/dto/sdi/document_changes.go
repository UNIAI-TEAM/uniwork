package sdi

// ListDocumentChangesSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/changes (G5-01a): the Office
// change feed. No cursor opens a snapshot (cold start); every page hands out
// the next opaque cursor.
type ListDocumentChangesSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước, opaque và có ký; bỏ trống = mở snapshot mới (cold start)" example:"dcc1.eyJwIjoib2ZmaWNlLWNoYW5nZS1mZWVkLzEifQ.c2lnbmF0dXJl"`
	Limit  *int32  `query:"limit" description:"Số tài liệu mỗi trang, mặc định 200, tối đa 500 (lớn hơn bị kẹp về 500)" example:"200"`
}
