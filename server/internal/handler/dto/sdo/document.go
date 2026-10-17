package sdo

import "encoding/json"

// SDO types for the Documents HTTP surface (C-01 §5 + §14; UNI-679, G1-05a).
// Revision is a decimal string on the wire so a BIGINT revision never loses
// precision in JSON (plan G1-G2 §3.3); version ordinals stay numbers because
// they are display ordinals, not identity. Ids are opaque ULIDs.

// DocumentDTO is one document on the wire. `content` is present only for a
// page and only where the endpoint returns the working copy (detail, patch,
// restore); `file` is present only for kind=file. `my_level`/`via` describe
// the caller's effective access (C-01 §4) and ride along on every document
// payload the actor may open.
type DocumentDTO struct {
	ID                  string                  `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID      string                  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID         string                  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ParentID            *string                 `json:"parent_id,omitempty" description:"ULID trang hoặc thư mục cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Kind                string                  `json:"kind" description:"page, file hoặc folder" example:"page"`
	SystemKind          *string                 `json:"system_kind,omitempty" description:"my_folder khi là Thư mục của tôi; vắng mặt với tài liệu thường" example:"my_folder"`
	Title               string                  `json:"title" example:"Kế hoạch Q4"`
	Icon                *string                 `json:"icon,omitempty" example:"📄"`
	Visibility          string                  `json:"visibility" description:"workspace hoặc restricted" example:"workspace"`
	Content             *json.RawMessage        `json:"content,omitempty" description:"ProseMirror JSON đã sanitize; chỉ page"`
	ContentText         string                  `json:"content_text,omitempty" description:"Văn bản rút từ content phục vụ tìm kiếm/preview" example:"Kế hoạch quý 4"`
	Revision            string                  `json:"revision" description:"Revision làm việc, chuỗi thập phân" example:"41"`
	CurrentVersion      int32                   `json:"current_version" description:"Ordinal phiên bản mới nhất; 0 = chưa có mốc" example:"3"`
	Position            float64                 `json:"position" description:"Thứ tự trong cây" example:"0"`
	MyLevel             string                  `json:"my_level,omitempty" description:"view, comment, edit hoặc manage của actor; vắng mặt khi admin_scope và chưa có quyền đọc" example:"edit"`
	Via                 string                  `json:"via,omitempty" description:"member, share, link, owner, ai_context hoặc break_glass" example:"member"`
	AdminScope          bool                    `json:"admin_scope,omitempty" description:"true = actor là owner/admin workspace trên tài liệu restricted mà họ không phải ACL owner: được quản trị nhưng không tự có quyền đọc; content bị lược bỏ khi my_level thấp hơn view" example:"true"`
	BreakGlassExpiresAt *string                 `json:"break_glass_expires_at,omitempty" description:"Hạn của grant truy cập khẩn cấp đang đọc tài liệu; chỉ có khi via=break_glass" example:"2026-09-28T09:00:00Z"`
	File                *DocumentFileDTO        `json:"file,omitempty" description:"Metadata bản file hiện hành; chỉ kind=file"`
	Breadcrumbs         []DocumentBreadcrumbDTO `json:"breadcrumbs,omitempty" description:"Chuỗi tổ tiên từ gốc tới cha"`
	OwnerKind           *string                 `json:"owner_kind,omitempty" description:"work_product khi tài liệu thuộc sở hữu" example:"work_product"`
	OwnerID             *string                 `json:"owner_id,omitempty" description:"ULID của owner; đọc cùng owner_kind" example:"01J8X4WP00N1P2Q3R4S5T6U7V8"`
	ArchivedAt          *string                 `json:"archived_at,omitempty" example:"2026-09-27T09:00:00Z"`
	ArchivedBy          *string                 `json:"archived_by,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	PurgeAfter          *string                 `json:"purge_after,omitempty" example:"2026-10-27T09:00:00Z"`
	CreatedBy           string                  `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind       string                  `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	UpdatedBy           string                  `json:"updated_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind       string                  `json:"updated_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt           string                  `json:"created_at" example:"2026-09-27T09:00:00Z"`
	UpdatedAt           string                  `json:"updated_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentBreadcrumbDTO is one ancestor entry in DocumentDTO.breadcrumbs.
type DocumentBreadcrumbDTO struct {
	ID    string  `json:"id" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Title string  `json:"title" example:"Tài liệu nội bộ"`
	Icon  *string `json:"icon,omitempty" example:"📁"`
}

// DocumentFileDTO is the download metadata of a file document: the live file
// version's identity and content description. Bytes are only ever read
// through the Go proxy route, never a signed URL (C-01 §14.2, DOC-004).
type DocumentFileDTO struct {
	FileID         string `json:"file_id" description:"file_id FileService của bản hiện hành" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	VersionID      string `json:"version_id" description:"ULID document_versions đang là bản hiện hành" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	Version        int32  `json:"version" description:"Ordinal phiên bản hiện hành" example:"3"`
	Filename       string `json:"filename" example:"bao-cao-thang-9.pdf"`
	MimeType       string `json:"mime_type" example:"application/pdf"`
	SizeBytes      int64  `json:"size_bytes" example:"245760"`
	ChecksumSha256 string `json:"checksum_sha256" description:"SHA-256 hex của byte hiện hành" example:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"`
}

// DocumentSDO wraps one document (create, get, patch, file-create).
type DocumentSDO struct {
	Document DocumentDTO `json:"document"`
}

// DocumentUploadSDO is POST /documents/{id}/uploads (C-01 §14.4): the staged
// bytes a versions/commit may claim. upload_id IS the FileService file_id.
type DocumentUploadSDO struct {
	UploadID       string `json:"upload_id" description:"file_id FileService đã stage" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	ChecksumSha256 string `json:"checksum_sha256" description:"SHA-256 hex của byte đã nhận" example:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"`
	SizeBytes      int64  `json:"size_bytes" example:"245760"`
	ClaimExpiresAt string `json:"claim_expires_at" description:"Hạn claim; sau mốc này FileService GC thu byte" example:"2026-09-28T09:00:00Z"`
}

