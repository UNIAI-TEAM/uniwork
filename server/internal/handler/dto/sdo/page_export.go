package sdo

// PageExportFormatsSDO answers GET /api/v1/documents/{documentID}/export
// (follow-6): the formats the page export renders on this deployment.
type PageExportFormatsSDO struct {
	Formats []string `json:"formats" description:"Định dạng xuất được: docx, và pdf khi engine có bộ dựng Docs" example:"[\"docx\",\"pdf\"]"`
}
