package handler

import (
	"net/http"
	"strconv"
	"strings"

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