// DocumentVersionDTO is one document_versions row. `content` rides along only
// on the single-version GET of a page version; a file version instead carries
// file metadata and download_url (the Go proxy route, C-01 §14.2).
type DocumentVersionDTO struct {
	ID              string           `json:"id" description:"ULID phiên bản" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	DocumentID      string           `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Version         int32            `json:"version" description:"Ordinal 1,2,3… trong document" example:"3"`
	Kind            string           `json:"kind" description:"page hoặc file (snapshot lúc tạo)" example:"page"`
	Reason          string           `json:"reason" description:"manual, auto, restore, upload hoặc agent" example:"manual"`
	Label           *string          `json:"label,omitempty" example:"Bản gửi khách hàng"`
	Content         *json.RawMessage `json:"content,omitempty" description:"Nội dung page của phiên bản; chỉ trên GET một phiên bản"`
	FileID          *string          `json:"file_id,omitempty" description:"file_id FileService của blob phiên bản" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	MimeType        *string          `json:"mime_type,omitempty" example:"application/pdf"`
	SizeBytes       int64            `json:"size_bytes" example:"245760"`
	ChecksumSha256  *string          `json:"checksum_sha256,omitempty" example:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"`
	RestoredFrom    *int32           `json:"restored_from,omitempty" description:"Ordinal nguồn khi reason=restore" example:"1"`
	EngineName      *string          `json:"engine_name,omitempty" description:"Engine đã sinh byte (Office); null với page và upload thẳng" example:"genoffice"`
	EngineVersion   *string          `json:"engine_version,omitempty" example:"genoffice@1.4.2+uniwork-office.3"`
	ContractVersion *string          `json:"contract_version,omitempty" example:"uniwork-office-engine-contract/1"`
	ProtocolVersion *string          `json:"protocol_version,omitempty" description:"Phiên bản protocol engine G2 dạng chuỗi thập phân" example:"1"`
	DownloadURL     *string          `json:"download_url,omitempty" description:"Route proxy tải blob phiên bản file" example:"/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download?version=3"`
	CreatedBy       string           `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind   string           `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt       string           `json:"created_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentVersionSDO wraps one version (single-version GET, manual create).
type DocumentVersionSDO struct {
	Version DocumentVersionDTO `json:"version"`
}

// DocumentVersionListSDO is GET /documents/{id}/versions: metadata rows only,
// no content.
type DocumentVersionListSDO struct {
	Versions   []DocumentVersionDTO `json:"versions"`
	NextCursor *string              `json:"next_cursor" description:"Cursor trang kế; null khi hết trang" example:"eyJ2IjozfQ"`
}

// DocumentVersionResultSDO answers POST /versions/commit and
// POST /versions/{versionNo}/restore: the version row that was created plus
// the working document with its bumped revision — the two things the client
// needs to mark a draft saved.
type DocumentVersionResultSDO struct {
	Document DocumentDTO        `json:"document"`
	Version  DocumentVersionDTO `json:"version"`
}

// CommitIntentSDO answers GET /documents/{id}/versions/commit (G5-07): what
// became of the caller's commit with the Idempotency-Key header. version and
// revision are present only when outcome is committed. A key the server holds
// no intent for (swept after its resume window, never received, or another
// member's) is not this body but 410 commit_intent_unknown.
type CommitIntentSDO struct {
	Outcome   string `json:"outcome" description:"committed | not_committed (claim hết hạn, không attempt nào còn commit được) | in_flight (đang có claim sống) | unknown (chỉ đi kèm 410 commit_intent_unknown)" example:"committed"`
	VersionID string `json:"version_id,omitempty" description:"ULID version đã tạo, khi committed" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	Version   *int32 `json:"version,omitempty" description:"Số version đã tạo, khi committed" example:"3"`
	Revision  string `json:"revision,omitempty" description:"Revision tài liệu sau commit (chuỗi thập phân), khi committed" example:"42"`
}

