package sdi

import "encoding/json"

// SDI types for the Documents HTTP surface (C-01 §5 + §14; UNI-679, G1-05a).
// Routes are registered later with the services; these types pin the wire
// contract. Revision is a decimal string on the wire so a BIGINT revision
// never loses precision in JSON (plan G1-G2 §3.3). Ids are opaque ULIDs.
// The API never accepts acl_owner_id, owner_* or source_* fields: ownership
// and provenance are assigned by the service (C-01 §14.3).

// CreateDocumentSDI is POST /api/v1/workspaces/{workspaceID}/documents
// (+ Idempotency-Key header). It creates a page; a file document is created
// by CreateDocumentFileSDI on the multipart route.
type CreateDocumentSDI struct {
	Title      string           `json:"title" minLength:"1" description:"Tiêu đề trang, 1–500 ký tự" example:"Kế hoạch Q4"`
	Kind       string           `json:"kind" description:"Chỉ page với endpoint này; file dùng route multipart /documents/files" example:"page"`
	ParentID   *string          `json:"parent_id" description:"ULID trang cha cùng workspace; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Icon       *string          `json:"icon" description:"Emoji ≤ 8 ký tự" example:"📄"`
	Content    *json.RawMessage `json:"content" description:"ProseMirror JSON {type:\"doc\"}; server sanitize trước khi lưu"`
	Visibility string           `json:"visibility" description:"workspace (mặc định) hoặc restricted" example:"workspace"`
}

// CreateDocumentFileSDI documents POST
// /api/v1/workspaces/{workspaceID}/documents/files (multipart +
// Idempotency-Key header, C-01 §14.2): one file document whose bytes stream
// into FileService (purpose document_file, ≤ 50 MiB, MIME allowlist).
// The handler reads the file part directly; the type describes the form for
// OpenAPI. Text fields must precede the file part in the multipart body (the
// stream is consumed part-by-part); a title that trails the file falls back
// to the sanitized filename.
type CreateDocumentFileSDI struct {
	File     []byte  `formData:"file" description:"Byte tài liệu; MIME phải trong allowlist document_file và khớp magic bytes"`
	ParentID *string `formData:"parent_id" description:"ULID trang cha cùng workspace; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title    *string `formData:"title" description:"Tiêu đề hiển thị; mặc định tên tệp" example:"bao-cao-thang-9.pdf"`
}

// PatchDocumentSDI is PATCH /api/v1/documents/{documentID}: autosave and
// metadata edits of the working copy. revision is required and compared
// against the stored revision; a stale base answers 422 revision_conflict
// with fields.current_revision.
type PatchDocumentSDI struct {
	Revision   string           `json:"revision" description:"Revision nền dạng chuỗi thập phân" example:"41"`
	Title      *string          `json:"title" description:"Tiêu đề mới, 1–500 ký tự" example:"Kế hoạch Q4 (bản nháp)"`
	Icon       *string          `json:"icon" description:"Emoji mới; chuỗi rỗng để gỡ icon (bỏ qua = giữ nguyên)" example:"📑"`
	Content    *json.RawMessage `json:"content" description:"ProseMirror JSON mới; server sanitize và rút content_text"`
	Visibility *string          `json:"visibility" description:"workspace hoặc restricted; đổi visibility cần manage" example:"restricted"`
}

// UploadDocumentFileSDI documents POST /api/v1/documents/{documentID}/uploads
// (multipart, C-01 §14.4): stages the bytes of a candidate file version into
// FileService without creating a version. Committing is a separate call.
type UploadDocumentFileSDI struct {
	File []byte `formData:"file" description:"Byte phiên bản mới; purpose document_file, ≤ 50 MiB, checksum bắt buộc"`
}

// CommitDocumentVersionSDI is POST
// /api/v1/documents/{documentID}/versions/commit (+ Idempotency-Key header,
// C-01 §14.4, DOC-005 §3): turns a staged upload into the document's new live
// file version. Checks run in DOC-005 order: session → tombstone →
// idempotency (with payload fingerprint) → permission → engine → base →
// quota; a stale base_revision answers 409 document_version_conflict.
type CommitDocumentVersionSDI struct {
	UploadID     string `json:"upload_id" description:"upload_id (= file_id FileService) do POST .../uploads hoặc RegisterProviderOutput cấp" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	BaseRevision string `json:"base_revision" description:"Revision nền dạng chuỗi thập phân; lệch → document_version_conflict" example:"41"`
}

// CreateDocumentVersionSDI is POST /api/v1/documents/{documentID}/versions:
// a named manual checkpoint of the working copy. If the working copy has not
// changed since the newest version the answer is 409
// document_version_unchanged.
type CreateDocumentVersionSDI struct {
	Label *string `json:"label" description:"Nhãn mốc phiên bản, ≤ 200 ký tự" example:"Bản gửi khách hàng"`
}

// RestoreDocumentVersionSDI is the optional body of POST
// /api/v1/documents/{documentID}/versions/{versionNo}/restore. The contract
// declares no request: a page restore carries nothing and restores over the
// live revision. A file restore must still name the base revision the writer
// saw (the service checks it unconditionally for files), so the carrier is an
// optional JSON body - absent or empty keeps the page behaviour.
type RestoreDocumentVersionSDI struct {
	BaseRevision *string `json:"base_revision" description:"Revision nền dạng chuỗi thập phân; bắt buộc cho file document, lệch → document_version_conflict" example:"41"`
}

// UploadDocumentAssetSDI documents POST /api/v1/documents/{documentID}/assets
// (multipart, C-01 §5.4): an image a page embeds via asset://{id}.
type UploadDocumentAssetSDI struct {
	File []byte `formData:"file" description:"Ảnh ≤ 10 MiB; MIME trong allowlist document_asset (png, jpeg, gif, webp)"`
}

// ListDocumentVersionsSDI documents the query params of GET
// /api/v1/documents/{documentID}/versions.
type ListDocumentVersionsSDI struct {
	Cursor string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"eyJ2IjozfQ"`
	Limit  int32  `query:"limit" description:"Kích thước trang, mặc định 50" example:"50"`
}

