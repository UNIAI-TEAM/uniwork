package sdi

// Office Docs web frame (UNI-1013). The host page mints a frame token with
// its session; every /api/v1/office-frame route takes only that token as
// `Authorization: Bearer`, never a cookie or the session token.

// UploadOfficeFrameFileSDI documents POST
// /api/v1/office-frame/documents/{documentID}/uploads (multipart): the save
// intent. The staged bytes become a version only through .../versions/commit.
type UploadOfficeFrameFileSDI struct {
	File []byte `formData:"file" description:"Byte mới của tài liệu (cùng định dạng với module của token); purpose document_file, ≤ 50 MiB"`
}

// CommitOfficeFrameVersionSDI is POST
// /api/v1/office-frame/documents/{documentID}/versions/commit (+
// Idempotency-Key): turns the staged upload into the document's new version.
// base_revision is the revision the frame opened or last saved; a stale one
// answers 409 document_version_conflict with fields.current_revision.
type CommitOfficeFrameVersionSDI struct {
	UploadID     string `json:"upload_id" description:"upload_id do POST .../uploads trả về" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	BaseRevision string `json:"base_revision" description:"Revision nền dạng chuỗi thập phân (etag lạc quan); lệch -> 409 document_version_conflict" example:"41"`
}

// UploadOfficeFrameAssetSDI documents POST
// /api/v1/office-frame/documents/{documentID}/assets (multipart): an image the
// document embeds (≤ 10 MiB, image allowlist).
type UploadOfficeFrameAssetSDI struct {
	File []byte `formData:"file" description:"Ảnh chèn vào tài liệu; purpose document_asset, ≤ 10 MiB, PNG/JPEG/GIF/WebP"`
}

// SignOfficeFrameAssetsSDI is POST
// /api/v1/office-frame/documents/{documentID}/assets/sign: fresh signed URLs
// for images already attached to the token's document.
type SignOfficeFrameAssetsSDI struct {
	AssetIDs []string `json:"asset_ids" minItems:"1" maxItems:"100" description:"ULID asset của chính tài liệu trong token (1..100); asset lạ -> 404" example:"[\"01J8X4AST0N1P2Q3R4S5T6U7V8\"]"`
}

// ResolveOfficeFrameAssetsSDI is POST
// /api/v1/office-frame/documents/{documentID}/assets/resolve (Markdown and HTML
// tokens): signed URLs for relative paths as written in the document, fresh
// ones for the open answer's paths and the URLs of paths typed after the open.
type ResolveOfficeFrameAssetsSDI struct {
	Paths []string `json:"paths" minItems:"1" maxItems:"50" description:"Đường dẫn tương đối như viết trong tài liệu (1..50); cùng cách chuẩn hóa và quyền như lúc mở; đường dẫn không phân giải được thì vắng khỏi kết quả" example:"[\"assets/logo.png\",\"../img/a.svg\"]"`
}

// ListOfficeFrameRecentsSDI documents GET
// /api/v1/office-frame/documents/{documentID}/recents.
type ListOfficeFrameRecentsSDI struct {
	Limit int `query:"limit" description:"Số mục tối đa (1..50, mặc định 20)" example:"20"`
}
