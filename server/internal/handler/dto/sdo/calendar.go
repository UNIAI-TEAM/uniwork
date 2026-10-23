package sdo

// CalendarEventSDO is one item in GET …/calendar/events.
type CalendarEventSDO struct {
	ID          string  `json:"id" description:"Prefixed id task:{id} hoặc meeting:{id}" example:"task:01HXYZ"`
	Kind        string  `json:"kind" description:"task | meeting" example:"task"`
	EntityID    string  `json:"entity_id" description:"Id thực thể gốc" example:"01HXYZ"`
	Title       string  `json:"title" example:"Viết tài liệu"`
	Start       string  `json:"start" description:"YYYY-MM-DD (all-day) hoặc RFC3339" example:"2026-09-10"`
	End         *string `json:"end,omitempty" description:"All-day: exclusive end (due+1); meeting: RFC3339" example:"2026-09-11"`
	AllDay      bool    `json:"all_day" example:"true"`
	Status      *string `json:"status,omitempty" example:"todo"`
	Priority    *string `json:"priority,omitempty" example:"high"`
	ProjectID   *string `json:"project_id,omitempty" example:"01HPROJ"`
	Provider    *string `json:"provider,omitempty" example:"google"`
	ExternalURL *string `json:"external_url,omitempty"`
}

// CalendarEventListSDO is GET /api/v1/workspaces/{workspaceID}/calendar/events.
type CalendarEventListSDO struct {
	Events []CalendarEventSDO `json:"events"`
}

// CalendarSidebarTaskSDO is one task row in GET …/calendar/sidebar sections.
type CalendarSidebarTaskSDO struct {
	ID       string  `json:"id" example:"01HTASK"`
	Title    string  `json:"title" example:"Viết tài liệu"`
	Status   string  `json:"status" example:"todo"`
	Priority *string `json:"priority,omitempty" example:"high"`
	DueDate  *string `json:"due_date,omitempty" description:"YYYY-MM-DD" example:"2026-09-15"`
}

// CalendarSidebarMeetingSDO is one meeting row in the meet_with section.
type CalendarSidebarMeetingSDO struct {
	ID       string `json:"id" example:"01HMEET"`
	Title    string `json:"title" example:"Standup"`
	StartsAt string `json:"starts_at" description:"RFC3339" example:"2026-09-10T03:00:00Z"`
	EndsAt   string `json:"ends_at" description:"RFC3339" example:"2026-09-10T03:30:00Z"`
}

// CalendarSidebarSDO is GET /api/v1/workspaces/{workspaceID}/calendar/sidebar.
type CalendarSidebarSDO struct {
	Priorities   []CalendarSidebarTaskSDO    `json:"priorities"`
	MeetWith     []CalendarSidebarMeetingSDO `json:"meet_with"`
	Assigned     []CalendarSidebarTaskSDO    `json:"assigned"`
	TodayOverdue []CalendarSidebarTaskSDO    `json:"today_overdue"`
	Backlog      []CalendarSidebarTaskSDO    `json:"backlog"`
}

type CalendarConnectionSDO struct {
	Provider            string   `json:"provider" description:"Calendar provider: google hoặc outlook" example:"google"`
	Email               string   `json:"email" description:"Tài khoản riêng đã kết nối" example:"you@example.com"`
	SelectedCalendarIDs []string `json:"selected_calendar_ids" description:"Provider calendar ids đang hiển thị"`
}

type CalendarConnectionListSDO struct {
	Connections []CalendarConnectionSDO `json:"connections"`
}
type CalendarOAuthStartSDO struct {
	AuthorizationURL string `json:"authorization_url" description:"Provider OAuth authorization URL" example:"https://accounts.google.com/o/oauth2/v2/auth"`
}
type ExternalCalendarSDO struct {
	ID       string `json:"id" description:"Opaque provider calendar id" example:"primary"`
	Name     string `json:"name" description:"Tên lịch từ provider" example:"Lịch cá nhân"`
	Color    string `json:"color,omitempty" description:"Màu do provider trả về" example:"#8e24aa"`
	Primary  bool   `json:"primary" description:"Lịch chính của tài khoản" example:"true"`
	Selected bool   `json:"selected" description:"Có hiển thị trong UniWork hay không" example:"true"`
	ReadOnly bool   `json:"read_only" description:"Tài khoản chỉ có quyền đọc lịch này" example:"false"`
}
type ExternalCalendarListSDO struct {
	Calendars []ExternalCalendarSDO `json:"calendars"`
}
