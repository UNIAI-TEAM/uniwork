package sdi

// ListSharedTrashSDI is the query of GET /workspaces/{workspaceID}/trash. The
// same kind, q and trashed_by go with every page: the cursor only marks the
// position.
type ListSharedTrashSDI struct {
	Kind      string `query:"kind" enum:"task,project,document" description:"Chỉ một loại; bỏ trống là mọi loại. Giá trị khác -> 400 invalid_filter" example:"project"`
	Q         string `query:"q" description:"Tìm theo tên, không phân biệt hoa thường" example:"báo cáo"`
	TrashedBy string `query:"trashed_by" description:"ULID người xoá" example:"01J8X4USERN1P2Q3R4S5T6U7"`
	Cursor    string `query:"cursor" description:"next_cursor của trang trước; bỏ trống cho trang đầu. Hỏng -> 400" example:"eyJ0IjoiMTc5MDAwMDAwMDAwMDAwMC4wMUo4WDRUQVNLIn0"`
}
