package sdi

import "encoding/json"

// SDI types for the Documents HTTP surface (C-01 §5 + §14; UNI-679, G1-05a).
// Routes are registered later with the services; these types pin the wire
// contract. Revision is a decimal string on the wire so a BIGINT revision
// never loses precision in JSON (plan G1-G2 §3.3). Ids are opaque ULIDs.
// The API never accepts acl_owner_id, owner_* or source_* fields: ownership
// and provenance are assigned by the service (C-01 §14.3).

// CreateDocumentSDI is POST /api/v1/workspaces/{workspaceID}/documents
// (+ Idempotency-Key header). It creates a page or a folder; a file document
// is created by CreateDocumentFileSDI on the multipart route.
type CreateDocumentSDI struct {
	Title       string           `json:"title" minLength:"1" description:"Tiêu đề trang (1–500 ký tự) hoặc tên thư mục (1–255 ký tự, không trùng thư mục còn sống cùng cha)" example:"Kế hoạch Q4"`
	Kind        string           `json:"kind" description:"page (mặc định) hoặc folder; file dùng route multipart /documents/files. Thư mục không nhận content" example:"page"`
	ParentID    *string          `json:"parent_id" description:"ULID trang hoặc thư mục cha cùng workspace; thư mục chỉ nằm trong thư mục; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Destination *string          `json:"destination" description:"Đích tạo tắt: my_folder tạo trong Thư mục của tôi (tự khởi tạo nếu chưa có); loại trừ lẫn nhau với parent_id; giá trị khác -> 400 invalid_destination" example:"my_folder"`
	Icon        *string          `json:"icon" description:"Emoji ≤ 8 ký tự" example:"📄"`
	Content     *json.RawMessage `json:"content" description:"ProseMirror JSON {type:\"doc\"}; server sanitize trước khi lưu"`
	Visibility  string           `json:"visibility" description:"restricted (mặc định ở gốc) hoặc workspace; bỏ trống = kế thừa trang cha, ở gốc hoặc trong thư mục = restricted; thư mục với workspace -> 422 folder_not_shareable" example:"restricted"`
}

// CreateDocumentFileSDI documents POST
// /api/v1/workspaces/{workspaceID}/documents/files (multipart +
// Idempotency-Key header, C-01 §14.2): one file document whose bytes stream
// into FileService (purpose document_file, ≤ DOCUMENT_MAX_BYTES (default
// 200 MiB), MIME allowlist).
// The handler reads the file part directly; the type describes the form for
// OpenAPI. Text fields must precede the file part in the multipart body (the
// stream is consumed part-by-part); a title that trails the file falls back
// to the sanitized filename.
type CreateDocumentFileSDI struct {
	Visibility  *string `formData:"visibility" description:"restricted (mặc định ở gốc) hoặc workspace; bỏ trống = kế thừa trang cha, ở gốc hoặc trong thư mục = restricted; giá trị khác -> 400 invalid_request" example:"restricted"`
	File        []byte  `formData:"file" description:"Byte tài liệu; MIME phải trong allowlist document_file và khớp magic bytes"`
	ParentID    *string `formData:"parent_id" description:"ULID trang hoặc thư mục cha cùng workspace; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Destination *string `formData:"destination" description:"Đích tạo tắt: my_folder tạo trong Thư mục của tôi (tự khởi tạo nếu chưa có); loại trừ lẫn nhau với parent_id; giá trị khác -> 400 invalid_destination" example:"my_folder"`
	Title       *string `formData:"title" description:"Tiêu đề hiển thị; mặc định tên tệp" example:"bao-cao-thang-9.pdf"`
}