// DownloadDocumentSDI documents the query params of GET
// /api/v1/documents/{documentID}/download. Without meta the route streams the
// bytes of the live file version (HEAD/Range); meta=1 answers the JSON
// descriptor DocumentDownloadSDO instead.
type DownloadDocumentSDI struct {
	Version *int32 `query:"version" description:"Số phiên bản file cần tải; bỏ trống = bản hiện hành" example:"2"`
	Meta    *bool  `query:"meta" description:"1 = trả descriptor JSON thay vì stream byte" example:"true"`
}

// --- G1-05b (UNI-679, C-01 §5.1/§5.3/§5.4) --------------------------------

// ListDocumentsSDI documents the query params of GET
// /api/v1/workspaces/{workspaceID}/documents (C-01 §5.1). parent_id lists one
// level of the tree in position order; q searches the whole workspace and
// returns a snippet; archived=1 switches to the manage-only trash view. The
// permission filter runs inside the query, so cursor pages stay stable and
// never fetch-then-filter.
type ListDocumentsSDI struct {
	ParentID    *string `query:"parent_id" description:"ULID trang cha; bỏ trống = danh sách phẳng toàn workspace, chuỗi rỗng = các tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Query       *string `query:"q" description:"Tìm văn bản đã fold; kết quả kèm snippet ≤ 160 ký tự" example:"kế hoạch quý 4"`
	Kind        *string `query:"kind" description:"Lọc page hoặc file" example:"page"`
	Archived    *bool   `query:"archived" description:"1 = thùng rác (chỉ manage); bỏ trống = tài liệu sống" example:"false"`
	UpdatedBy   *string `query:"updated_by" description:"Lọc theo ULID người sửa gần nhất" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedFrom *string `query:"updated_from" description:"Mốc updated_at từ (RFC3339)" example:"2026-09-01T00:00:00Z"`
	UpdatedTo   *string `query:"updated_to" description:"Mốc updated_at đến (RFC3339)" example:"2026-09-30T23:59:59Z"`
	Cursor      *string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit       *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"50"`
}

// ListRecentDocumentsSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/recent: the documents the person
// opened or edited recently (access log + updated_by). Only a human has a
// "recent"; an agent gets 403.
type ListRecentDocumentsSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit  *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"10"`
}

// DocumentTreeSDI documents GET /api/v1/workspaces/{workspaceID}/documents/tree:
// the sidebar forest to five levels, metadata only. root names one branch; an
// unreadable root is not found, its children are not leaked through it.
type DocumentTreeSDI struct {
	Root *string `query:"root" description:"ULID gốc nhánh; bỏ trống = cả rừng tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
}

// MoveDocumentSDI is POST /api/v1/documents/{documentID}/move (C-01 §5.1):
// re-parent/reorder one document. position is a fractional sibling index;
// absent appends last. parent_id null (or absent) moves to the workspace root.
// A stale revision, a cycle, a depth past five or a foreign parent is refused.
type MoveDocumentSDI struct {
	ParentID *string  `json:"parent_id" description:"ULID trang cha mới cùng workspace; null = về gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Position *float64 `json:"position" description:"Thứ tự giữa các sibling; bỏ trống = cuối danh sách" example:"1.5"`
	Revision string   `json:"revision" description:"Revision nền dạng chuỗi thập phân" example:"41"`
}

// ShareDocumentSDI is POST /api/v1/documents/{documentID}/shares (C-01 §5.3).
// A principal must belong to the document's organization; an existing live
// grant for the same principal is revoked and replaced in one transaction.
type ShareDocumentSDI struct {
	PrincipalType string `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID   string `json:"principal_id" description:"ULID người/workspace, hoặc ULID tổ chức khi principal_type=organization" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level         string `json:"level" description:"view, edit hoặc manage" example:"view"`
}

// CreateDocumentLinkSDI is POST /api/v1/documents/{documentID}/links:
// an anonymous view link. Requires the documents.public_links entitlement and
// the organization switch; at most five live links per document.
type CreateDocumentLinkSDI struct {
	ExpiresInDays *int `json:"expires_in_days" description:"Số ngày hiệu lực 1–90; bỏ trống = 7" example:"7"`
}

// ListDocumentAccessLogsSDI documents GET
// /api/v1/documents/{documentID}/access-logs (C-01 §5.4, manage only):
// newest first, actor kinds human/agent/anonymous, optional action filter.
type ListDocumentAccessLogsSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoifQ"`
	Limit  *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"50"`
	Action *string `query:"action" description:"view, download, export hoặc link_view; bỏ trống = mọi hành động" example:"view"`
}

// SetDocumentSettingsSDI is PUT /api/v1/orgs/{orgID}/documents/settings:
// the organization switch for public links. Turning it off closes every live
// link on its next read without revoking it.
type SetDocumentSettingsSDI struct {
	PublicLinksEnabled bool `json:"public_links_enabled" description:"Bật/tắt liên kết công khai cho tổ chức" example:"true"`
}
