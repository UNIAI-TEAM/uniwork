package sdi

// GraphNeighborsSDI is the query of GET …/graph/nodes/{nodeType}/{nodeID}/neighbors.
type GraphNeighborsSDI struct {
	EdgeTypes string `query:"edge_types" description:"Loại cạnh, phân cách bằng dấu phẩy; trống là mọi loại" example:"ORIGINATED_FROM,OWNED_BY"`
	Direction string `query:"direction" enum:"out,in,both" description:"Chiều nhìn từ node gốc (mặc định both)" example:"both"`
	At        string `query:"at" description:"Lát cắt thời gian RFC 3339 (mặc định bây giờ)" example:"2026-10-07T00:00:00Z"`
	Cursor    string `query:"cursor" description:"next_cursor của trang trước" example:"1791331200000000.01J8X4EDGE00000000000000000"`
	Limit     int32  `query:"limit" description:"Kích thước trang (mặc định 50, tối đa 100)" example:"50"`
}

// GraphHistorySDI is the query of GET …/graph/nodes/{nodeType}/{nodeID}/history.
type GraphHistorySDI struct {
	From string `query:"from" description:"Chỉ lấy mục còn hiệu lực từ thời điểm này (RFC 3339)" example:"2026-10-01T00:00:00Z"`
	To   string `query:"to" description:"Chỉ lấy mục bắt đầu trước thời điểm này (RFC 3339)" example:"2026-10-31T00:00:00Z"`
}