// PatchDocumentSDI is PATCH /api/v1/documents/{documentID}: autosave and
// metadata edits of the working copy. revision is required and compared
// against the stored revision; a stale base answers 422 revision_conflict
// with fields.current_revision.
type PatchDocumentSDI struct {
	Revision   string           `json:"revision" description:"Revision nền dạng chuỗi thập phân" example:"41"`
	Title      *string          `json:"title" description:"Tiêu đề mới: 1–500 ký tự cho trang/tệp, 1–255 cho thư mục (đổi tên trùng thư mục còn sống cùng cha → 409 folder_name_taken)" example:"Kế hoạch Q4 (bản nháp)"`
	Icon       *string          `json:"icon" description:"Emoji mới; chuỗi rỗng để gỡ icon (bỏ qua = giữ nguyên)" example:"📑"`
	Content    *json.RawMessage `json:"content" description:"ProseMirror JSON mới; server sanitize và rút content_text"`
	Visibility *string          `json:"visibility" description:"workspace hoặc restricted; đổi visibility cần manage; thư mục với workspace -> 422 folder_not_shareable" example:"restricted"`
	// EditLockID gates only a PATCH that carries content; a rename or a
	// visibility change needs no lock (addendum §2, Q5).
	EditLockID string `json:"edit_lock_id,omitempty" description:"lock_id nhiệm kỳ khóa sửa người gọi đang giữ (UNI-1645), chỉ xét khi PATCH có content; bỏ trống = không giữ khóa. Tài liệu đang bị người khác (hoặc tab/thiết bị khác) giữ -> 423 document_locked, trước kiểm revision" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
}

// UploadDocumentFileSDI documents POST /api/v1/documents/{documentID}/uploads
// (multipart, C-01 §14.4): stages the bytes of a candidate file version into
// FileService without creating a version. Committing is a separate call.
type UploadDocumentFileSDI struct {
	File []byte `formData:"file" description:"Byte phiên bản mới; purpose document_file, ≤ DOCUMENT_MAX_BYTES (mặc định 200 MiB), checksum bắt buộc"`
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
	EditLockID   string `json:"edit_lock_id,omitempty" description:"lock_id nhiệm kỳ khóa sửa người gọi đang giữ (UNI-1645); bỏ trống = không giữ khóa. Tài liệu đang bị người khác (hoặc tab/thiết bị khác) giữ -> 423 document_locked, trước kiểm revision" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
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
	EditLockID   string  `json:"edit_lock_id,omitempty" description:"lock_id nhiệm kỳ khóa sửa người gọi đang giữ (UNI-1645); bỏ trống = không giữ khóa. Tài liệu đang bị người khác (hoặc tab/thiết bị khác) giữ -> 423 document_locked, trước kiểm revision" example:"01J8X4LOCK0N1P2Q3R4S5T6U7V"`
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

// CreateDocumentCommentSDI is POST /api/v1/documents/{documentID}/comments
// (+ Idempotency-Key header, G1-07; kind since G8-03): a threaded comment on a
// document. `kind` picks the thread flow - comment (anchored) or discussion
// (the document's shared thread); empty means the parent's kind for a reply
// and discussion for a root. `type` stays on the wire for old clients: it is
// validated against its old allowlist ("comment" or empty) and otherwise
// ignored - it never picks the thread kind.
type CreateDocumentCommentSDI struct {
	Body     string  `json:"body" minLength:"1" description:"Nội dung bình luận" example:"Chỗ này cần số liệu Q3."`
	ParentID *string `json:"parent_id" description:"ULID bình luận cha cùng tài liệu khi trả lời" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	Type     string  `json:"type" description:"Trường cũ: chỉ nhận comment; không quyết định loại luồng" example:"comment"`
	Kind     string  `json:"kind" description:"comment hoặc discussion; bỏ trống = theo cha, gốc là discussion" example:"discussion"`
	// Anchor + BaseVersionID (G8-04): an anchored comment is a root
	// kind=comment whose anchor is written against the version the editor
	// held. The server validates the anchor against the document's format
	// and the version against this tenant + document (400
	// anchor_version_invalid when it does not resolve).
	Anchor        *json.RawMessage `json:"anchor" description:"Neo theo định dạng tài liệu; chỉ gốc kind=comment" example:"{\"format\":\"xlsx\",\"v\":1,\"sheet\":\"S1\",\"range\":\"B7\"}"`
	BaseVersionID *string          `json:"base_version_id" description:"ULID phiên bản editor đang mở hoặc vừa Lưu; bắt buộc khi có neo" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
}

// PutDocumentCommentAnchorsSDI is PUT
// /api/v1/documents/{documentID}/comments/anchors (G8-04): the anchor map
// the editor sends after a save receipt. version_id names the version just
// committed; each item carries the comment's new anchor and the state the
// editor found (exact or lost; the server demotes exact to stale when the
// version is not the head). The call is idempotent by itself - no
// Idempotency-Key - and never moves an anchor back to an older version.
type PutDocumentCommentAnchorsSDI struct {
	VersionID string `json:"version_id" minLength:"1" description:"ULID phiên bản vừa Lưu (receipt)" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	// anchors is capped at 500 items (OQ-C5); the element type is named on
	// purpose so the isolation gate sees DocumentCommentAnchorItemSDI.comment_id.
	Anchors []DocumentCommentAnchorItemSDI `json:"anchors" description:"Neo mới cho từng bình luận, tối đa 500 phần tử; bắt buộc, [] = không cập nhật neo nào" example:"[{\"comment_id\":\"01J8X4CMTN1P2Q3R4S5T6U7V\",\"anchor\":{\"format\":\"xlsx\",\"v\":1,\"sheet\":\"S1\",\"range\":\"B7\"},\"state\":\"exact\"}]"`
	// AnchorsPresent records whether the body carried the anchors key at all:
	// the field is required, so an absent key or a null must be a 400 and only
	// an explicit [] is the empty update (contract 2.6, R1-8). Set by the
	// handler from the raw body before it decodes; never part of the schema.
	AnchorsPresent bool `json:"-"`
}

// DocumentCommentAnchorItemSDI is one anchors[] entry of the PUT: the comment
// to anchor, the new anchor JSON and the state the editor reported.
type DocumentCommentAnchorItemSDI struct {
	CommentID string          `json:"comment_id" minLength:"1" description:"ULID bình luận gốc kind=comment" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	Anchor    json.RawMessage `json:"anchor" description:"Neo mới theo đúng định dạng tài liệu" example:"{\"format\":\"xlsx\",\"v\":1,\"sheet\":\"S1\",\"range\":\"B7\"}"`
	State     string          `json:"state" minLength:"1" description:"exact khi editor tìm thấy vị trí, lost khi không" example:"exact"`
}

// ListDocumentCommentsSDI documents the query params of GET
// /api/v1/documents/{documentID}/comments (G8-03): kind filters the thread
// kind (empty = both), since_token is the list_token of the caller's previous
// full list - equal to the current one the answer is {unchanged: true} and
// carries no rows.
type ListDocumentCommentsSDI struct {
	Kind       *string `query:"kind" description:"comment hoặc discussion; bỏ trống = cả hai" example:"discussion"`
	SinceToken *string `query:"since_token" description:"list_token của lần tải trước; trùng token hiện tại = unchanged" example:"lt1:9f2c1d3e4b5a"`
}

// UpdateDocumentCommentSDI is the body of PATCH
// /api/v1/documents/{documentID}/comments/{commentID}: the new body text of a
// comment the caller wrote or manages.
type UpdateDocumentCommentSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung mới" example:"Đã sửa sau review."`
}

