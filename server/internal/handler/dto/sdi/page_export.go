package sdi

// ExportDocumentPageSDI is POST /api/v1/documents/{documentID}/export
// (UNI-2004): the format a UniNote page is exported to.
type ExportDocumentPageSDI struct {
	Format string `json:"format" enum:"docx,pdf" description:"Định dạng xuất: docx hoặc pdf" example:"docx"`
}
