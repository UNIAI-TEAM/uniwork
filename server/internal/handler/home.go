package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/notification"
	"github.com/unicomhub/uniwork/server/internal/service"
)

const (
	homeSourceNotifications = "notifications"
	defaultHomeInboxLimit   = 8
	maxHomeInboxLimit       = 20
)

// queryInt32 reads a non-negative integer query value; anything else is 0,
// which every home limit reads as "use the default".
func queryInt32(r *http.Request, name string) int32 {
	v, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || v < 0 {
		return 0
	}
	if v > 1000 {
		v = 1000
	}
	return int32(v)
}

// getHomeSummary is the one request behind the home screen. Tasks and meetings
// come from HomeService; the inbox comes from the notification service, which
// the service tier may not import. A source that fails is named in partial and
// the rest of the page still renders.
func (h *handlers) getHomeSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := middleware.UserID(ctx)
	workspaceID := chi.URLParam(r, "workspaceID")
	sum, err := h.Home.Summary(ctx, service.Human(userID), workspaceID, service.HomeLimits{
		Tasks: queryInt32(r, "limit_tasks"), Meetings: queryInt32(r, "limit_meetings"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.HomeSummarySDO{
		Today:    sum.Today,
		Timezone: sum.Timezone,
		Counts: sdo.HomeCountsDTO{
			Open: sum.Counts.Open, Overdue: sum.Counts.Overdue,
			DueToday: sum.Counts.DueToday, MeetingsToday: sum.Counts.MeetingsToday,
		},
		MyWork:           []sdo.TaskDTO{},
		UpcomingMeetings: make([]sdo.MeetingDTO, 0, len(sum.Meetings)),
		Inbox:            []sdo.NotificationDTO{},
		Partial:          append([]string{}, sum.Partial...),
		GeneratedAt:      sum.GeneratedAt.Format(time.RFC3339),
	}
	if tasks, err := h.taskDTOs(r, sum.MyWork); err != nil {
		h.Log.WarnContext(ctx, "home: task rows failed", "workspace_id", workspaceID, "err", err)
		out.Partial = appendSource(out.Partial, service.HomeSourceTasks)
	} else {
		out.MyWork = tasks
	}
	for _, m := range sum.Meetings {
		out.UpcomingMeetings = append(out.UpcomingMeetings, toMeetingDTO(m))
	}

	limit := queryInt32(r, "limit_inbox")
	switch {
	case limit == 0:
		limit = defaultHomeInboxLimit
	case limit > maxHomeInboxLimit:
		limit = maxHomeInboxLimit
	}
	items, listErr := h.Notifications.List(ctx, userID, notification.ListInput{
		WorkspaceID: workspaceID, UnreadOnly: true, Limit: limit,
	})
	unread, countErr := h.Notifications.UnreadCount(ctx, userID)
	if listErr != nil || countErr != nil {
		h.Log.WarnContext(ctx, "home: notifications source failed", "workspace_id", workspaceID, "list_err", listErr, "count_err", countErr)
		out.Partial = appendSource(out.Partial, homeSourceNotifications)
	} else {
		for _, it := range items {
			out.Inbox = append(out.Inbox, toNotificationDTO(it))
		}
		out.Counts.Unread = unread.ByWorkspace[workspaceID]
	}
	respondJSON(w, 200, out)
}

func appendSource(list []string, source string) []string {
	for _, s := range list {
		if s == source {
			return list
		}
	}
	return append(list, source)
}

func (h *handlers) getHomePreference(w http.ResponseWriter, r *http.Request) {
	pref, err := h.Home.GetPreference(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.HomePreferenceSDO{Prefs: pref.Prefs, UpdatedAt: viewTime(pref.UpdatedAt)})
}

func (h *handlers) putHomePreference(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutHomePreferenceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	pref, err := h.Home.PutPreference(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in.Prefs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.HomePreferenceSDO{Prefs: pref.Prefs, UpdatedAt: viewTime(pref.UpdatedAt)})
}
