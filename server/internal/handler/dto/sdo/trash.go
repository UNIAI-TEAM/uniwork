package sdo

// TrashItemDTO is one row of the shared workspace trash: one task batch, one
// project or one document.
type TrashItemDTO struct {
	Kind          string   `json:"kind" enum:"task,project,document" description:"Loại mục: lô công việc, dự án hoặc tài liệu" example:"task"`
	ID            string   `json:"id" description:"ULID công việc gốc của lô, dự án hoặc tài liệu" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Title         string   `json:"title" description:"Tên hiển thị: công việc gốc của lô, dự án hoặc tài liệu" example:"Soạn hợp đồng"`
	Identifier    string   `json:"identifier" description:"Mã công việc PREFIX-N; rỗng với dự án và tài liệu" example:"UNI-12"`
	SubKind       string   `json:"sub_kind" description:"Tài liệu: page, file hoặc folder; rỗng với loại khác" example:"page"`
	ParentID      string   `json:"parent_id" description:"Tài liệu: ULID thư mục cha; rỗng ở gốc workspace và với loại khác" example:"01J8X4FOLDN1P2Q3R4S5T6U7"`
	Count         int      `json:"count" description:"Công việc: số việc con cùng lô; dự án: số công việc khôi phục sẽ gắn lại; tài liệu: 0" example:"2"`
	LocationTitle string   `json:"location_title" description:"Công việc: dự án của nó (rỗng khi không có); dự án và tài liệu: tên workspace" example:"Website mới"`
	LocationPath  []string `json:"location_path" description:"Tài liệu: tên các thư mục cha, từ gốc; rỗng với loại khác" example:"[\"Pháp chế\"]"`
	TrashedBy     string   `json:"trashed_by" description:"ULID người xóa" example:"01J8X4USERN1P2Q3R4S5T6U7"`
	TrashedAt     string   `json:"trashed_at" description:"RFC 3339" example:"2026-10-26T09:00:00Z"`
	PurgeAfter    string   `json:"purge_after" description:"RFC 3339; sau mốc này mục bị xóa vĩnh viễn" example:"2026-11-25T09:00:00Z"`
	CanManage     bool     `json:"can_manage" description:"Người gọi khôi phục hay xóa vĩnh viễn được: luôn đúng với công việc; dự án cần người tạo, người phụ trách hoặc quản trị viên; tài liệu cần quyền quản lý" example:"true"`
}

// TrashPageSDO is GET /workspaces/{workspaceID}/trash.
type TrashPageSDO struct {
	Items      []TrashItemDTO `json:"items" description:"Các mục của trang, mới xóa trước" example:"[]"`
	NextCursor string         `json:"next_cursor" description:"Con trỏ trang kế (chuỗi mờ); rỗng ở trang cuối" example:"eyJ0IjoiMTc5MDAwMDAwMDAwMDAwMC4wMUo4WDRUQVNLIn0"`
}
