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
	// UniworkAI is UniWork AI for this document (G6-03c); it does not need
	// ai (BYOK).
	UniworkAI bool `json:"uniwork_ai" description:"UniWork AI cho tài liệu này: thành viên, gói có office.ai_cloud, server đã cấu hình UniWork AI, office_ai_uniwork và office_ai_uniwork_<định dạng của tài liệu> bật; không cần office.ai_byok hay kho khóa" example:"true"`
}

// OfficeFrameSourceTokenSDO is POST
// /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/office/frame-token
// (UNI-1869): the source file's view-only frame credential. It carries a
// "source" principal instead of a document, can_edit is always false and
// readonly always true, and there is no AI grant: a source frame opens only
// /api/v1/office-frame/sources/* and gets no /ai/* access.
type OfficeFrameSourceTokenSDO struct {
	Token          string `json:"token" description:"Token khung nguồn ngắn hạn (Authorization: Bearer cho /api/v1/office-frame/sources/*)" example:"ofs1.eyJ2IjoxfQ.c2ln"`
	TokenType      string `json:"token_type" description:"Luôn Bearer" example:"Bearer"`
	ExpiresAt      string `json:"expires_at" description:"Hạn token (RFC3339); trước hạn host cấp lại bằng phiên của nó" example:"2026-10-17T09:10:00Z"`
	ExpiresIn      int    `json:"expires_in" description:"Số giây còn lại khi cấp" example:"600"`
	SourceID       string `json:"source_id" description:"Id tệp nguồn duy nhất token mở được, dạng <source>:<ULID dòng gốc>" example:"chat:01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	ParentKind     string `json:"parent_kind" description:"Loại nơi chứa tệp: chat_channel, chat_dm, task, task_comment, meeting hoặc email_thread" example:"chat_dm"`
	ParentID       string `json:"parent_id" description:"ULID của nơi chứa tệp (kênh/hội thoại, công việc, cuộc họp hoặc luồng email)" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	WorkspaceID    string `json:"workspace_id" description:"ULID workspace mà mint đã được cấp phép trong đó" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	OrganizationID string `json:"organization_id" description:"ULID tổ chức của tệp nguồn" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	CanEdit        bool   `json:"can_edit" description:"Luôn false: khung nguồn chỉ xem" example:"false"`
	Module         string `json:"module" description:"Module web genoffice mở tệp nguồn, suy từ định dạng đã lưu: docs, pdf, markdown, html, slides, sheets" example:"docs"`
	ReadOnly       bool   `json:"readonly" description:"Luôn true: khung nguồn chỉ xem theo cấu trúc (không route ghi nào nhận token ofs1.)" example:"true"`
}

// OfficeFrameSourceFileDTO is the current file of a source, as the frame reads
// it: a source exposes no file_id, version_id or checksum, so those are left
// out on purpose.
type OfficeFrameSourceFileDTO struct {
	Version   int32  `json:"version" description:"Bản hiện hành (luôn 1 với tệp nguồn)" example:"1"`
	Filename  string `json:"filename" description:"Tên tệp kèm phần mở rộng" example:"Báo cáo quý 3.docx"`
	MimeType  string `json:"mime_type" description:"MIME type đã xác minh (email: theo thư)" example:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"`
	SizeBytes int64  `json:"size_bytes" description:"Kích thước byte đã lưu của nguồn" example:"48213"`
}

// OfficeFrameSourceSDO is the frame's view of its source file: GET
// /api/v1/office-frame/sources/{sourceFileID} (UNI-1869). It mirrors the field
// names OfficeFrameDocumentSDO gives the frame client, with source_id and
// principal="source" in place of document_id. download_url is a first-party
// route read with the same source token; there is no assets map (md/html
// relative references stay unresolved in v1, OQ-2).
type OfficeFrameSourceSDO struct {
	SourceID       string                   `json:"source_id" description:"Id tệp nguồn dạng <source>:<ULID dòng gốc>" example:"chat:01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	Principal      string                   `json:"principal" description:"Luôn source: khung này mở một tệp nguồn, không phải Document" example:"source"`
	WorkspaceID    string                   `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	OrganizationID string                   `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	Title          string                   `json:"title" description:"Tên tệp nguồn (dùng làm tiêu đề khung)" example:"Báo cáo quý 3.docx"`
	Revision       string                   `json:"revision" description:"Luôn 0: tệp nguồn không có revision của tài liệu" example:"0"`
	Module         string                   `json:"module" description:"Module web của token: docs, pdf, markdown, html, slides, sheets" example:"docs"`
	CanEdit        bool                     `json:"can_edit" description:"Luôn false" example:"false"`
	ReadOnly       bool                     `json:"readonly" description:"Luôn true" example:"true"`
	Parent         DocumentSourceParentDTO  `json:"parent" description:"Nơi chứa tệp nguồn"`
	File           OfficeFrameSourceFileDTO `json:"file" description:"Tệp hiện hành của nguồn"`
	DownloadURL    string                   `json:"download_url" description:"Route tải byte của nguồn, đọc bằng chính token khung nguồn" example:"/api/v1/office-frame/sources/chat%3A01J8X4MSG0N1P2Q3R4S5T6U7V8/content"`
	UpdatedAt      string                   `json:"updated_at" description:"Thời điểm tệp xuất hiện ở nguồn (RFC 3339 UTC)" example:"2026-10-17T08:00:00Z"`
}