// DocumentAssetSDO is POST /documents/{id}/assets (C-01 §5.4): the asset a
// page embeds via asset://{id}. url is the Go proxy route that serves the
// bytes (302/presign is not used for documents).
type DocumentAssetSDO struct {
	ID         string `json:"id" description:"ULID asset" example:"01J8X4AST0N1P2Q3R4S5T6U7V8"`
	DocumentID string `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	URL        string `json:"url" description:"Route proxy /api/v1/documents/{id}/assets/{assetID}" example:"/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8"`
	MimeType   string `json:"mime_type" example:"image/png"`
	SizeBytes  int64  `json:"size_bytes" example:"102400"`
	Width      *int32 `json:"width,omitempty" example:"1280"`
	Height     *int32 `json:"height,omitempty" example:"720"`
	CreatedAt  string `json:"created_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentDownloadSDO is GET /documents/{id}/download?meta=1: the descriptor
// of the bytes the same route serves when meta is absent (HEAD/Range
// streaming). It answers "what will a download get" without transferring the
// file — the byte route itself returns no JSON.
type DocumentDownloadSDO struct {
	DocumentID  string          `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	File        DocumentFileDTO `json:"file"`
	Disposition string          `json:"disposition" description:"attachment (tài liệu file) hoặc inline (asset ảnh)" example:"attachment"`
}

// --- G1-05b (UNI-679, C-01 §5.1/§5.3/§5.4) --------------------------------

// DocumentPathItemSDO is one ancestor entry in DocumentSummaryDTO.path,
// ordered from the root (or the highest readable ancestor) to the direct parent.
type DocumentPathItemSDO struct {
	ID    string `json:"id" description:"ULID tổ tiên" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Title string `json:"title" description:"Tiêu đề tổ tiên" example:"Tài liệu nội bộ"`
}

// DocumentSummaryDTO is one list row (list/recent/shared-with-me): the
// metadata a library row renders, without the page content a list never
// carries. `snippet` rides only on a search hit; `my_level`/`via` are the
// level the service resolved for the viewer on that row (list, recent,
// folder children, shared-with-me), never guessed.
type DocumentSummaryDTO struct {
	ID             string  `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID    string  `json:"workspace_id" description:"Workspace chứa tài liệu; có thể khác workspace gọi shared-with-me" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ParentID       *string `json:"parent_id,omitempty" description:"ULID trang hoặc thư mục cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Kind           string  `json:"kind" description:"page, file hoặc folder" example:"page"`
	SystemKind     *string `json:"system_kind,omitempty" description:"my_folder khi là Thư mục của tôi; vắng mặt với tài liệu thường" example:"my_folder"`
	Title          string  `json:"title" example:"Kế hoạch Q4"`
	Icon           *string `json:"icon,omitempty" example:"📄"`
	Visibility     string  `json:"visibility" description:"workspace hoặc restricted" example:"workspace"`
	Revision       string  `json:"revision" description:"Revision làm việc, chuỗi thập phân" example:"41"`
	CurrentVersion int32   `json:"current_version" description:"Ordinal phiên bản mới nhất; 0 = chưa có mốc" example:"3"`
	Position       float64 `json:"position" description:"Thứ tự trong cây" example:"0"`
	SizeBytes      int64   `json:"size_bytes" description:"Kích thước phiên bản file hiện tại (byte); 0 với trang và thư mục" example:"325632"`
	Format         *string `json:"format,omitempty" description:"Định dạng của tệp theo phiên bản hiện tại: docx, xlsx, pptx, pdf, md hoặc html (MIME đã xác minh, nếu không có thì theo phần mở rộng của tiêu đề); vắng mặt với trang, thư mục và tệp không xác định được định dạng" example:"docx"`
	Origin         string  `json:"origin" description:"upload (file tải lên) hoặc created (trang, thư mục, file trống, bản chuyển đổi)" example:"upload"`
	Snippet        *string `json:"snippet,omitempty" description:"Đoạn khớp ≤ 160 ký tự khi tìm bằng q" example:"…kế hoạch quý 4 gồm ba mốc…"`
	MyLevel        *string `json:"my_level,omitempty" description:"view, comment, edit hoặc manage của người xem trên dòng này; vắng mặt = coi như view, trừ khi admin_scope (dòng bị khóa)" example:"view"`
	Via            *string `json:"via,omitempty" description:"member, share, link, owner, ai_context hoặc break_glass" example:"share"`
	AdminScope     bool    `json:"admin_scope,omitempty" description:"true = người xem là owner/admin workspace trên dòng restricted mà họ không phải ACL owner; không có my_level = dòng bị khóa" example:"true"`
	// EditLock is who is editing this row's document right now (UNI-1645
	// §3.2); absent when nobody holds the lock. A list row never carries
	// lock_id, whatever the viewer's level (C2-1 is R1 only).
	EditLock      *DocumentEditLockSummarySDO `json:"edit_lock,omitempty" description:"Người đang sửa tài liệu (tóm tắt, không có lock_id); vắng mặt khi không ai giữ" example:"{\"holder_id\":\"01J8X4USR0N1P2Q3R4S5T6U7\",\"holder_name\":\"Nguyễn Văn A\",\"since\":\"2026-10-15T03:12:00Z\",\"expires_at\":\"2026-10-15T03:14:00Z\",\"reserved\":false,\"held_by_me\":false}"`
	OwnerKind     *string                     `json:"owner_kind,omitempty" example:"work_product"`
	OwnerID       *string                     `json:"owner_id,omitempty" example:"01J8X4WP00N1P2Q3R4S5T6U7V8"`
	ArchivedAt    *string                     `json:"archived_at,omitempty" example:"2026-09-27T09:00:00Z"`
	ArchivedBy    *string                     `json:"archived_by,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	PurgeAfter    *string                     `json:"purge_after,omitempty" example:"2026-10-27T09:00:00Z"`
	CreatedBy     string                      `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind string                      `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	UpdatedBy     string                      `json:"updated_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind string                      `json:"updated_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt     string                      `json:"created_at" example:"2026-09-27T09:00:00Z"`
	UpdatedAt     string                      `json:"updated_at" example:"2026-09-27T09:00:00Z"`
	// Path rides only on a search (q) result row (E6/FD-05, UNI-1465).
	Path []DocumentPathItemSDO `json:"path,omitempty" description:"Chuỗi tổ tiên từ gốc tới cha trực tiếp; cắt ở tổ tiên đầu tiên người gọi không đọc được; chỉ có trên dòng kết quả tìm bằng q" example:"[{\"id\":\"01J8X4DOC0N1P2Q3R4S5T6U7W9\",\"title\":\"Tài liệu nội bộ\"}]"`
}

// DocumentListSDO is the page shape shared by list, recent and
// shared-with-me. next_cursor is null on the last page; a client never
// fabricates one.
type DocumentListSDO struct {
	Documents  []DocumentSummaryDTO `json:"documents"`
	NextCursor *string              `json:"next_cursor" description:"Cursor trang kế; null khi hết trang" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoiLCJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
}

// DocumentTreeNodeDTO is one sidebar node (C-01 §5.1): metadata only, five
// levels, children in sibling order. A node below an unreadable ancestor is
// absent with it.
type DocumentTreeNodeDTO struct {
	ID         string                `json:"id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	ParentID   *string               `json:"parent_id,omitempty" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Title      string                `json:"title" example:"Tài liệu nội bộ"`
	Icon       *string               `json:"icon,omitempty" example:"📁"`
	Kind       string                `json:"kind" description:"page, file hoặc folder" example:"page"`
	SystemKind *string               `json:"system_kind,omitempty" description:"my_folder khi là Thư mục của tôi; vắng mặt với tài liệu thường" example:"my_folder"`
	Position   float64               `json:"position" description:"Thứ tự giữa các sibling" example:"0"`
	Children   []DocumentTreeNodeDTO `json:"children" description:"Con đã sắp theo position; rỗng khi hết cấp 5"`
	// EditLock is who is editing this node's document right now (UNI-1645
	// §3.2); absent when nobody holds the lock. Never carries lock_id.
	EditLock *DocumentEditLockSummarySDO `json:"edit_lock,omitempty" description:"Người đang sửa tài liệu (tóm tắt, không có lock_id); vắng mặt khi không ai giữ" example:"{\"holder_id\":\"01J8X4USR0N1P2Q3R4S5T6U7\",\"holder_name\":\"Nguyễn Văn A\",\"since\":\"2026-10-15T03:12:00Z\",\"expires_at\":\"2026-10-15T03:14:00Z\",\"reserved\":false,\"held_by_me\":false}"`
}

// DocumentTreeSDO is GET /workspaces/{ws}/documents/tree.
type DocumentTreeSDO struct {
	Documents []DocumentTreeNodeDTO `json:"documents"`
}

// DocumentArchiveSDO answers archive/restore: the document that moved, the
// batch this command wrote (restore only recovers nodes of its own batch) and
// the ids that actually changed in the subtree.
type DocumentArchiveSDO struct {
	Document DocumentDTO `json:"document"`
	BatchID  *string     `json:"batch_id,omitempty" description:"ULID đợt archive; một đợt chỉ restore được chính nó" example:"01J8X4BATCHN1P2Q3R4S5T6U7"`
	Affected []string    `json:"affected" description:"ULID các tài liệu đã đổi trạng thái trong đợt" example:"[\"01J8X4DOC0N1P2Q3R4S5T6U7\"]"`
}

// DocumentArchiveImpactSDO answers GET /documents/{id}/archive-impact (FD-04,
// addendum §3.4): what one archive of the subtree would move, or — past the
// bound — that it is too large for one archive. folders/documents exclude the
// root; total includes it, so it is the number of rows the archive writes.
type DocumentArchiveImpactSDO struct {
	Folders   int  `json:"folders" description:"Số thư mục con còn sống sẽ vào thùng rác, không gồm chính gốc" example:"2"`
	Documents int  `json:"documents" description:"Số trang và tệp còn sống sẽ vào thùng rác, không gồm chính gốc; trang con trong trang cũng tính" example:"5"`
	Total     int  `json:"total" description:"Tổng số dòng lệnh lưu trữ sẽ ghi, gồm chính gốc; chỉ chính xác khi too_large = false" example:"8"`
	MaxNodes  int  `json:"max_nodes" description:"Trần số nút một lần lưu trữ nhận" example:"1000"`
	TooLarge  bool `json:"too_large" description:"true = cây con vượt trần: không có số đếm, nút xác nhận bị khóa và thông báo folder_too_large" example:"false"`
}

// DocumentAccessSourceDTO is one source entry on a user share row or in my_sources
// on GET /api/v1/documents/{documentID}/shares (SH-S2, UNI-1781).
type DocumentAccessSourceDTO struct {
	SourceType  string `json:"source_type" enums:"acl_owner,home_workspace,workspace,organization,direct" example:"organization"`
	PrincipalID string `json:"principal_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	Name        string `json:"name" example:"Acme Corp"`
	Level       string `json:"level" enums:"view,comment,edit,manage" example:"edit"`
}

// DocumentHomeWorkspaceAccessDTO is the home_workspace block on GET /documents/{id}/shares
// (SH-S2, UNI-1781).
type DocumentHomeWorkspaceAccessDTO struct {
	WorkspaceID string  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Name        string  `json:"name" example:"Kỹ thuật"`
	Visibility  string  `json:"visibility" enums:"workspace,restricted" example:"workspace"`
	Level       *string `json:"level,omitempty" enums:"view,comment,edit" example:"view"`
}

// DocumentShareDTO is one live grant row with what it grants right now.
// `active` is false when the row no longer reaches anyone (a user who left,
// a workspace gone from the organization). `effective_level` is the level the
// principal holds through every path, not just this row.
type DocumentShareDTO struct {
	ID             string                    `json:"id" example:"01J8X4SHAREN1P2Q3R4S5T6U7"`
	PrincipalType  string                    `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID    string                    `json:"principal_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level          string                    `json:"level" description:"Mức của chính grant này: view, comment, edit hoặc manage" example:"view"`
	Active         bool                      `json:"active" description:"Grant còn tới được principal không" example:"true"`
	EffectiveLevel *string                   `json:"effective_level,omitempty" description:"Mức hiệu lực của principal qua mọi đường" example:"edit"`
	EffectiveVia   *string                   `json:"effective_via,omitempty" example:"member"`
	Sources        []DocumentAccessSourceDTO `json:"sources,omitempty" description:"Mọi nguồn cấp quyền cho người dùng này (SH-S2)"`
	Warnings       []string                  `json:"warnings,omitempty" description:"Cảnh báo trên dòng người dùng, ví dụ direct_below_group (SH-S2)"`
	GrantedBy      string                    `json:"granted_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	GrantedByKind  string                    `json:"granted_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt      string                    `json:"created_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentShareBatchSDO is 201 of POST /documents/{id}/shares/batch:
// one entry per distinct principal, in request order.
type DocumentShareBatchSDO struct {
	Shares []DocumentShareDTO `json:"shares" description:"Grant sống tương ứng từng người dùng sau khi gộp trùng, theo thứ tự yêu cầu"`
}

// DocumentPersonAccessDTO is one person's effective level (acl_owner block).
type DocumentPersonAccessDTO struct {
	UserID string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level  string `json:"level" description:"view, comment, edit hoặc manage" example:"manage"`
	Via    string `json:"via" description:"member, share, link, owner, ai_context hoặc break_glass" example:"member"`
}

// DocumentLinkDTO is one public share link. The token itself is never stored;
// it is returned once by create and never again.
type DocumentLinkDTO struct {
	ID            string  `json:"id" example:"01J8X4LINK0N1P2Q3R4S5T6U7"`
	ExpiresAt     *string `json:"expires_at,omitempty" description:"Hạn hiệu lực" example:"2026-10-04T09:00:00Z"`
	ViewCount     int32   `json:"view_count" description:"Số lần mở qua liên kết" example:"3"`
	CreatedBy     string  `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind string  `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt     string  `json:"created_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentAccessSDO is GET /documents/{id}/shares (C-01 §5.3): the caller's
// own level and my_sources always; the grants, acl owner, home_workspace and
// live links only for a caller who may administer the document.
type DocumentAccessSDO struct {
	MyLevel       string                          `json:"my_level" description:"view, comment, edit hoặc manage; chuỗi rỗng khi admin_scope và chưa có quyền đọc" example:"manage"`
	Via           string                          `json:"via" description:"member, share, link, owner, ai_context hoặc break_glass; chuỗi rỗng khi chưa có quyền đọc" example:"member"`
	MySources     []DocumentAccessSourceDTO       `json:"my_sources" description:"Các nguồn cấp quyền hiện tại của chính người gọi (SH-S2)"`
	AdminScope    bool                            `json:"admin_scope,omitempty" description:"true = người gọi quản trị tài liệu restricted bằng vai trò owner/admin workspace" example:"true"`
	ACLOwner      *DocumentPersonAccessDTO        `json:"acl_owner,omitempty" description:"Người nắm ACL owner; chỉ khi manage hoặc admin_scope"`
	HomeWorkspace *DocumentHomeWorkspaceAccessDTO `json:"home_workspace,omitempty" description:"Trạng thái dòng Workspace gốc; chỉ khi manage hoặc admin_scope (SH-S2)"`
	Shares        []DocumentShareDTO              `json:"shares,omitempty" description:"Grant sống; chỉ khi manage hoặc admin_scope"`
	Links         []DocumentLinkDTO               `json:"links,omitempty" description:"Liên kết công khai sống; chỉ khi manage hoặc admin_scope"`
	BreakGlass    []DocumentBreakGlassGrantDTO    `json:"break_glass,omitempty" description:"Grant truy cập khẩn cấp còn hiệu lực, mới nhất trước; chỉ khi manage hoặc admin_scope"`
}

// DocumentBreakGlassGrantDTO is one emergency view grant (DOC-05; UNI-1628): a
// workspace admin's audited, 24-hour, view-only access to a restricted
// document, opened with a written reason.
type DocumentBreakGlassGrantDTO struct {
	ID         string `json:"id" description:"ULID grant" example:"01J8X4BGLASS0N1P2Q3R4S5T6U"`
	DocumentID string `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	ActorID    string `json:"actor_id" description:"ULID người mở truy cập khẩn cấp" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	ActorName  string `json:"actor_name" description:"Tên hiển thị của người mở; rỗng khi tài khoản không còn" example:"Nguyễn An"`
	Level      string `json:"level" description:"Luôn là view" example:"view"`
	Reason     string `json:"reason" description:"Lý do người mở nhập, 10–500 ký tự" example:"Kiểm tra hợp đồng theo yêu cầu của kiểm toán"`
	GrantedAt  string `json:"granted_at" example:"2026-09-27T09:00:00Z"`
	ExpiresAt  string `json:"expires_at" description:"Hết hiệu lực sau 24 giờ hoặc khi bị thu hồi" example:"2026-09-28T09:00:00Z"`
}

// DocumentBreakGlassSDO wraps one grant: POST /documents/{id}/break-glass
// answers 201 for a new grant and 200 for the caller's live one.
type DocumentBreakGlassSDO struct {
	Grant DocumentBreakGlassGrantDTO `json:"grant"`
}

// DocumentAdminSummaryDocumentDTO is the metadata block of the admin summary:
// what an administrator may see about a restricted document they cannot read.
// It never carries content, content_text or a file.
type DocumentAdminSummaryDocumentDTO struct {
	ID             string  `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID    string  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ParentID       *string `json:"parent_id,omitempty" description:"ULID trang hoặc thư mục cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Kind           string  `json:"kind" description:"page, file hoặc folder" example:"page"`
	Title          string  `json:"title" example:"Kế hoạch Q4"`
	Icon           *string `json:"icon,omitempty" example:"📄"`
	Visibility     string  `json:"visibility" description:"workspace hoặc restricted" example:"restricted"`
	SizeBytes      int64   `json:"size_bytes" description:"Kích thước phiên bản file hiện tại (byte); 0 với trang và thư mục" example:"325632"`
	ArchivedAt     *string `json:"archived_at,omitempty" example:"2026-09-27T09:00:00Z"`
	CreatedBy      string  `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedAt      string  `json:"created_at" example:"2026-09-27T09:00:00Z"`
	UpdatedAt      string  `json:"updated_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentAdminSummarySDO is GET /documents/{id}/admin-summary: metadata, the
// ACL owner and the caller's own standing, for a caller who may administer the
// document. Never content.
type DocumentAdminSummarySDO struct {
	Document   DocumentAdminSummaryDocumentDTO `json:"document"`
	ACLOwner   *DocumentPersonAccessDTO        `json:"acl_owner" description:"Người nắm ACL owner; null khi tài liệu không có"`
	MyLevel    string                          `json:"my_level" description:"view, comment, edit hoặc manage; chuỗi rỗng = chưa có quyền đọc" example:""`
	Via        string                          `json:"via,omitempty" description:"member, share, link, owner, ai_context hoặc break_glass" example:"break_glass"`
	AdminScope bool                            `json:"admin_scope" description:"true = người gọi quản trị tài liệu bằng vai trò owner/admin workspace" example:"true"`
	MyGrant    *DocumentBreakGlassGrantDTO     `json:"my_grant" description:"Grant truy cập khẩn cấp còn hiệu lực của chính người gọi; null khi không có"`
}

// DocumentShareSDO wraps one grant (share create). A share for the
// document's own workspace answers the home-row grant it merged into (SH-S1):
// same principal and level, but no share id and no created_at - there is no
// document_shares row behind it.
type DocumentShareSDO struct {
	Share DocumentShareDTO `json:"share"`
}

// DocumentLinkSDO wraps one created public link: the row, the raw token
// (returned exactly once) and the app-relative public share path.
type DocumentLinkSDO struct {
	Link  DocumentLinkDTO `json:"link"`
	Token string          `json:"token" description:"Token thô, chỉ trả một lần; server chỉ giữ SHA-256" example:"pU7c9jIcDtOFv3S9yKtRsQdLYh1vWnJm2Xk4aB6eZ0g"`
	URL   string          `json:"url" description:"Đường dẫn trang chia sẻ công khai" example:"/share/pU7c9jIcDtOFv3S9yKtRsQdLYh1vWnJm2Xk4aB6eZ0g"`
}

// DocumentAccessLogDTO is one access-log row. actor_kind/actor_id are always
// present; `actor` is the resolved display block when the actor still exists
// (anonymous rows have none).
type DocumentAccessLogDTO struct {
	ID          string    `json:"id" example:"01J8X4LOG0N1P2Q3R4S5T6U7"`
	Action      string    `json:"action" description:"view, download, export hoặc link_view" example:"view"`
	Via         string    `json:"via" description:"member, share, link, owner, ai_context hoặc break_glass" example:"share"`
	Version     *int32    `json:"version,omitempty" description:"Ordinal phiên bản đã đọc; vắng mặt khi đọc bản làm việc" example:"3"`
	ActorKind   string    `json:"actor_kind" description:"human, agent hoặc anonymous" example:"human"`
	ActorID     *string   `json:"actor_id,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Actor       *ActorDTO `json:"actor,omitempty" description:"Tên/avatar đã resolve; vắng mặt với anonymous hoặc actor đã xoá"`
	ShareLinkID *string   `json:"share_link_id,omitempty" description:"ULID link đã mở, khi via=link" example:"01J8X4LINK0N1P2Q3R4S5T6U7"`
	OccurredAt  string    `json:"occurred_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentAccessLogListSDO is GET /documents/{id}/access-logs: newest first.
type DocumentAccessLogListSDO struct {
	Logs       []DocumentAccessLogDTO `json:"logs"`
	NextCursor *string                `json:"next_cursor" description:"Cursor trang kế; null khi hết trang" example:"eyJ0IjoiMjAyNi0wOS0yN1QwOTowMDowMFoifQ"`
}

// DocumentSettingsSDO is PUT /orgs/{orgID}/documents/settings: the
// organization's public-link switch after the write.
type DocumentSettingsSDO struct {
	OrganizationID     string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	PublicLinksEnabled bool    `json:"public_links_enabled" description:"Liên kết công khai đang bật hay tắt" example:"true"`
	UpdatedBy          *string `json:"updated_by,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind      *string `json:"updated_by_kind,omitempty" description:"human, agent hoặc system" example:"human"`
	UpdatedAt          *string `json:"updated_at,omitempty" example:"2026-09-27T09:00:00Z"`
}

// PublicDocumentSDO is GET /public/documents/{token} (no auth): the only
// window an anonymous reader gets. A page carries its sanitized content; a
// file carries the download route. A revoked, expired or disabled link is a
// 404 with no body difference from an unknown token.
type PublicDocumentSDO struct {
	Document PublicDocumentDTO `json:"document"`
}

// PublicDocumentDTO is the anonymous view of one document: title, kind and
// either the sanitized page content or the streaming download path.
type PublicDocumentDTO struct {
	Title       string           `json:"title" example:"Kế hoạch Q4"`
	Kind        string           `json:"kind" description:"page, file hoặc folder" example:"page"`
	Content     *json.RawMessage `json:"content,omitempty" description:"ProseMirror JSON đã sanitize; chỉ page"`
	DownloadURL *string          `json:"download_url,omitempty" description:"Route tải công khai; chỉ kind=file" example:"/api/v1/public/documents/pU7c9jIcDtOFv3S9yKtRsQdLYh1vWnJm2Xk4aB6eZ0g/download"`
}

// DocumentCommentDTO is one document_comments row on the wire. Reactions
// reuses the shared CommentReactionDTO from task comments (comment_id,
// actor_type, actor_id, emoji, created_at) and is never omitted so the client
// can tell "nobody reacted" ([]) apart from "this server does not send the
// field"; display_name/avatar_url come from the author join the list query
// already carries. `type` keeps its old meaning for old clients; `kind` is the
// same value under the G8 name, and the anchor/delete fields arrive empty
// until a comment carries them.
type DocumentCommentDTO struct {
	ID          string               `json:"id" description:"ULID bình luận" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	DocumentID  string               `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	AuthorID    string               `json:"author_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	AuthorKind  string               `json:"author_kind" description:"human, agent hoặc system" example:"human"`
	Author      ActorDTO             `json:"author"`
	Body        string               `json:"body" description:"Nội dung đã trim; rỗng khi là khung đã xóa; request bị chặn ở 1 MiB" example:"Chỗ này cần số liệu Q3."`
	ParentID    *string              `json:"parent_id,omitempty" description:"ULID bình luận cha khi là trả lời" example:"01J8X4CMTN1P2Q3R4S5T6U7W"`
	Type        string               `json:"type" description:"comment hoặc discussion (trường cũ, giữ cho client cũ); bằng kind" example:"comment"`
	Kind        string               `json:"kind" description:"comment (bình luận có neo) hoặc discussion (thảo luận của tài liệu)" example:"discussion"`
	Anchor      json.RawMessage      `json:"anchor" description:"Neo theo định dạng tài liệu; null khi không neo" example:"{\"format\":\"xlsx\",\"v\":1,\"sheet\":\"S1\",\"range\":\"B7\"}"`
	AnchorState *string              `json:"anchor_state" description:"exact, stale hoặc lost; null khi không neo" example:"stale"`
	AnchorVer   *string              `json:"anchor_version_id" description:"ULID phiên bản neo đang lưu; null khi không neo" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	DeletedAt   *string              `json:"deleted_at" description:"Thời điểm xóa mềm; có giá trị = khung \"Nội dung đã bị xóa\"" example:"2026-10-13T09:00:00Z"`
	DeletedByID *string              `json:"deleted_by_id" description:"ULID người xóa; null khi chưa xóa" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DeletedKind *string              `json:"deleted_by_kind" description:"human, agent hoặc system; null khi chưa xóa" example:"human"`
	Revision    int64                `json:"revision" description:"Số lần sửa; tăng sau mỗi lần update" example:"1"`
	ResolvedAt  *string              `json:"resolved_at,omitempty" description:"Thời điểm đánh dấu đã giải quyết; null khi còn mở" example:"2026-09-28T09:00:00Z"`
	CreatedAt   string               `json:"created_at" example:"2026-09-28T08:00:00Z"`
	UpdatedAt   string               `json:"updated_at" example:"2026-09-28T08:00:00Z"`
	DisplayName string               `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string               `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
	Reactions   []CommentReactionDTO `json:"reactions"`
}

// DocumentCommentSDO wraps one comment (create, patch, resolve, reopen).
// MentionsWithoutAccess rides only on create and patch (G8-18): the people the
// comment named who cannot read the document, stored without a notification.
type DocumentCommentSDO struct {
	Comment               DocumentCommentDTO        `json:"comment"`
	MentionsWithoutAccess []MentionWithoutAccessDTO `json:"mentions_without_access,omitempty" description:"Người được nhắc nhưng chưa xem được tài liệu (không được thông báo); vắng mặt khi mọi người được nhắc đều đọc được"`
}

// MentionWithoutAccessDTO is one such person (G8-18). display_name is absent
// for an id outside the organization; can_share says whether the caller may
// share view access with them from the comment.
type MentionWithoutAccessDTO struct {
	UserID      string `json:"user_id" description:"ULID người được nhắc" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DisplayName string `json:"display_name,omitempty" description:"Tên hiển thị; vắng mặt với id ngoài tổ chức" example:"Nguyễn An"`
	CanShare    bool   `json:"can_share" description:"Người gọi có thể chia sẻ quyền Xem cho người này ngay từ bình luận" example:"true"`
}

// DocumentCommentMentionDTO is one name-table entry for the mention chips of
// the returned comments (contract-collab section 2.1): the current display
// name the server resolved once per full list, or `unavailable` when the
// account is gone or no longer an effective member - the client then keeps
// the label written in the token. G8-05 fills the table; until then a list
// answers an empty array.
type DocumentCommentMentionDTO struct {
	UserID      string `json:"user_id" description:"ULID người được nhắc" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DisplayName string `json:"display_name,omitempty" description:"Tên hiển thị hiện tại; vắng mặt khi state=unavailable" example:"Nguyễn An"`
	AvatarURL   string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
	State       string `json:"state" description:"ok hoặc unavailable" example:"ok"`
}

// DocumentCommentListSDO is GET /api/v1/documents/{documentID}/comments:
// oldest first, each row carrying its reactions. unchanged=true means the
// caller's since_token still describes the document: comments and mentions
// are then empty and the caller keeps its list (contract-collab section 2.1).
type DocumentCommentListSDO struct {
	Comments  []DocumentCommentDTO        `json:"comments" description:"Cũ nhất trước; rỗng khi unchanged"`
	Mentions  []DocumentCommentMentionDTO `json:"mentions" description:"Bảng tên của mọi mention trong comments trả về; rỗng khi unchanged"`
	ListToken string                      `json:"list_token" description:"Token của toàn tài liệu ở lần trả này" example:"lt1:9f2c1d3e4b5a"`
	Unchanged bool                        `json:"unchanged" description:"true khi since_token bằng token hiện tại" example:"false"`
}

// DocumentCommentDeleteSDO answers DELETE .../comments/{commentID}: `status`
// keeps its old value and `outcome` names what the delete did - a comment
// with surviving replies keeps its frame (tombstoned), one without is removed.
type DocumentCommentDeleteSDO struct {
	Status  string `json:"status" description:"ok" example:"ok"`
	Outcome string `json:"outcome" description:"tombstoned khi khung giữ lại; removed khi dòng bị bỏ hẳn" example:"tombstoned"`
}

// DocumentCommentRevisionDTO is one edit-history row (contract-collab section
// 2.7): the body a later edit replaced and the revision number that body
// carried; created_by is the actor of that edit.
type DocumentCommentRevisionDTO struct {
	ID            string `json:"id" example:"01J8X4REVN1P2Q3R4S5T6U7V8"`
	Revision      int64  `json:"revision" description:"Số revision của nội dung bị thay" example:"1"`
	Body          string `json:"body" description:"Nội dung trước lần sửa" example:"Chỗ này cần số liệu Q3."`
	CreatedByID   string `json:"created_by_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind string `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt     string `json:"created_at" example:"2026-10-13T09:00:00Z"`
}

// DocumentCommentRevisionListSDO is GET
// /api/v1/documents/{documentID}/comments/{commentID}/revisions: newest
// first; a tombstoned comment answers 409 comment_deleted instead (its
// history was deleted for real, Q8).
type DocumentCommentRevisionListSDO struct {
	Revisions []DocumentCommentRevisionDTO `json:"revisions"`
}

// DocumentCommentAnchorSkipDTO is one comment the anchor PUT left alone:
// older_version when the incoming version is behind the stored one,
// not_applicable for every other skip - unknown comment, another document's
// comment, a discussion, a reply or a tombstone - so the answer never says
// which of those it was (contract-collab section 2.6).
type DocumentCommentAnchorSkipDTO struct {
	CommentID string `json:"comment_id" description:"ULID bình luận bị bỏ qua" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	Reason    string `json:"reason" description:"older_version hoặc not_applicable" example:"not_applicable"`
}

// DocumentCommentAnchorsSDO answers PUT
// /api/v1/documents/{documentID}/comments/anchors: the comments whose anchor
// changed, the ones skipped with a reason, and the document's list_token
// after the write. The caller does not feed this token back as since_token:
// its list predates the changed rows (contract-collab section 2.6).
type DocumentCommentAnchorsSDO struct {
	Updated   []string                       `json:"updated" description:"ULID các bình luận đã đổi neo; rỗng khi không dòng nào đổi" example:"[\"01J8X4CMTN1P2Q3R4S5T6U7V\"]"`
	Skipped   []DocumentCommentAnchorSkipDTO `json:"skipped" description:"Bình luận bị bỏ qua kèm lý do (older_version, not_applicable)" example:"[]"`
	ListToken string                         `json:"list_token" description:"list_token của toàn tài liệu sau khi ghi" example:"lt1:9f2c1d3e4b5a"`
}

// DocumentFavoriteDTO is one favorited document in the caller's list. It
// carries what a favorites panel needs to open the document without a second
// read; the full document payload stays on GET /documents/{id}.
type DocumentFavoriteDTO struct {
	DocumentID  string  `json:"document_id" description:"ULID tài liệu đã lưu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	FavoriteID  string  `json:"favorite_id" description:"ULID dòng document_favorites" example:"01J8X4FAVN1P2Q3R4S5T6U7V8"`
	WorkspaceID string  `json:"workspace_id" description:"Workspace chứa tài liệu" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Title       string  `json:"title" example:"Kế hoạch Q4"`
	Kind        string  `json:"kind" description:"page, file hoặc folder" example:"page"`
	Icon        *string `json:"icon,omitempty" example:"📄"`
	ParentID    *string `json:"parent_id,omitempty" description:"ULID trang hoặc thư mục cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	FavoritedAt string  `json:"favorited_at" example:"2026-09-28T08:00:00Z"`
}

// DocumentFavoriteSDO is POST /api/v1/documents/{documentID}/favorite: the
// live favorite row, created or already there (the add is idempotent).
type DocumentFavoriteSDO struct {
	Favorite DocumentFavoriteDTO `json:"favorite"`
}

// DocumentFavoriteListSDO is GET /api/v1/orgs/{orgID}/documents/favorites:
// every favorite of the caller that is still readable, newest first.
type DocumentFavoriteListSDO struct {
	Favorites []DocumentFavoriteDTO `json:"favorites"`
}

// MentionCandidateDTO is one person the mention picker may offer (G8-06):
// someone who holds at least view on the document today. Email is present
// only when the caller may list the document workspace's members; a reader
// who reaches the document through a direct share of another workspace sees
// no email.
type MentionCandidateDTO struct {
	UserID      string  `json:"user_id" description:"ULID người có thể được nhắc tên" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DisplayName string  `json:"display_name" description:"Tên hiển thị hiện tại" example:"Nguyễn Văn An"`
	AvatarURL   *string `json:"avatar_url,omitempty" description:"Ảnh đại diện; vắng mặt khi người này chưa có" example:"https://cdn.example.com/avatars/an.png"`
	Email       *string `json:"email,omitempty" description:"Email; chỉ có khi người gọi xem được danh sách thành viên của workspace chứa tài liệu" example:"an.nguyen@example.com"`
	CanView     *bool   `json:"can_view,omitempty" description:"Người này có xem được tài liệu hiện nay không; chỉ có khi gọi với include=no_access (vắng mặt = mọi dòng đều xem được)" example:"false"`
}

// MentionCandidateListSDO is GET /api/v1/documents/{documentID}/mention-candidates:
// the people the picker may show, ordered by display name.
type MentionCandidateListSDO struct {
	Candidates []MentionCandidateDTO `json:"candidates"`
}

// DocumentAccessBatchSDO is the 200 response of PUT /api/v1/documents/{documentID}/access
// (SH-S2, UNI-1781).
type DocumentAccessBatchSDO struct {
	BatchID string                        `json:"batch_id" description:"ULID định danh lô thao tác" example:"01J8X4BAT0N1P2Q3R4S5T6U7V8"`
	DryRun  bool                          `json:"dry_run" description:"true khi chỉ chạy thử không ghi DB" example:"false"`
	Results []DocumentAccessItemResultSDO `json:"results" description:"Kết quả từng mục theo đúng thứ tự gửi lên"`
	Preview DocumentAccessPreviewSDO      `json:"preview" description:"Tác động dự kiến và cảnh báo"`
}

// DocumentAccessItemResultSDO is the outcome for one item in DocumentAccessBatchSDO.
type DocumentAccessItemResultSDO struct {
	PrincipalType string  `json:"principal_type" enums:"user,workspace,organization" example:"user"`
	PrincipalID   string  `json:"principal_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Action        string  `json:"action" enums:"granted,updated,revoked,kept,unchanged" example:"granted"`
	ShareID       string  `json:"share_id,omitempty" example:"01J8X4SHR0N1P2Q3R4S5T6U7V8"`
	Level         *string `json:"level" example:"view"`
	PreviousLevel *string `json:"previous_level" example:"edit"`
}

// DocumentAccessPreviewSDO is the preview block of DocumentAccessBatchSDO.
type DocumentAccessPreviewSDO struct {
	Users    []DocumentAccessPreviewUserSDO  `json:"users"`
	Groups   []DocumentAccessPreviewGroupSDO `json:"groups"`
	Warnings []string                        `json:"warnings"`
}

// DocumentAccessPreviewLevelSDO is one effective level + via pair in DocumentAccessPreviewUserSDO.
type DocumentAccessPreviewLevelSDO struct {
	Level string `json:"level" enums:"view,comment,edit,manage" example:"view"`
	Via   string `json:"via" example:"share"`
}

// DocumentAccessPreviewUserSDO is one user item's before/after effective standing.
type DocumentAccessPreviewUserSDO struct {
	UserID      string                         `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DisplayName string                         `json:"display_name" example:"Nguyễn Văn An"`
	Before      *DocumentAccessPreviewLevelSDO `json:"before"`
	After       *DocumentAccessPreviewLevelSDO `json:"after"`
}

// DocumentAccessPreviewGroupSDO is one workspace/organization item's summary counts.
type DocumentAccessPreviewGroupSDO struct {
	PrincipalType string  `json:"principal_type" enums:"workspace,organization" example:"workspace"`
	PrincipalID   string  `json:"principal_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Name          string  `json:"name" example:"Kỹ thuật"`
	Level         *string `json:"level" example:"edit"`
	MemberCount   int     `json:"member_count" example:"12"`
	LosingCount   int     `json:"losing_count" example:"0"`
}

// DocumentShareCandidateDTO is one item in GET /api/v1/documents/{documentID}/share-candidates
// (SH-S2, UNI-1781).
type DocumentShareCandidateDTO struct {
	PrincipalType   string  `json:"principal_type" enums:"user,workspace,organization" example:"user"`
	PrincipalID     string  `json:"principal_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Name            string  `json:"name" example:"Nguyễn Văn An"`
	Subtitle        string  `json:"subtitle,omitempty" example:"an.nguyen@example.com"`
	AvatarURL       *string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
	IconEmoji       *string `json:"icon_emoji,omitempty" example:"📁"`
	DirectLevel     *string `json:"direct_level,omitempty" enums:"view,comment,edit,manage" example:"view"`
	IsHomeWorkspace bool    `json:"is_home_workspace" example:"false"`
}

// DocumentShareCandidateListSDO is the 200 response of GET
// /api/v1/documents/{documentID}/share-candidates (SH-S2, UNI-1781).
type DocumentShareCandidateListSDO struct {
	Items      []DocumentShareCandidateDTO `json:"items"`
	NextCursor *string                     `json:"next_cursor" description:"Cursor trang kế; null khi hết trang"`
}
