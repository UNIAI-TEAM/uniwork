package sdi

// SDI types for the Office surface (plan G2-07 / UNI-690; C-01 §6.2). The
// client chooses an operation from the allowlist and never an engine route,
// a storage key or an engine address: the server picks the engine endpoint
// and the output target. base_revision is the decimal revision string the
// writer saw (same encoding as the other document writes).

// StartOfficeJobSDI is POST /api/v1/documents/{documentID}/office/jobs
// (+ Idempotency-Key header). operation is one of open, serialize, export,
// convert; export and convert answer unsupported_operation until an engine
// lane binds it; convert (Q7, G2-07b) takes target_format - xlsx for an xls
// document, docx for an odt one - and stages an OOXML output plus a change
// list that POST .../copies with job_id accepts. format is optional and, when
// present, must match the document's format.
type StartOfficeJobSDI struct {
	Operation    string  `json:"operation" description:"open | serialize | export | convert" example:"serialize"`
	Format       *string `json:"format" description:"docx | xlsx | pptx | pdf | md | html | xls | odt; phải khớp định dạng tài liệu" example:"md"`
	BaseRevision *string `json:"base_revision" description:"Revision nền dạng chuỗi thập phân client thấy; bỏ trống = revision hiện tại" example:"41"`
	ModelRef     *string `json:"document_model_ref" description:"Tham chiếu document model của editor; chỉ dùng cho serialize" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	TargetFormat *string `json:"target_format" description:"Định dạng đích của convert: xlsx cho xls, docx cho odt; thao tác khác bỏ trống" example:"xlsx"`
}

// CreateBlankDocumentFileSDI is POST
// /api/v1/workspaces/{workspaceID}/documents/files/blank (+ Idempotency-Key
// header): creates a new document whose first version holds bytes the engine
// produced. Only formats with a blank generator are accepted (md, html, xlsx);
// any other format answers unsupported_operation and stores nothing.
type CreateBlankDocumentFileSDI struct {
	Format   string  `json:"format" description:"md, html hoặc xlsx; định dạng khác trả unsupported_operation" example:"md"`
	Title    string  `json:"title" minLength:"1" description:"Tiêu đề tài liệu, 1-500 ký tự" example:"Ghi chú họp"`
	ParentID *string `json:"parent_id" description:"ULID trang cha cùng workspace; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
}

// CopyDocumentSDI is POST /api/v1/documents/{documentID}/copies
// (+ Idempotency-Key header). consent must be "copy": a copy that could lose
// or re-scope content is an explicit choice (C-01 §14.4). The copy keeps the
// source's acl_owner_id, visibility and live share rows; the caller needs
// edit on the source.
type CopyDocumentSDI struct {
	Consent  string  `json:"consent" description:"Bắt buộc \"copy\"; thiếu hoặc khác trả copy_consent_required" example:"copy"`
	Title    *string `json:"title" description:"Tiêu đề bản sao; bỏ trống = \"<nguồn> (bản sao)\"" example:"Kế hoạch Q4 (bản sao)"`
	ParentID *string `json:"parent_id" description:"ULID trang cha cho bản sao; bỏ trống = gốc" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	JobID    *string `json:"job_id" description:"Chấp nhận job convert đã completed của tài liệu này: bản sao là output OOXML kèm provenance; bỏ trống = bản sao cùng định dạng" example:"01J8X4JOB0N1P2Q3R4S5T6U7V8"`
}
