package sdi

// ListSharedTrashSDI is the query of GET /workspaces/{workspaceID}/trash. The
// same kind, q and trashed_by go with every page: the cursor only marks the
// position.
type ListSharedTrashSDI struct {
	Kind      []string `query:"kind" description:"Lọc theo loại, lặp tham số để chọn nhiều loại (?kind=task&kind=project); mỗi giá trị là task, project hoặc document, các giá trị cộng nhau (OR) và loại không chọn thì không đọc. Bỏ trống là mọi loại; giá trị lạ hoặc rỗng -> 400 invalid_filter" example:"[\"task\",\"project\"]"`
	Q         string   `query:"q" description:"Tìm theo tên hiển thị trên dòng (lô công việc: tên công việc gốc), không phân biệt hoa thường và dấu" example:"báo cáo"`
	TrashedBy []string `query:"trashed_by" description:"Lọc theo người xóa, lặp tham số để chọn nhiều người (?trashed_by=a&trashed_by=b); mỗi giá trị là ULID người xóa, các giá trị cộng nhau (OR). Bỏ trống là mọi người; giá trị rỗng hoặc quá 100 giá trị -> 400 invalid_filter" example:"[\"01J8X4USERN1P2Q3R4S5T6U7\"]"`
	Cursor    string   `query:"cursor" description:"next_cursor của trang trước; bỏ trống cho trang đầu. Hỏng -> 400" example:"eyJ0IjoiMTc5MDAwMDAwMDAwMDAwMC4wMUo4WDRUQVNLIn0"`
}
