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
	WorkspaceID string  `json:"workspace_id" description:"Workspace của báo cáo" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	FolderID    *string `json:"folder_id" description:"Thư mục gốc; null khi phạm vi là cả workspace" example:"01J8X4FLD0N1P2Q3R4S5T6U7"`
	FolderTitle *string `json:"folder_title" description:"Tên thư mục gốc; null khi phạm vi là cả workspace" example:"Hợp đồng"`
}

// DocumentAccessReportFilterDTO is the filter in effect.
type DocumentAccessReportFilterDTO struct {
	PersonID   *string  `json:"person_id" description:"Người đang lọc; null = mọi người" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level      []string `json:"level" description:"Các mức đang lọc; rỗng = mọi mức" example:"[\"edit\",\"manage\"]"`
	Visibility *string  `json:"visibility" description:"workspace, restricted hoặc null = mọi phạm vi" example:"restricted"`
	// UNI-2039 S4: the order the page walks.
	Sort  string `json:"sort" description:"Khóa sắp xếp đang dùng: changed hoặc title" example:"changed"`
	Order string `json:"order" description:"Chiều sắp xếp đang dùng: asc hoặc desc" example:"desc"`
	// UNI-2039 S5: the filters on top of person_id/level/visibility.
	Q          *string  `json:"q" description:"Từ khóa tìm theo tiêu đề hoặc tên principal; null = không lọc" example:"hợp đồng"`
	Principal  *string  `json:"principal" description:"<type>:<id> đang lọc (user:<id> khi lọc person_id); null = không lọc" example:"workspace:01J8X4WS9N1P2Q3R4S5T6U7V8"`
	Scope      *string  `json:"scope" description:"restricted, workspace, organization hoặc null" example:"organization"`
	Source     []string `json:"source" description:"Các nguồn đang lọc; rỗng = mọi nguồn" example:"[\"direct\",\"chat\"]"`
	Flag       *string  `json:"flag" description:"public_link, outside_workspace, direct_manage hoặc null" example:"public_link"`
	NonDefault bool     `json:"non_default" description:"true khi chỉ hiện quyền khác mặc định" example:"false"`
}

// DocumentAccessReportDocumentDTO is one listed document with its rows.
type DocumentAccessReportDocumentDTO struct {
	Document DocumentAccessReportDocumentInfoDTO `json:"document" description:"Thông tin tài liệu"`
	Rows     []DocumentAccessReportRowDTO        `json:"rows" description:"Mỗi dòng là một đường cấp quyền: chủ sở hữu ACL, thành viên workspace, hoặc một chia sẻ sống"`
}

// DocumentAccessReportDocumentInfoDTO is the document block of one report entry.
type DocumentAccessReportDocumentInfoDTO struct {
	ID            string                        `json:"id" description:"Id tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title         string                        `json:"title" description:"Tên tài liệu" example:"Hợp đồng ABC"`
	Kind          string                        `json:"kind" description:"page, file, folder, ... (chuỗi mở)" example:"file"`
	Visibility    string                        `json:"visibility" description:"workspace hoặc restricted (chuỗi mở)" example:"restricted"`
	Path          []DocumentPathItemSDO         `json:"path" description:"Tổ tiên từ gốc tới cha trực tiếp; dừng ở tổ tiên đầu tiên người gọi không đọc được" example:"[{\"id\":\"01J8X4FLD0N1P2Q3R4S5T6U7\",\"title\":\"Hợp đồng\"}]"`
	ACLOwner      *DocumentAccessReportOwnerDTO `json:"acl_owner" description:"Chủ sở hữu ACL; null khi không có"`
	PersonLevel   *string                       `json:"person_level,omitempty" description:"Chỉ có khi lọc person_id: mức của người đó trên tài liệu (none, view, comment, edit, manage)" example:"edit"`
	LiveLinkCount int                           `json:"live_link_count" description:"Số liên kết công khai còn sống (chưa thu hồi, chưa hết hạn)" example:"1"`
	UpdatedAt     string                        `json:"updated_at" description:"Lần sửa cuối, RFC3339 UTC" example:"2026-10-14T09:00:00Z"`
	// UNI-2039 S1: the redesign fields. All additive.
	GeneralScope    DocumentAccessReportGeneralScopeDTO `json:"general_scope" description:"Phạm vi chung của tài liệu: restricted, workspace hoặc organization (khi có chia sẻ tổ chức sống), kèm mức"`
	Flags           []string                            `json:"flags" description:"Cờ cảnh báo: public_link, other_workspace, organization, direct_manage (chuỗi mở)" example:"[\"public_link\"]"`
	AccessChangedAt string                              `json:"access_changed_at" description:"Lần đổi quyền gần nhất (tài liệu tạo, chia sẻ/link/break-glass cấp hoặc thu hồi), RFC3339 UTC" example:"2026-10-14T09:00:00Z"`
	MyLevel         string                              `json:"my_level" description:"Mức của người gọi trên tài liệu (view, comment, edit, manage, none); dùng mở bảng chia sẻ" example:"manage"`
	AdminScope      bool                                `json:"admin_scope" description:"Người gọi quản lý tài liệu hạn chế qua AdminScope (không qua quyền đọc)" example:"false"`
}

// DocumentAccessReportGeneralScopeDTO is the document's general access.
type DocumentAccessReportGeneralScopeDTO struct {
	Kind  string  `json:"kind" description:"restricted, workspace hoặc organization (chuỗi mở)" example:"workspace"`
	Level *string `json:"level" description:"Mức của dòng workspace hoặc tổ chức; null khi restricted" example:"view"`
}

// DocumentAccessReportRevokeTargetDTO names the existing DELETE route a row is revoked through.
type DocumentAccessReportRevokeTargetDTO struct {
	Kind string `json:"kind" description:"share, link hoặc break_glass: chọn route DELETE .../shares|links|break-glass/{id} có sẵn (chuỗi mở)" example:"share"`
	ID   string `json:"id" description:"Id chia sẻ, link hoặc grant break-glass để thu hồi" example:"01J8X4SHAREN1P2Q3R4S5T6U7"`
}

// DocumentAccessReportOwnerDTO names the ACL owner; name only, never email.
type DocumentAccessReportOwnerDTO struct {
	ID   string  `json:"id" description:"Id người dùng chủ sở hữu ACL" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Name *string `json:"name" description:"Tên hiển thị; null nếu tài khoản không còn" example:"Nguyễn An"`
}

