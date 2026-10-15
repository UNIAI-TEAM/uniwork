package sdi

// DocumentAccessReportSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/access-report (UNI-1643): one
// page of the access report over the workspace or one folder (recursive).
// Only documents the caller manages are listed; the rest they can read are
// counted in summary.skipped.
type DocumentAccessReportSDI struct {
	FolderID   *string `query:"folder_id" description:"ULID thư mục gốc (gồm mọi thư mục con, kể cả gốc); bỏ trống = cả workspace. Không dùng được -> 404" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	PersonID   *string `query:"person_id" description:"ULID một người: chỉ giữ dòng quyền tới được người đó, kèm person_level của họ trên từng tài liệu" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level      *string `query:"level" description:"Lọc theo mức của dòng, danh sách cách nhau bằng dấu phẩy: view, comment, edit, manage" example:"edit,manage"`
	Visibility *string `query:"visibility" description:"Lọc tài liệu theo phạm vi hiển thị: workspace hoặc restricted" example:"restricted"`
	Cursor     *string `query:"cursor" description:"next_cursor của trang trước; phải đi cùng đúng folder_id và bộ lọc đã tạo ra nó" example:"eyJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
	Limit      *int32  `query:"limit" description:"Số tài liệu ứng viên mỗi trang, mặc định 50, tối đa 100" example:"50"`
}

// DocumentAccessReportExportSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/access-report/export: the whole
// report as one CSV or XLSX file from one snapshot, same filters as the page.
type DocumentAccessReportExportSDI struct {
	FolderID   *string `query:"folder_id" description:"ULID thư mục gốc (gồm mọi thư mục con, kể cả gốc); bỏ trống = cả workspace" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	PersonID   *string `query:"person_id" description:"ULID một người: chỉ xuất dòng quyền tới được người đó" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level      *string `query:"level" description:"Lọc theo mức của dòng: view, comment, edit, manage (dấu phẩy)" example:"view,edit"`
	Visibility *string `query:"visibility" description:"workspace hoặc restricted" example:"workspace"`
	Format     string  `query:"format" description:"Định dạng tệp: csv hoặc xlsx (bắt buộc)" example:"xlsx"`
}