// ReactionSDI is reused from task comments for the document reaction routes
// (POST|DELETE /documents/{documentID}/comments/{commentID}/reactions).
// --- G1-05b (UNI-679, C-01 §5.1/§5.3/§5.4) --------------------------------

// ListDocumentsSDI documents the query params of GET
// /api/v1/workspaces/{workspaceID}/documents (C-01 §5.1). parent_id lists one
// level of the tree in position order; q searches the whole workspace and
// returns a snippet; archived=1 switches to the manage-only trash view. The
// permission filter runs inside the query, so cursor pages stay stable and
// never fetch-then-filter.
type ListDocumentsSDI struct {
	ParentID    *string `query:"parent_id" description:"ULID trang hoặc thư mục cha; bỏ trống = danh sách phẳng toàn workspace, chuỗi rỗng = các tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Query       *string `query:"q" description:"Tìm văn bản đã fold; kết quả kèm snippet ≤ 160 ký tự" example:"kế hoạch quý 4"`
	Match       *string `query:"match" description:"title = chỉ khớp tiêu đề đã fold; bỏ trống = tìm cả nội dung" example:"title"`
	Kind        *string `query:"kind" description:"Lọc page, file, folder hoặc document (mọi loại trừ folder)" example:"page"`
	Format      *string `query:"format" description:"Lọc theo định dạng tệp của phiên bản hiện tại: docx, xlsx, pptx, pdf, md hoặc html (MIME đã xác minh, nếu không có thì theo phần mở rộng tiêu đề). Thư mục luôn nằm trong kết quả, trang không bao giờ khớp; giá trị khác -> 400 invalid_filter; dùng cùng kind=page -> 400 invalid_filter" example:"pdf"`
	Access      *string `query:"access" description:"Lọc theo quyền của người gọi trên dòng: manage (chỉ manage), edit (edit hoặc manage), restricted (visibility=restricted). Áp cho cả thư mục theo cấp của chính nó; giá trị khác -> 400 invalid_filter" example:"edit"`
	Archived    *bool   `query:"archived" description:"1 = thùng rác (chỉ manage); bỏ trống = tài liệu sống. Trên thùng rác chỉ nhận access=restricted: access=manage/edit -> 400 invalid_filter" example:"false"`
	Shelved     *bool   `query:"shelved" description:"1 = kho lưu trữ (mọi người xem được đều thấy mục mình được xem, sắp shelved_at mới nhất trước); kết hợp format/access được; cùng archived=1 -> 400 invalid_filter; mục vừa lưu trữ vừa vào thùng rác chỉ hiện ở thùng rác" example:"true"`
	UpdatedBy   *string `query:"updated_by" description:"Lọc theo ULID người sửa gần nhất" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedFrom *string `query:"updated_from" description:"Mốc updated_at từ (RFC3339)" example:"2026-09-01T00:00:00Z"`
	UpdatedTo   *string `query:"updated_to" description:"Mốc updated_at đến (RFC3339)" example:"2026-09-30T23:59:59Z"`
	SharedByMe  *bool   `query:"shared_by_me" description:"true = chỉ tài liệu sống do người gọi làm ACL owner và đang chia sẻ (share người dùng/nhóm còn hiệu lực hoặc visibility=workspace); dùng cùng parent_id -> 400 invalid_filter" example:"true"`
	Cursor      *string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit       *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"50"`
}

// ListRecentDocumentsSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/recent: the documents the person
// opened or edited recently (access log + updated_by). Only a human has a
// "recent"; an agent gets 403. The recent query never applies q; match ("" or
// "title", else 400) is validated identically to the list route so a shared
// client query string is accepted and ignored.
type ListRecentDocumentsSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit  *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"10"`
	Match  *string `query:"match" description:"Chỉ nhận title (hoặc bỏ trống); recent không lọc theo q nên giá trị hợp lệ được chấp nhận và bỏ qua, giá trị khác -> 400" example:"title"`
	Format *string `query:"format" description:"Lọc theo định dạng tệp của phiên bản hiện tại: docx, xlsx, pptx, pdf, md hoặc html; thư mục luôn nằm trong kết quả, trang không bao giờ khớp; giá trị khác -> 400 invalid_filter" example:"pdf"`
	Access *string `query:"access" description:"Lọc theo quyền của người gọi trên dòng: manage (chỉ manage), edit (edit hoặc manage), restricted (visibility=restricted); giá trị khác -> 400 invalid_filter" example:"manage"`
}

// ListSharedWithMeSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/shared-with-me: the shares the
// caller receives across the organization, walked by keyset server-side so a
// denied candidate never fills a page slot; pages follow the same opaque
// cursor as the other lists.
type ListSharedWithMeSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"eyJ0IjoiMjAyNi0wOS0yOFQxMDowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit  *int32  `query:"limit" description:"Số tài liệu mỗi trang, mặc định 50, tối đa 100" example:"50"`
	Format *string `query:"format" description:"Lọc theo định dạng tệp của phiên bản hiện tại: docx, xlsx, pptx, pdf, md hoặc html; giá trị khác -> 400 invalid_filter" example:"pdf"`
	Access *string `query:"access" description:"Lọc theo quyền người gọi nhận được qua chia sẻ: manage (chỉ manage), edit (edit hoặc manage), restricted (visibility=restricted); giá trị khác -> 400 invalid_filter" example:"edit"`
}

// DocumentTreeSDI documents GET /api/v1/workspaces/{workspaceID}/documents/tree:
// the sidebar forest to the depth bound, metadata only. root names one branch;
// an unreadable root is not found, its children are not leaked through it.
// folders_only cuts the forest to folders for the FOLDERS sidebar: a root that
// is not a folder answers not found there.
type DocumentTreeSDI struct {
	Root        *string `query:"root" description:"ULID gốc nhánh; bỏ trống = cả rừng tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	FoldersOnly *bool   `query:"folders_only" description:"true/1 = chỉ node thư mục (kind=folder), bỏ trang và tệp; bỏ trống hoặc false/0 = cả cây" example:"true"`
}

// MoveDocumentSDI is POST /api/v1/documents/{documentID}/move (C-01 §5.1):
// re-parent/reorder one document. position is a fractional sibling index;
// absent appends last. parent_id null (or absent) moves to the workspace root.
// A stale revision, a cycle, a depth past five or a foreign parent is refused.
type MoveDocumentSDI struct {
	ParentID *string  `json:"parent_id" description:"ULID trang hoặc thư mục cha mới cùng workspace (thư mục chỉ vào thư mục); null = về gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Position *float64 `json:"position" description:"Thứ tự giữa các sibling; bỏ trống = cuối danh sách" example:"1.5"`
	Revision string   `json:"revision" description:"Revision nền dạng chuỗi thập phân" example:"41"`
}

