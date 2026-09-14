package sdo

import "encoding/json"

// HomeCountsDTO is the inline strip at the top of the home screen.
type HomeCountsDTO struct {
	Open          int64 `json:"open" description:"Việc mở được giao cho người gọi" example:"6"`
	Overdue       int64 `json:"overdue" description:"Việc mở có hạn trước hôm nay" example:"2"`
	DueToday      int64 `json:"due_today" description:"Việc mở có hạn hôm nay" example:"1"`
	MeetingsToday int64 `json:"meetings_today" description:"Cuộc họp còn lại hôm nay của người gọi" example:"1"`
	Unread        int64 `json:"unread" description:"Thông báo chưa đọc trong workspace này" example:"3"`
}

// HomeSummarySDO is GET /api/v1/workspaces/{workspaceID}/home.
type HomeSummarySDO struct {
	Today            string            `json:"today" description:"Ngày hiện tại theo múi giờ người gọi" example:"2026-09-14"`
	Timezone         string            `json:"timezone" description:"Múi giờ dùng để tính hôm nay" example:"Asia/Ho_Chi_Minh"`
	Counts           HomeCountsDTO     `json:"counts"`
	MyWork           []TaskDTO         `json:"my_work" description:"Việc mở được giao cho người gọi, gấp nhất trước"`
	UpcomingMeetings []MeetingDTO      `json:"upcoming_meetings" description:"Cuộc họp đang diễn ra, hôm nay và ngày mai"`
	Inbox            []NotificationDTO `json:"inbox" description:"Thông báo chưa đọc mới nhất của workspace"`
	Partial          []string          `json:"partial" description:"Nguồn tạm thời lỗi: tasks, meetings, notifications" example:"[]"`
	GeneratedAt      string            `json:"generated_at" example:"2026-09-14T03:00:00Z"`
}

// HomePreferenceSDO is GET|PUT /api/v1/workspaces/{workspaceID}/home/preferences.
type HomePreferenceSDO struct {
	Prefs     json.RawMessage `json:"prefs" description:"Bố cục đã lưu; object rỗng khi chưa đổi lần nào" example:"{\"layout\":\"balanced\"}"`
	UpdatedAt string          `json:"updated_at,omitempty" example:"2026-09-14T03:00:00Z"`
}
