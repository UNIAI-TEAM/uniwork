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
	ID             string                  `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID string                  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID    string                  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ParentID       *string                 `json:"parent_id,omitempty" description:"ULID trang cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Kind           string                  `json:"kind" description:"page hoặc file" example:"page"`
	Title          string                  `json:"title" example:"Kế hoạch Q4"`
	Icon           *string                 `json:"icon,omitempty" example:"📄"`
	Visibility     string                  `json:"visibility" description:"workspace hoặc restricted" example:"workspace"`
	Content        *json.RawMessage        `json:"content,omitempty" description:"ProseMirror JSON đã sanitize; chỉ page"`
	ContentText    string                  `json:"content_text,omitempty" description:"Văn bản rút từ content phục vụ tìm kiếm/preview" example:"Kế hoạch quý 4"`
	Revision       string                  `json:"revision" description:"Revision làm việc, chuỗi thập phân" example:"41"`
	CurrentVersion int32                   `json:"current_version" description:"Ordinal phiên bản mới nhất; 0 = chưa có mốc" example:"3"`
	Position       float64                 `json:"position" description:"Thứ tự trong cây" example:"0"`
	MyLevel        string                  `json:"my_level,omitempty" description:"view, edit hoặc manage của actor" example:"edit"`
	Via            string                  `json:"via,omitempty" description:"member, share, link hoặc ai_context" example:"member"`
	File           *DocumentFileDTO        `json:"file,omitempty" description:"Metadata bản file hiện hành; chỉ kind=file"`
	Breadcrumbs    []DocumentBreadcrumbDTO `json:"breadcrumbs,omitempty" description:"Chuỗi tổ tiên từ gốc tới cha"`
	OwnerKind      *string                 `json:"owner_kind,omitempty" description:"work_product khi tài liệu thuộc sở hữu" example:"work_product"`
	OwnerID        *string                 `json:"owner_id,omitempty" description:"ULID của owner; đọc cùng owner_kind" example:"01J8X4WP00N1P2Q3R4S5T6U7V8"`
	ArchivedAt     *string                 `json:"archived_at,omitempty" example:"2026-09-27T09:00:00Z"`
	CreatedBy      string                  `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind  string                  `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	UpdatedBy      string                  `json:"updated_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind  string                  `json:"updated_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt      string                  `json:"created_at" example:"2026-09-27T09:00:00Z"`
	UpdatedAt      string                  `json:"updated_at" example:"2026-09-27T09:00:00Z"`
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
	ProtocolVersion *string          `json:"protocol_version,omitempty" example:"uniwork-office-protocol/1"`
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