// ShareDocumentSDI is POST /api/v1/documents/{documentID}/shares (C-01 §5.3).
// A principal must belong to the document's organization; an existing live
// grant for the same principal is revoked and replaced in one transaction.
// A grant whose principal is the document's own workspace is written on its
// home row instead (SH-S1): no document_shares row, at most the edit level.
type ShareDocumentSDI struct {
	PrincipalType string `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID   string `json:"principal_id" description:"ULID người/workspace, hoặc ULID tổ chức khi principal_type=organization" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level         string `json:"level" description:"view, comment, edit hoặc manage (manage không nhận cho workspace chứa tài liệu và organization -> 422 level_not_allowed)" example:"view"`
}

// BreakGlassSDI is POST /api/v1/documents/{documentID}/break-glass: a workspace
// admin opens 24-hour view-only access to a restricted document they do not
// own (DOC-05; UNI-1628). The reason is trimmed, then 10-500 characters.
type BreakGlassSDI struct {
	Reason string `json:"reason" description:"Lý do mở truy cập khẩn cấp, 10–500 ký tự sau khi cắt khoảng trắng hai đầu" example:"Kiểm tra hợp đồng theo yêu cầu của kiểm toán"`
}

// ShareDocumentBatchSDI is POST /api/v1/documents/{documentID}/shares/batch:
// users only (workspace/organization stay single-select on POST /shares).
type ShareDocumentBatchSDI struct {
	PrincipalIDs []string `json:"principal_ids" description:"ULID người dùng cùng tổ chức với tài liệu; tối đa 50 id phân biệt sau khi cắt khoảng trắng và gộp trùng lặp" example:"[\"01J8X4K2M0N1P2Q3R4S5T6U7V8\",\"01J8X4K2M0N1P2Q3R4S5T6U7V9\"]"`
	Level        string   `json:"level" description:"Cấp quyền, cùng tập giá trị với POST /shares" example:"view"`
}

// UpdateDocumentAccessSDI is PUT /api/v1/documents/{documentID}/access (SH-S2,
// UNI-1781): batch grant/update/revoke/keep across users, workspaces and the
// organization, with optional dry_run preview.
type UpdateDocumentAccessSDI struct {
	Items  []DocumentAccessItemSDI `json:"items" description:"1–100 mục phân quyền; trùng (principal_type, principal_id) -> 422 document_access_rejected"`
	DryRun bool                    `json:"dry_run,omitempty" description:"true = chỉ tính preview và kết quả dự kiến, không ghi DB" example:"false"`
}

