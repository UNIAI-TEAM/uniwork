package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: calendar — workspace calendar feed for the Month hub (C-02 / UNI-718).
//
//	GET /api/v1/workspaces/{workspaceID}/calendar/events
//	GET /api/v1/workspaces/{workspaceID}/calendar/sidebar
//	GET /api/v1/workspaces/{workspaceID}/calendar.ics
func registerCalendar(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/calendar/events", h.ListCalendarEvents, apiOp{
		summary:     "List calendar events in a date range",
		description: "Tasks có due_date và cuộc họp (không CANCELED) giao với [from, to] inclusive (YYYY-MM-DD). Query mine=true lọc việc được giao / cuộc họp mình host hoặc tham gia. Khoảng tối đa 366 ngày.",
		tags:        []string{"calendar"},
		sdo:         sdo.CalendarEventListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/calendar/sidebar", h.ListCalendarSidebar, apiOp{
		summary:     "Calendar sidebar planner sections",
		description: "Một payload cho priorities, meet_with, assigned, today_overdue, backlog (tối đa 25 mỗi section). Task mở theo category status; meeting sắp tới không CANCELED.",
		tags:        []string{"calendar"},
		sdo:         sdo.CalendarSidebarSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/calendar.ics", h.WorkspaceCalendar, apiOp{
		summary:     "iCalendar export for workspace tasks and meetings",
		description: "RFC 5545 calendar with all-day task due dates and timed meetings. Optional from/to (YYYY-MM-DD); default window is 30 days before through 90 days after today (UTC).",
		tags:        []string{"calendar"},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/calendar/connections", h.ListCalendarConnections, apiOp{summary: "List personal calendar connections", tags: []string{"calendar"}, sdo: sdo.CalendarConnectionListSDO{}, auth: true})
	r.Get("/workspaces/{workspaceID}/calendar/connections/{provider}/start", h.StartCalendarConnection, apiOp{summary: "Start calendar OAuth", tags: []string{"calendar"}, sdo: sdo.CalendarOAuthStartSDO{}, auth: true})
	r.Get("/calendar-connections/{provider}/callback", h.CompleteCalendarConnection, apiOp{summary: "Complete calendar OAuth", tags: []string{"calendar"}})
	r.Get("/workspaces/{workspaceID}/calendar/connections/{provider}/calendars", h.ListExternalCalendars, apiOp{summary: "List provider calendars", tags: []string{"calendar"}, sdo: sdo.ExternalCalendarListSDO{}, auth: true})
	r.Put("/workspaces/{workspaceID}/calendar/connections/{provider}/calendars", h.SelectExternalCalendars, apiOp{summary: "Select provider calendars", tags: []string{"calendar"}, sdi: sdi.CalendarSelectionSDI{}, auth: true})
	r.Delete("/workspaces/{workspaceID}/calendar/connections/{provider}", h.DisconnectCalendarConnection, apiOp{summary: "Disconnect a calendar provider", tags: []string{"calendar"}, auth: true})
}
