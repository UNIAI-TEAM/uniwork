package sdo

// CalendarEventSDO is one item in GET …/calendar/events.
type CalendarEventSDO struct {
	ID        string  `json:"id" description:"Prefixed id task:{id} hoặc meeting:{id}" example:"task:01HXYZ"`
	Kind      string  `json:"kind" description:"task | meeting" example:"task"`
	EntityID  string  `json:"entity_id" description:"Id thực thể gốc" example:"01HXYZ"`
	Title     string  `json:"title" example:"Viết tài liệu"`
	Start     string  `json:"start" description:"YYYY-MM-DD (all-day) hoặc RFC3339" example:"2026-09-10"`
	End       *string `json:"end,omitempty" description:"All-day: exclusive end (due+1); meeting: RFC3339" example:"2026-09-11"`
	AllDay    bool    `json:"all_day" example:"true"`
	Status    *string `json:"status,omitempty" example:"todo"`
	Priority  *string `json:"priority,omitempty" example:"high"`
	ProjectID *string `json:"project_id,omitempty" example:"01HPROJ"`
}

// CalendarEventListSDO is GET /api/v1/workspaces/{workspaceID}/calendar/events.
type CalendarEventListSDO struct {
	Events []CalendarEventSDO `json:"events"`
}
