package sdi

// ListTrashSDI is the query of GET .../tasks/trash and .../projects/trash.
type ListTrashSDI struct {
	Cursor string `query:"cursor" description:"next_cursor của trang trước; bỏ trống cho trang đầu" example:"1790000000000000.01J8X4TASKN1P2Q3R4S5T6U7"`
}
