package sdo

// DocumentAccessReportSDO is one page of the document access report
// (UNI-1643): who holds which level on every document the caller manages in
// the workspace or one folder (recursive). Read-only; no email anywhere.
type DocumentAccessReportSDO struct {
	Scope       DocumentAccessReportScopeDTO      `json:"scope" description:"Phạm vi đã giải: cả workspace hoặc một thư mục (gồm thư mục con)"`
	Filter      DocumentAccessReportFilterDTO     `json:"filter" description:"Bộ lọc đang áp dụng (cùng khối được ghi vào tệp xuất)"`
	GeneratedAt string                            `json:"generated_at" description:"Thời điểm server đọc, RFC3339 UTC" example:"2026-10-15T03:40:00Z"`
	Documents   []DocumentAccessReportDocumentDTO `json:"documents" description:"Tài liệu người gọi quản lý trên trang này, theo id tăng dần"`
	Summary     DocumentAccessReportSummaryDTO    `json:"summary" description:"Số đếm của trang này"`
	NextCursor  *string                           `json:"next_cursor" description:"Cursor trang kế; null khi hết. Trang có thể ngắn hoặc rỗng mà vẫn còn cursor" example:"eyJpZCI6IjAxSjhYNERPQzBOMVAyUTNSNFM1VDZVNyJ9"`
}

// DocumentAccessReportScopeDTO echoes the resolved scope of the report.
type DocumentAccessReportScopeDTO struct {
	Kind        string  `json:"kind" description:"folder hoặc workspace" example:"folder"`
	WorkspaceID string  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	FolderID    *string `json:"folder_id" description:"Thư mục gốc; null khi phạm vi là cả workspace" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	FolderTitle *string `json:"folder_title" description:"Tên thư mục gốc; null khi phạm vi là cả workspace" example:"Hợp đồng"`
}

// DocumentAccessReportFilterDTO is the filter in effect.
type DocumentAccessReportFilterDTO struct {
	PersonID   *string  `json:"person_id" description:"Người đang lọc; null = mọi người" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level      []string `json:"level" description:"Các mức đang lọc; rỗng = mọi mức" example:"[\"edit\",\"manage\"]"`
	Visibility *string  `json:"visibility" description:"workspace, restricted hoặc null = mọi phạm vi" example:"restricted"`
}

// DocumentAccessReportDocumentDTO is one listed document with its rows.
type DocumentAccessReportDocumentDTO struct {
	Document DocumentAccessReportDocumentInfoDTO `json:"document" description:"Thông tin tài liệu"`
	Rows     []DocumentAccessReportRowDTO        `json:"rows" description:"Mỗi dòng là một đường cấp quyền: chủ sở hữu ACL, thành viên workspace, hoặc một chia sẻ sống"`
}

// DocumentAccessReportDocumentInfoDTO is the document block of one report entry.
type DocumentAccessReportDocumentInfoDTO struct {
	ID            string                        `json:"id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title         string                        `json:"title" example:"Hợp đồng ABC"`
	Kind          string                        `json:"kind" description:"page, file, folder, ... (chuỗi mở)" example:"file"`
	Visibility    string                        `json:"visibility" description:"workspace hoặc restricted (chuỗi mở)" example:"restricted"`
	Path          []DocumentPathItemSDO         `json:"path" description:"Tổ tiên từ gốc tới cha trực tiếp; dừng ở tổ tiên đầu tiên người gọi không đọc được" example:"[{\"id\":\"01J8X4FLD0N1P2Q3R4S5T6U7\",\"title\":\"Hợp đồng\"}]"`
	ACLOwner      *DocumentAccessReportOwnerDTO `json:"acl_owner" description:"Chủ sở hữu ACL; null khi không có"`
	PersonLevel   *string                       `json:"person_level,omitempty" description:"Chỉ có khi lọc person_id: mức của người đó trên tài liệu (none, view, comment, edit, manage)" example:"edit"`
	LiveLinkCount int                           `json:"live_link_count" description:"Số liên kết công khai còn sống (chưa thu hồi, chưa hết hạn)" example:"1"`
	UpdatedAt     string                        `json:"updated_at" example:"2026-10-14T09:00:00Z"`
}

// DocumentAccessReportOwnerDTO names the ACL owner; name only, never email.
type DocumentAccessReportOwnerDTO struct {
	ID   string  `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Name *string `json:"name" description:"Tên hiển thị; null nếu tài khoản không còn" example:"Nguyễn An"`
}

// DocumentAccessReportRowDTO is one grant row: document x principal x level.
type DocumentAccessReportRowDTO struct {
	Source         string  `json:"source" description:"acl_owner, workspace (thành viên workspace trên tài liệu hiển thị workspace), share, break_glass; giá trị lạ hiển thị là Khác" example:"share"`
	Via            string  `json:"via" description:"member, share hoặc break_glass (chuỗi mở)" example:"share"`
	PrincipalType  string  `json:"principal_type" description:"user, workspace hoặc organization" example:"workspace"`
	PrincipalID    string  `json:"principal_id" example:"01J8X4WS9N1P2Q3R4S5T6U7V8"`
	PrincipalName  *string `json:"principal_name" description:"Tên hiển thị (không email); null nếu không còn" example:"Pháp chế"`
	Level          string  `json:"level" description:"Mức đường này cấp: view, comment, edit, manage (chuỗi mở)" example:"view"`
	EffectiveLevel string  `json:"effective_level" description:"user: mức thực của người đó trên tài liệu; workspace/organization: mức mọi thành viên nhóm cùng nhận được từ tài liệu; none nếu không còn" example:"view"`
	Active         bool    `json:"active" description:"Đường cấp còn tới được ai đó không (người bị vô hiệu hóa, workspace rời tổ chức -> false)" example:"true"`
	GrantedBy      *string `json:"granted_by" description:"Người cấp; null với dòng ngầm định" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	GrantedByName  *string `json:"granted_by_name" description:"Tên người cấp; null nếu không có" example:"Nguyễn An"`
	GrantedByKind  *string `json:"granted_by_kind" description:"human, agent hoặc system; null với dòng ngầm định" example:"human"`
	GrantedAt      *string `json:"granted_at" description:"Thời điểm cấp, RFC3339 UTC; null với dòng ngầm định" example:"2026-10-10T03:00:00Z"`
	ShareID        *string `json:"share_id" description:"Id chia sẻ để mở bảng chia sẻ; null với dòng không phải share" example:"01J8X4SHAREN1P2Q3R4S5T6U7"`
}

// DocumentAccessReportSummaryDTO counts one page.
type DocumentAccessReportSummaryDTO struct {
	Candidates int `json:"candidates" description:"Tài liệu ứng viên đã đọc trên trang này" example:"50"`
	Documents  int `json:"documents" description:"Tài liệu được liệt kê trên trang này" example:"48"`
	Rows       int `json:"rows" description:"Số dòng quyền trên trang này" example:"131"`
	Skipped    int `json:"skipped" description:"Tài liệu người gọi đọc được nhưng không quản lý trên trang này (không liệt kê)" example:"2"`
}
