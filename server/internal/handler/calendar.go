package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
)

func (h *handlers) listCalendarEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	fromRaw := strings.TrimSpace(q.Get("from"))
	toRaw := strings.TrimSpace(q.Get("to"))
	if fromRaw == "" || toRaw == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "from and to are required (YYYY-MM-DD)")
		return
	}
	fromDate, err := util.ParseCalendarDate(fromRaw)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "from must be YYYY-MM-DD")
		return
	}
	toDate, err := util.ParseCalendarDate(toRaw)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "to must be YYYY-MM-DD")
		return
	}
	mine := false
	if raw := strings.TrimSpace(q.Get("mine")); raw != "" {
		mine, err = strconv.ParseBool(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "mine must be true or false")
			return
		}
	}

	events, err := h.Calendar.ListEvents(
		r.Context(),
		chi.URLParam(r, "workspaceID"),
		middleware.UserID(r.Context()),
		fromDate.Time,
		toDate.Time,
		mine,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.CalendarEventListSDO{Events: make([]sdo.CalendarEventSDO, 0, len(events))}
	for _, e := range events {
		out.Events = append(out.Events, toCalendarEventSDO(e))
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) workspaceCalendar(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "workspaceID")
	userID := middleware.UserID(r.Context())
	q := r.URL.Query()
	fromRaw := strings.TrimSpace(q.Get("from"))
	toRaw := strings.TrimSpace(q.Get("to"))

	var fromDay, toDay time.Time
	switch {
	case fromRaw == "" && toRaw == "":
		today := time.Now().UTC().Truncate(24 * time.Hour)
		fromDay = today.AddDate(0, 0, -30)
		toDay = today.AddDate(0, 0, 90)
	case fromRaw != "" && toRaw != "":
		fromDate, err := util.ParseCalendarDate(fromRaw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "from must be YYYY-MM-DD")
			return
		}
		toDate, err := util.ParseCalendarDate(toRaw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "to must be YYYY-MM-DD")
			return
		}
		fromDay = fromDate.Time
		toDay = toDate.Time
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", "from and to must both be set or both omitted")
		return
	}

	ics, err := h.Calendar.WorkspaceICS(r.Context(), wsID, userID, fromDay, toDay)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="uniwork-calendar.ics"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ics)
}

func (h *handlers) listCalendarSidebar(w http.ResponseWriter, r *http.Request) {
	sidebar, err := h.Calendar.ListSidebar(
		r.Context(),
		chi.URLParam(r, "workspaceID"),
		middleware.UserID(r.Context()),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toCalendarSidebarSDO(sidebar))
}

func toCalendarSidebarSDO(s service.CalendarSidebar) sdo.CalendarSidebarSDO {
	out := sdo.CalendarSidebarSDO{
		Priorities:   make([]sdo.CalendarSidebarTaskSDO, 0, len(s.Priorities)),
		MeetWith:     make([]sdo.CalendarSidebarMeetingSDO, 0, len(s.MeetWith)),
		Assigned:     make([]sdo.CalendarSidebarTaskSDO, 0, len(s.Assigned)),
		TodayOverdue: make([]sdo.CalendarSidebarTaskSDO, 0, len(s.TodayOverdue)),
		Backlog:      make([]sdo.CalendarSidebarTaskSDO, 0, len(s.Backlog)),
	}
	for _, t := range s.Priorities {
		out.Priorities = append(out.Priorities, toCalendarSidebarTaskSDO(t))
	}
	for _, m := range s.MeetWith {
		out.MeetWith = append(out.MeetWith, sdo.CalendarSidebarMeetingSDO{
			ID: m.ID, Title: m.Title, StartsAt: m.StartsAt, EndsAt: m.EndsAt,
		})
	}
	for _, t := range s.Assigned {
		out.Assigned = append(out.Assigned, toCalendarSidebarTaskSDO(t))
	}
	for _, t := range s.TodayOverdue {
		out.TodayOverdue = append(out.TodayOverdue, toCalendarSidebarTaskSDO(t))
	}
	for _, t := range s.Backlog {
		out.Backlog = append(out.Backlog, toCalendarSidebarTaskSDO(t))
	}
	return out
}

func toCalendarSidebarTaskSDO(t service.CalendarSidebarTask) sdo.CalendarSidebarTaskSDO {
	return sdo.CalendarSidebarTaskSDO{
		ID: t.ID, Title: t.Title, Status: t.Status, Priority: t.Priority, DueDate: t.DueDate,
	}
}

func toCalendarEventSDO(e service.CalendarEvent) sdo.CalendarEventSDO {
	return sdo.CalendarEventSDO{
		ID:        e.ID,
		Kind:      e.Kind,
		EntityID:  e.EntityID,
		Title:     e.Title,
		Start:     e.Start,
		End:       e.End,
		AllDay:    e.AllDay,
		Status:    e.Status,
		Priority:  e.Priority,
		ProjectID: e.ProjectID,
	}
}