// DocumentSummaryDTO is one list row (list/recent/shared-with-me): the
// metadata a library row renders, without the page content a list never
// carries. `snippet` rides only on a search hit; `my_level`/`via` exist only
// where the service resolved them (shared-with-me), never guessed.
type DocumentSummaryDTO struct {
	ID             string  `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID    string  `json:"workspace_id" description:"Workspace chứa tài liệu; có thể khác workspace gọi shared-with-me" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ParentID       *string `json:"parent_id,omitempty" description:"ULID trang cha; vắng mặt = tài liệu gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Kind           string  `json:"kind" description:"page hoặc file" example:"page"`
	Title          string  `json:"title" example:"Kế hoạch Q4"`
	Icon           *string `json:"icon,omitempty" example:"📄"`
	Visibility     string  `json:"visibility" description:"workspace hoặc restricted" example:"workspace"`
	Revision       string  `json:"revision" description:"Revision làm việc, chuỗi thập phân" example:"41"`
	CurrentVersion int32   `json:"current_version" description:"Ordinal phiên bản mới nhất; 0 = chưa có mốc" example:"3"`
	Position       float64 `json:"position" description:"Thứ tự trong cây" example:"0"`
	Snippet        *string `json:"snippet,omitempty" description:"Đoạn khớp ≤ 160 ký tự khi tìm bằng q" example:"…kế hoạch quý 4 gồm ba mốc…"`
	MyLevel        *string `json:"my_level,omitempty" description:"view, edit hoặc manage khi service đã tính" example:"view"`
	Via            *string `json:"via,omitempty" description:"member, share, link hoặc ai_context" example:"share"`
	OwnerKind      *string `json:"owner_kind,omitempty" example:"work_product"`
	OwnerID        *string `json:"owner_id,omitempty" example:"01J8X4WP00N1P2Q3R4S5T6U7V8"`
	ArchivedAt     *string `json:"archived_at,omitempty" example:"2026-09-27T09:00:00Z"`
	CreatedBy      string  `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind  string  `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	UpdatedBy      string  `json:"updated_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UpdatedByKind  string  `json:"updated_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt      string  `json:"created_at" example:"2026-09-27T09:00:00Z"`
	UpdatedAt      string  `json:"updated_at" example:"2026-09-27T09:00:00Z"`
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
	ID       string                `json:"id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	ParentID *string               `json:"parent_id,omitempty" example:"01J8X4DOC0N1P2Q3R4S5T6U7W9"`
	Title    string                `json:"title" example:"Tài liệu nội bộ"`
	Icon     *string               `json:"icon,omitempty" example:"📁"`
	Kind     string                `json:"kind" description:"page hoặc file" example:"page"`
	Position float64               `json:"position" description:"Thứ tự giữa các sibling" example:"0"`
	Children []DocumentTreeNodeDTO `json:"children" description:"Con đã sắp theo position; rỗng khi hết cấp 5"`
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

// DocumentShareDTO is one live grant row with what it grants right now.
// `active` is false when the row no longer reaches anyone (a user who left,
// a workspace gone from the organization). `effective_level` is the level the
// principal holds through every path, not just this row.
type DocumentShareDTO struct {
	ID             string  `json:"id" example:"01J8X4SHAREN1P2Q3R4S5T6U7"`
	PrincipalType  string  `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID    string  `json:"principal_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level          string  `json:"level" description:"Mức của chính grant này: view, edit hoặc manage" example:"view"`
	Active         bool    `json:"active" description:"Grant còn tới được principal không" example:"true"`
	EffectiveLevel *string `json:"effective_level,omitempty" description:"Mức hiệu lực của principal qua mọi đường" example:"edit"`
	EffectiveVia   *string `json:"effective_via,omitempty" example:"member"`
	GrantedBy      string  `json:"granted_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	GrantedByKind  string  `json:"granted_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt      string  `json:"created_at" example:"2026-09-27T09:00:00Z"`
}

// DocumentPersonAccessDTO is one person's effective level (acl_owner block).
type DocumentPersonAccessDTO struct {
	UserID string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level  string `json:"level" description:"view, edit hoặc manage" example:"manage"`
	Via    string `json:"via" description:"member, share, link hoặc ai_context" example:"member"`
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
// own level always; the grants, acl owner and live links only for a caller at
// manage level. Everyone else reads `my_level`/`via` alone.
type DocumentAccessSDO struct {
	MyLevel  string                   `json:"my_level" description:"view, edit hoặc manage" example:"manage"`
	Via      string                   `json:"via" description:"member, share, link hoặc ai_context" example:"member"`
	ACLOwner *DocumentPersonAccessDTO `json:"acl_owner,omitempty" description:"Người nắm ACL owner; chỉ khi manage"`
	Shares   []DocumentShareDTO       `json:"shares,omitempty" description:"Grant sống; chỉ khi manage"`
	Links    []DocumentLinkDTO        `json:"links,omitempty" description:"Liên kết công khai sống; chỉ khi manage"`
}

// DocumentShareSDO wraps one grant (share create).
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
	Via         string    `json:"via" description:"member, share, link hoặc ai_context" example:"share"`
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
	Kind        string           `json:"kind" description:"page hoặc file" example:"page"`
	Content     *json.RawMessage `json:"content,omitempty" description:"ProseMirror JSON đã sanitize; chỉ page"`
	DownloadURL *string          `json:"download_url,omitempty" description:"Route tải công khai; chỉ kind=file" example:"/api/v1/public/documents/pU7c9jIcDtOFv3S9yKtRsQdLYh1vWnJm2Xk4aB6eZ0g/download"`
}
