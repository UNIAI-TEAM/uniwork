package sdo

// OfficeFrameTokenSDO is POST /api/v1/documents/{documentID}/office/frame-token. The token is server-signed and binds
// exactly one document, its workspace and organization, and the user; it is
// handed to the frame in the postMessage init, never in a cookie or URL.
type OfficeFrameTokenSDO struct {
	Token          string `json:"token" description:"Token khung ngắn hạn (Authorization: Bearer cho /api/v1/office-frame/*)" example:"oft1.eyJ2IjoxfQ.c2ln"`
	TokenType      string `json:"token_type" description:"Luôn Bearer" example:"Bearer"`
	ExpiresAt      string `json:"expires_at" description:"Hạn token (RFC3339); trước hạn host cấp lại bằng phiên của nó" example:"2026-10-08T10:10:00Z"`
	ExpiresIn      int    `json:"expires_in" description:"Số giây còn lại khi cấp" example:"600"`
	DocumentID     string `json:"document_id" description:"ULID tài liệu duy nhất token mở được" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	WorkspaceID    string `json:"workspace_id" description:"ULID workspace của tài liệu" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	OrganizationID string `json:"organization_id" description:"ULID tổ chức của tài liệu" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	CanEdit        bool   `json:"can_edit" description:"Người dùng có quyền sửa (save/asset) lúc cấp; server vẫn kiểm lại mỗi request" example:"true"`
	Module         string `json:"module" description:"Module web genoffice mở tài liệu, suy từ định dạng tệp đã lưu: docs, pdf, markdown, html, slides, sheets" example:"docs"`
	// AI is the AI grant for this document's organization; all false when the
	// plan or the server has no web AI.
	AI OfficeFrameAIGrantSDO `json:"ai" description:"Quyền AI host được cấp cho khung (ai, web_search, image_search, image_generation)"`
}

// OfficeFrameDocumentSDO is the frame's view of the document: GET
// /api/v1/office-frame/documents/{documentID} (open) and the answer of a
// successful commit (save). download_url is a first-party route read with the
// same frame token; it is never a presigned storage URL.
type OfficeFrameDocumentSDO struct {
	DocumentID     string          `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	WorkspaceID    string          `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	OrganizationID string          `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	Title          string          `json:"title" example:"Kế hoạch Q4.docx"`
	Revision       string          `json:"revision" description:"Revision hiện tại dạng chuỗi thập phân; gửi lại làm base_revision khi save" example:"41"`
	CanEdit        bool            `json:"can_edit" example:"true"`
	Module         string          `json:"module" description:"Module web của token: docs, pdf, markdown, html, slides, sheets" example:"docs"`
	File           DocumentFileDTO `json:"file"`
	DownloadURL    string          `json:"download_url" description:"Route tải byte của version hiện tại, đọc bằng token khung" example:"/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7/content?version=3"`
	UpdatedAt      string          `json:"updated_at" example:"2026-10-08T10:00:00Z"`
	// Assets is set on open for the markdown and html modules (UNI-1232):
	// every relative reference of the current version that resolves, as
	// written in the document, to a signed same-origin URL.
	Assets map[string]string `json:"assets,omitempty" description:"Markdown/HTML: đường dẫn tương đối như viết trong tài liệu -> URL có chữ ký (asset của tài liệu hoặc file cùng thư mục); đường dẫn không phân giải được thì vắng" example:"{\"assets/logo.png\":\"/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=ofa1.abc\"}"`
}

// OfficeFrameRecentDTO is one recent document of the token's module in its
// workspace.
type OfficeFrameRecentDTO struct {
	DocumentID string `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title      string `json:"title" example:"Biên bản họp.docx"`
	UpdatedAt  string `json:"updated_at" example:"2026-10-08T09:00:00Z"`
}

// OfficeFrameRecentsSDO is GET
// /api/v1/office-frame/documents/{documentID}/recents. Opening one of them
// goes through the host, which mints a new token for that document.
type OfficeFrameRecentsSDO struct {
	Items []OfficeFrameRecentDTO `json:"items"`
}

// OfficeFrameAssetURLDTO is one signed image URL. The URL carries its own
// short-lived signature bound to this asset, document and user, so an <img>
// in the frame can load it without a header.
type OfficeFrameAssetURLDTO struct {
	AssetID   string `json:"asset_id" example:"01J8X4AST0N1P2Q3R4S5T6U7V8"`
	URL       string `json:"url" description:"Route first-party có chữ ký ngắn hạn" example:"/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=oft1.abc"`
	ExpiresAt string `json:"expires_at" example:"2026-10-08T10:10:00Z"`
}

// OfficeFrameAssetSDO is POST /api/v1/office-frame/documents/{documentID}/assets.
type OfficeFrameAssetSDO struct {
	AssetID    string `json:"asset_id" example:"01J8X4AST0N1P2Q3R4S5T6U7V8"`
	DocumentID string `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	MimeType   string `json:"mime_type" example:"image/png"`
	SizeBytes  int64  `json:"size_bytes" example:"102400"`
	Width      *int32 `json:"width,omitempty" example:"1280"`
	Height     *int32 `json:"height,omitempty" example:"720"`
	URL        string `json:"url" description:"URL ảnh có chữ ký ngắn hạn" example:"/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=oft1.abc"`
	ExpiresAt  string `json:"expires_at" example:"2026-10-08T10:10:00Z"`
}

// OfficeFrameAssetURLsSDO is POST
// /api/v1/office-frame/documents/{documentID}/assets/sign.
type OfficeFrameAssetURLsSDO struct {
	Items []OfficeFrameAssetURLDTO `json:"items"`
}

// OfficeFrameResolvedPathDTO is one relative path of a resolve call with the
// signed same-origin URL it now loads from.
type OfficeFrameResolvedPathDTO struct {
	Path      string `json:"path" description:"Đường dẫn đúng như gửi lên" example:"assets/logo.png"`
	URL       string `json:"url" description:"Route first-party có chữ ký (asset của tài liệu hoặc file cùng thư mục)" example:"/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=ofa1.abc"`
	ExpiresAt string `json:"expires_at" example:"2026-10-08T11:00:00Z"`
}

// OfficeFrameResolvedPathsSDO is POST
// /api/v1/office-frame/documents/{documentID}/assets/resolve: the paths that
// resolve, in request order; a path that resolves to nothing is absent.
type OfficeFrameResolvedPathsSDO struct {
	Items []OfficeFrameResolvedPathDTO `json:"items"`
}

// OfficeFrameAIGrantSDO is the AI part of a frame token answer (UNI-1014, ADR
// 0029): which AI capabilities the host may grant the frame for this
// document. Read once at mint from GO-A7's entitlement checks; every AI route
// on the frame mount still checks membership, entitlement and credits itself.
type OfficeFrameAIGrantSDO struct {
	AI              bool `json:"ai" description:"Khung được bật AI (BYOK qua /office-frame/.../ai): tổ chức có office.ai_byok và kho khóa đã cấu hình" example:"true"`
	WebSearch       bool `json:"web_search" description:"Tìm web đám mây UniWork (chỉ khi ai=true và gói có office.ai_cloud)" example:"true"`
	ImageSearch     bool `json:"image_search" description:"Tìm ảnh đám mây UniWork (chỉ khi ai=true và gói có office.ai_cloud)" example:"false"`
	ImageGeneration bool `json:"image_generation" description:"Sinh ảnh và phân tích media đám mây UniWork (chỉ khi ai=true và gói có office.ai_cloud)" example:"false"`
}
