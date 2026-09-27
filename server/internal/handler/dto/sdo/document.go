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