// DocumentAccessReportRowDTO is one grant row: document x principal x level.
type DocumentAccessReportRowDTO struct {
	Source         string  `json:"source" description:"acl_owner, workspace (thành viên workspace trên tài liệu hiển thị workspace), share, break_glass; giá trị lạ hiển thị là Khác" example:"share"`
	Via            string  `json:"via" description:"member, share hoặc break_glass (chuỗi mở)" example:"share"`
	PrincipalType  string  `json:"principal_type" description:"user, workspace hoặc organization" example:"workspace"`
	PrincipalID    string  `json:"principal_id" description:"Id người dùng, workspace hoặc tổ chức được cấp" example:"01J8X4WS9N1P2Q3R4S5T6U7V8"`
	PrincipalName  *string `json:"principal_name" description:"Tên hiển thị (không email); null nếu không còn" example:"Pháp chế"`
	Level          string  `json:"level" description:"Mức đường này cấp: view, comment, edit, manage (chuỗi mở)" example:"view"`
	EffectiveLevel string  `json:"effective_level" description:"user: mức thực của người đó trên tài liệu; workspace/organization: mức mọi thành viên nhóm cùng nhận được từ tài liệu; none nếu không còn" example:"view"`
	Active         bool    `json:"active" description:"Đường cấp còn tới được ai đó không (người bị vô hiệu hóa, workspace rời tổ chức -> false)" example:"true"`
	GrantedBy      *string `json:"granted_by" description:"Người cấp; null với dòng ngầm định" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	GrantedByName  *string `json:"granted_by_name" description:"Tên người cấp; null nếu không có" example:"Nguyễn An"`
	GrantedByKind  *string `json:"granted_by_kind" description:"human, agent hoặc system; null với dòng ngầm định" example:"human"`
	GrantedAt      *string `json:"granted_at" description:"Thời điểm cấp, RFC3339 UTC; null với dòng ngầm định" example:"2026-10-10T03:00:00Z"`
	ShareID        *string `json:"share_id" description:"Id chia sẻ để mở bảng chia sẻ; null với dòng không phải share" example:"01J8X4SHAREN1P2Q3R4S5T6U7"`
	// UNI-2039 S1-S3: additive.
	RevokeTarget *DocumentAccessReportRevokeTargetDTO `json:"revoke_target" description:"Route thu hồi dòng này; null với chủ sở hữu, mặc định workspace hoặc khi người gọi không thu hồi được. Chỉ là gợi ý hiện nút: gate của service quyết định"`
	Origin       *string                              `json:"origin,omitempty" description:"Chỉ có ở dòng share: direct hoặc chat (chuỗi mở); không có tên kênh" example:"direct"`
	ExpiresAt    *string                              `json:"expires_at" description:"Hạn của dòng, RFC3339 UTC; chỉ dòng link có giá trị, còn lại null" example:"2026-11-14T09:00:00Z"`
}

// DocumentAccessReportSummaryDTO counts one page.
type DocumentAccessReportSummaryDTO struct {
	Candidates int `json:"candidates" description:"Tài liệu ứng viên đã đọc trên trang này" example:"50"`
	Documents  int `json:"documents" description:"Tài liệu được liệt kê trên trang này" example:"48"`
	Rows       int `json:"rows" description:"Số dòng quyền trên trang này" example:"131"`
	Skipped    int `json:"skipped" description:"Tài liệu người gọi đọc được nhưng không quản lý trên trang này (không liệt kê)" example:"2"`
}

// DocumentAccessReportSummaryResultSDO is GET .../access-report/summary
// (UNI-2039 S6): the tiles depend on the scope only, matching_documents on the
// filters too.
type DocumentAccessReportSummaryResultSDO struct {
	GeneratedAt       string                       `json:"generated_at" description:"Thời điểm snapshot, RFC3339 UTC" example:"2026-10-21T03:40:00Z"`
	Tiles             DocumentAccessReportTilesDTO `json:"tiles" description:"Số liệu theo phạm vi, không theo bộ lọc, để số không nhảy khi lọc"`
	MatchingDocuments int                          `json:"matching_documents" description:"Số tài liệu khớp bộ lọc (và người gọi quản lý)" example:"11"`
	Skipped           int                          `json:"skipped" description:"Tài liệu người gọi đọc được nhưng chỉ xem, không có trong báo cáo (toàn phạm vi)" example:"2"`
	Truncated         bool                         `json:"truncated" description:"true khi quét chạm trần 10.000 tài liệu: số chỉ là phần đã quét" example:"false"`
}

// DocumentAccessReportTilesDTO are the whole-scope counts of managed documents.
type DocumentAccessReportTilesDTO struct {
	PublicLink       int `json:"public_link" description:"Tài liệu có ít nhất một link công khai sống" example:"3"`
	OutsideWorkspace int `json:"outside_workspace" description:"Tài liệu chia sẻ sống tới workspace khác hoặc cả tổ chức" example:"2"`
	DirectManage     int `json:"direct_manage" description:"Tài liệu có quyền Quản lý cấp riêng cho người hoặc nhóm khác chủ sở hữu" example:"4"`
	Documents        int `json:"documents" description:"Tài liệu người gọi quản lý trong phạm vi" example:"11"`
	Restricted       int `json:"restricted" description:"Trong đó phạm vi chung restricted" example:"5"`
	Workspace        int `json:"workspace" description:"Trong đó phạm vi chung workspace" example:"4"`
	Organization     int `json:"organization" description:"Trong đó phạm vi chung organization" example:"2"`
}

// DocumentAccessReportPrincipalsSDO is GET .../access-report/principals
// (UNI-2039 S7). Not paginated; at most 500 principals.
type DocumentAccessReportPrincipalsSDO struct {
	GeneratedAt string                             `json:"generated_at" description:"Thời điểm snapshot, RFC3339 UTC" example:"2026-10-21T03:40:00Z"`
	Principals  []DocumentAccessReportPrincipalDTO `json:"principals" description:"Mỗi principal một dòng, theo sort/order"`
	Truncated   bool                               `json:"truncated" description:"true khi có hơn 500 principal hoặc quét chạm trần tài liệu" example:"false"`
}

// DocumentAccessReportPrincipalDTO is one principal of the by-person view.
type DocumentAccessReportPrincipalDTO struct {
	PrincipalType string                            `json:"principal_type" description:"user, workspace, organization hoặc link" example:"user"`
	PrincipalID   *string                           `json:"principal_id" description:"Id principal; null với 'ai có link'" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	PrincipalName *string                           `json:"principal_name" description:"Tên hiển thị (không email); null nếu không còn hoặc là link" example:"Nguyễn An"`
	Kind          string                            `json:"kind" description:"member, home_workspace, other_workspace, organization hoặc link (chuỗi mở)" example:"member"`
	MemberCount   *int                              `json:"member_count" description:"Số thành viên của nhóm; null với người và link" example:"12"`
	DocumentCount int                               `json:"document_count" description:"Số tài liệu người gọi quản lý mà principal có dòng" example:"7"`
	Levels        DocumentAccessReportLevelSplitDTO `json:"levels" description:"Số tài liệu theo mức cao nhất của principal trên tài liệu đó"`
	MainSource    string                            `json:"main_source" description:"owner, workspace, direct, chat, link hoặc break_glass: nguồn xuất hiện nhiều nhất; hòa thì direct > chat > link > workspace > owner (chuỗi mở)" example:"direct"`
}

// DocumentAccessReportLevelSplitDTO counts documents per level.
type DocumentAccessReportLevelSplitDTO struct {
	View    int `json:"view" description:"Tài liệu ở mức view" example:"3"`
	Comment int `json:"comment" description:"Tài liệu ở mức comment" example:"1"`
	Edit    int `json:"edit" description:"Tài liệu ở mức edit" example:"2"`
	Manage  int `json:"manage" description:"Tài liệu ở mức manage" example:"1"`
}