// DocumentAccessItemSDI is one principal change in UpdateDocumentAccessSDI;
// the element type is named on purpose so the isolation reference scanner sees
// DocumentAccessItemSDI.principal_id. level is required on the wire: an absent
// key is a 400 (R1-10), an explicit null is the revoke.
type DocumentAccessItemSDI struct {
	PrincipalType string  `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID   string  `json:"principal_id" description:"ULID người dùng, workspace hoặc tổ chức" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level         *string `json:"level" description:"Bắt buộc: view, comment, edit, manage, hoặc null để thu hồi grant trực tiếp hiện tại (dòng Workspace gốc: tắt về restricted); thiếu khóa -> 400" example:"edit"`
	OnExisting    string  `json:"on_existing,omitempty" description:"update (mặc định) hoặc keep (giữ nguyên grant đang có)" example:"update"`
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

// ListMentionCandidatesSDI documents the query params of GET
// /api/v1/documents/{documentID}/mention-candidates (G8-06): the mention
// picker's people. `q` is folded and matched against the display name and the
// email, so "nguyen" finds "Nguyễn"; `limit` clamps to the default 20 and the
// cap 50.
type ListMentionCandidatesSDI struct {
	Query *string `query:"q" description:"Từ khóa tìm theo tên hiển thị và email (gấp dấu); bỏ trống = mọi người đọc được" example:"nguyen"`
	Limit *int32  `query:"limit" description:"Kích thước trang, mặc định 20, tối đa 50; ngoài khoảng bị kẹp" example:"20"`
	// Include is honoured only for a caller who may list the workspace's members.
	Include *string `query:"include" description:"no_access = thêm cả người chưa xem được tài liệu, mỗi dòng có can_view (G8-18); chỉ có hiệu lực khi người gọi xem được danh sách thành viên workspace, ngược lại bị bỏ qua" example:"no_access"`
}

// ListDocumentShareCandidatesSDI documents GET
// /api/v1/documents/{documentID}/share-candidates (SH-S2, UNI-1781).
type ListDocumentShareCandidatesSDI struct {
	Q      *string `query:"q" description:"Từ khóa tìm theo tên, email và slug (gấp dấu uw_fold_search)" example:"nguyen"`
	Cursor *string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"bmd1eWVuAHVzZXIAMDFKOA"`
	Limit  *int32  `query:"limit" description:"Kích thước trang, mặc định 20, tối đa 50" example:"20"`
}

// UploadSessionProbeSDI is the client's probe of the file it is about to
// upload in parts (addendum §6.2): the first 64 KiB and, for a zip container,
// the central directory, base64. The server checks the declared size of the
// central directory against the decoded bytes and runs the same detector and
// zip rules the single-request route runs, so an unsupported file is refused
// before any part is signed.
type UploadSessionProbeSDI struct {
	HeadB64       string `json:"head_b64" description:"Base64 của tối đa 65536 byte đầu tệp (byte đã giải mã, không phải ký tự base64)" example:"UEsDBBQAAAAIAA=="`
	CentralDirB64 string `json:"central_dir_b64" description:"Base64 của central directory + EOCD (và ZIP64 locator nếu có); rỗng khi tệp không phải zip" example:""`
	CDOffset      int64  `json:"cd_offset" description:"Offset byte của central directory trong tệp; 0 khi không phải zip" example:"83820000"`
	CDSize        int64  `json:"cd_size" description:"Độ dài byte của central_dir_b64 sau khi giải mã, tối đa 1 MiB; 0 khi không phải zip" example:"66080"`
}

// CreateUploadSessionSDI is the body of the three create routes of the large
// upload flow (addendum §6.1/§6.2): POST
// /api/v1/workspaces/{workspaceID}/documents/upload-sessions,
// POST /api/v1/documents/{documentID}/upload-sessions and POST
// /api/v1/office-frame/documents/{documentID}/upload-sessions. The parent
// (workspace or document) rides on the path, never in the body; parent_id,
// title and visibility are the workspace route's alone. size_bytes must be
// above the single-request threshold (20 MiB) and within the document cap;
// the Idempotency-Key header binds the request to its payload fingerprint.
type CreateUploadSessionSDI struct {
	Filename   string                `json:"filename" description:"Tên tệp; đuôi tệp phải nằm trong allowlist document_file và khớp nội dung probe" example:"Bao-cao-quy-4.docx"`
	SizeBytes  int64                 `json:"size_bytes" description:"Kích thước khai báo của tệp (byte); ≤ 20 MiB -> 422 upload_session_too_small, trên upload_max_bytes -> 413 file_too_large" example:"83886080"`
	ParentID   *string               `json:"parent_id" description:"ULID trang hoặc thư mục cha cùng workspace (chỉ route workspace); bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title      *string               `json:"title" description:"Tiêu đề tài liệu sẽ tạo (chỉ route workspace); mặc định tên tệp đã làm sạch" example:"Báo cáo quý 4"`
	Visibility *string               `json:"visibility" description:"restricted hoặc workspace (chỉ route workspace); bỏ trống = kế thừa trang cha, ở gốc hoặc trong thư mục = restricted" example:"restricted"`
	Probe      UploadSessionProbeSDI `json:"probe" description:"Probe đầu tệp và central directory để kiểm định dạng trước khi ký URL phần"`
}

// CompleteUploadSessionSDI is the body of POST .../upload-sessions/{sessionID}/complete
// (addendum §6.4): every part the client uploaded, in any order. The server
// compares the list with the storage's own ListParts; a missing part, a wrong
// number or an ETag that does not match answers 422 upload_parts_invalid and
// leaves the session open.
type CompleteUploadSessionSDI struct {
	Parts []UploadSessionPartSDI `json:"parts" description:"Danh sách phần đã PUT lên URL đã ký; đủ total_parts phần và ETag phải khớp storage" example:"[{\"part_number\":1,\"etag\":\"\\\"3858f62230ac3c915f300c664312c63f\\\"\"}]"`
}

// UploadSessionPartSDI is one part as the client uploaded it.
type UploadSessionPartSDI struct {
	PartNumber int    `json:"part_number" description:"Số thứ tự phần, 1..total_parts" example:"1"`
	ETag       string `json:"etag" description:"ETag S3 trả về ở header ETag của PUT phần, kể cả dấu ngoặc kép" example:"\"3858f62230ac3c915f300c664312c63f\""`
}
