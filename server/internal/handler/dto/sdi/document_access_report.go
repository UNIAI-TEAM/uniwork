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
	Sort       *string `query:"sort" description:"Khóa sắp xếp: changed (mặc định, lần đổi quyền gần nhất) hoặc title. Giá trị lạ -> 400" example:"changed"`
	Order      *string `query:"order" description:"asc hoặc desc; mặc định desc với changed, asc với title. Giá trị lạ -> 400" example:"desc"`
	Q          *string `query:"q" description:"Tìm theo tiêu đề tài liệu hoặc tên principal (chỉ principal người gọi thấy trên dòng đó), không phân biệt hoa thường và dấu, tối đa 100 ký tự" example:"hợp đồng"`
	Principal  *string `query:"principal" description:"<type>:<id> với type user|workspace|organization|link; link không kèm id = ai có link. person_id là bí danh của user:<id>. user:<id> là bộ lọc theo người: giữ mọi dòng đang đưa quyền cho người đó (kể cả dòng workspace, tổ chức hoặc nhóm chứa họ) và các tài liệu họ có mức quyền qua nhóm; các loại khác (workspace, organization, link) là bộ lọc dòng chặt, chỉ giữ dòng đúng principal đó" example:"user:01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Scope      *string `query:"scope" description:"Phạm vi chung của tài liệu: restricted, workspace hoặc organization" example:"organization"`
	Source     *string `query:"source" description:"Nguồn dòng, cách nhau bằng dấu phẩy: owner, workspace, direct, chat, link, break_glass" example:"direct,chat"`
	Flag       *string `query:"flag" description:"Cờ cảnh báo của tài liệu: public_link, outside_workspace hoặc direct_manage" example:"public_link"`
	NonDefault *string `query:"non_default" description:"1 = bỏ tài liệu chỉ có dòng chủ sở hữu và dòng workspace mặc định, và bỏ hai loại dòng đó khỏi các tài liệu còn lại" example:"1"`
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
	Q          *string `query:"q" description:"Như trang: tìm theo tiêu đề hoặc tên principal" example:"hợp đồng"`
	Principal  *string `query:"principal" description:"Như trang: <type>:<id>" example:"user:01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Scope      *string `query:"scope" description:"restricted, workspace hoặc organization" example:"organization"`
	Source     *string `query:"source" description:"owner, workspace, direct, chat, link, break_glass (dấu phẩy)" example:"direct"`
	Flag       *string `query:"flag" description:"public_link, outside_workspace hoặc direct_manage" example:"public_link"`
	NonDefault *string `query:"non_default" description:"1 = chỉ quyền khác mặc định" example:"1"`
	Format     string  `query:"format" description:"Định dạng tệp: csv hoặc xlsx (bắt buộc)" example:"xlsx"`
}

// DocumentAccessReportSummaryQuerySDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/access-report/summary (UNI-2039
// S6): the whole-scope tiles and the count of documents the filters match.
type DocumentAccessReportSummaryQuerySDI struct {
	FolderID   *string `query:"folder_id" description:"ULID thư mục gốc (gồm thư mục con); bỏ trống = cả workspace" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	PersonID   *string `query:"person_id" description:"Bí danh của principal=user:<id>" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level      *string `query:"level" description:"Lọc theo mức của dòng (dấu phẩy); chỉ đổi matching_documents" example:"view,edit"`
	Visibility *string `query:"visibility" description:"workspace hoặc restricted; chỉ đổi matching_documents" example:"workspace"`
	Q          *string `query:"q" description:"Như trang; chỉ đổi matching_documents" example:"hợp đồng"`
	Principal  *string `query:"principal" description:"Như trang; chỉ đổi matching_documents" example:"link"`
	Scope      *string `query:"scope" description:"Như trang; chỉ đổi matching_documents" example:"organization"`
	Source     *string `query:"source" description:"Như trang; chỉ đổi matching_documents" example:"direct"`
	Flag       *string `query:"flag" description:"Như trang; chỉ đổi matching_documents" example:"public_link"`
	NonDefault *string `query:"non_default" description:"Như trang; chỉ đổi matching_documents" example:"1"`
}

// DocumentAccessReportPrincipalsSDI documents GET
// /api/v1/workspaces/{workspaceID}/documents/access-report/principals
// (UNI-2039 S7): one row per principal the caller sees on a document they
// manage, with the document count and the level split.
type DocumentAccessReportPrincipalsSDI struct {
	FolderID *string `query:"folder_id" description:"ULID thư mục gốc (gồm thư mục con); bỏ trống = cả workspace" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	Q        *string `query:"q" description:"Tìm theo tên principal, không phân biệt hoa thường và dấu, tối đa 100 ký tự" example:"nguyễn"`
	Kind     *string `query:"kind" description:"member, home_workspace, other_workspace, organization hoặc link" example:"member"`
	Level    *string `query:"level" description:"Chỉ tính dòng ở các mức này (dấu phẩy): view, comment, edit, manage" example:"edit,manage"`
	Sort     *string `query:"sort" description:"count (mặc định, số tài liệu) hoặc name" example:"count"`
	Order    *string `query:"order" description:"asc hoặc desc; mặc định desc với count, asc với name" example:"desc"`
}
