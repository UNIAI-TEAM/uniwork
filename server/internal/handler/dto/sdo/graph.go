package sdo

// GraphNodeDTO is a node as the panel shows it; the client builds its link.
type GraphNodeDTO struct {
	Type          string `json:"type" description:"Loại node trong catalogue" example:"TASK"`
	ID            string `json:"id" description:"ULID bản ghi nguồn" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Subtype       string `json:"subtype" description:"member hoặc agent (ACTOR), chat_room hoặc email_thread (THREAD); rỗng với loại khác" example:"member"`
	Title         string `json:"title" description:"Tiêu đề ở lần chiếu gần nhất" example:"Viết spec"`
	Status        string `json:"status" description:"Trạng thái nguồn ở lần chiếu gần nhất" example:"todo"`
	WorkspaceID   string `json:"workspace_id" description:"Workspace của node; rỗng với node cấp tổ chức" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	WorkspaceSlug string `json:"workspace_slug" description:"Slug workspace để dựng đường dẫn" example:"team"`
	Deleted       bool   `json:"deleted" description:"Nguồn đã xoá; chỉ gặp trong lịch sử, với ACTOR và TEAM" example:"false"`
}

// GraphNeighborDTO is one open edge seen from the root node.
type GraphNeighborDTO struct {
	EdgeType   string       `json:"edge_type" description:"Loại cạnh" example:"ORIGINATED_FROM"`
	Direction  string       `json:"direction" description:"out: node gốc là đầu từ; in: node gốc là đầu tới" example:"out"`
	Origin     string       `json:"origin" description:"SYSTEM, HUMAN, AI_CONFIRMED hoặc AI_SUGGESTED" example:"SYSTEM"`
	ValidFrom  string       `json:"valid_from" description:"Thời điểm nghiệp vụ cạnh bắt đầu (RFC 3339)" example:"2026-10-07T03:00:00Z"`
	Backfilled bool         `json:"backfilled" description:"Cạnh có từ lần dựng lại đầu tiên; valid_from là thời điểm của nguồn, không phải lúc quan hệ bắt đầu" example:"false"`
	Node       GraphNodeDTO `json:"node" description:"Node ở đầu kia"`
}

type GraphNeighborsSDO struct {
	Node       GraphNodeDTO       `json:"node" description:"Node gốc"`
	Items      []GraphNeighborDTO `json:"items" description:"Hàng xóm, mới nhất trước"`
	NextCursor string             `json:"next_cursor,omitempty" description:"Truyền làm cursor để đọc trang sau" example:"1791331200000000.01J8X4EDGE00000000000000000"`
}

// GraphHistoryItemDTO is one edge or fact in a node's history.
type GraphHistoryItemDTO struct {
	Kind              string        `json:"kind" description:"edge hoặc fact" example:"edge"`
	EdgeType          string        `json:"edge_type,omitempty" description:"Loại cạnh khi kind = edge" example:"OWNED_BY"`
	FactType          string        `json:"fact_type,omitempty" description:"due hoặc status khi kind = fact" example:"due"`
	Direction         string        `json:"direction,omitempty" description:"out hoặc in khi kind = edge" example:"out"`
	Origin            string        `json:"origin,omitempty" description:"Nguồn gốc" example:"SYSTEM"`
	ValidFrom         string        `json:"valid_from" description:"Bắt đầu hiệu lực (RFC 3339)" example:"2026-10-03T02:00:00Z"`
	ValidTo           string        `json:"valid_to,omitempty" description:"Hết hiệu lực; trống là còn hiệu lực" example:"2026-10-05T02:00:00Z"`
	Value             string        `json:"value,omitempty" description:"Giá trị fact" example:"2026-10-20"`
	Previous          string        `json:"previous,omitempty" description:"Giá trị fact trước đó" example:"2026-10-15"`
	Precision         string        `json:"precision,omitempty" description:"date hoặc datetime với hạn" example:"date"`
	PreviousPrecision string        `json:"previous_precision,omitempty" description:"Độ chính xác của giá trị trước" example:"date"`
	Backfilled        bool          `json:"backfilled" description:"Có từ lần dựng lại đầu tiên" example:"false"`
	Node              *GraphNodeDTO `json:"node,omitempty" description:"Node ở đầu kia khi kind = edge"`
}

type GraphHistorySDO struct {
	Node  GraphNodeDTO          `json:"node" description:"Node gốc"`
	Items []GraphHistoryItemDTO `json:"items" description:"Lịch sử, cũ nhất trước"`
}
