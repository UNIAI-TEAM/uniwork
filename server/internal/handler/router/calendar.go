package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: calendar — workspace calendar feed for the Month hub (C-02 / UNI-718).
//
//	GET /api/v1/workspaces/{workspaceID}/calendar/events
func registerCalendar(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/calendar/events", h.ListCalendarEvents, apiOp{
		summary:     "List calendar events in a date range",
		description: "Tasks có due_date và cuộc họp (không CANCELED) giao với [from, to] inclusive (YYYY-MM-DD). Query mine=true lọc việc được giao / cuộc họp mình host hoặc tham gia. Khoảng tối đa 366 ngày.",
		tags:        []string{"calendar"},
		sdo:         sdo.CalendarEventListSDO{},
		auth:        true,
	})
}
