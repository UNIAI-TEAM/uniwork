package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/notification"
)

func toNotificationDTO(it notification.Item) sdo.NotificationDTO {
	params := json.RawMessage(it.Params)
	if !json.Valid(params) {
		params = json.RawMessage("{}")
	}
	return sdo.NotificationDTO{
		ID: it.ID, Kind: it.Kind, WorkspaceID: it.WorkspaceID.String, OrganizationID: it.OrganizationID,
		ResourceType: it.ResourceType, ResourceID: it.ResourceID, ResourceDeleted: it.ResourceDeleted,
		ActorKind: it.ActorKind, ActorID: it.ActorID, TitleKey: it.TitleKey, Params: params, Count: it.Count,
		ReadAt: notification.OptTime(it.ReadAt), CreatedAt: notification.OptTime(it.CreatedAt), UpdatedAt: notification.OptTime(it.UpdatedAt),
	}
}

func (h *handlers) listNotifications(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	limit, _ := strconv.Atoi(qs.Get("limit"))
	items, err := h.Notifications.List(r.Context(), middleware.UserID(r.Context()), notification.ListInput{
		WorkspaceID: qs.Get("workspace_id"), UnreadOnly: qs.Get("unread") == "1" || qs.Get("unread") == "true",
		Before: qs.Get("before"), Limit: int32(limit),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.NotificationListSDO{Notifications: make([]sdo.NotificationDTO, 0, len(items))}
	for _, it := range items {
		out.Notifications = append(out.Notifications, toNotificationDTO(it))
	}
	// A full page may have more behind it; a short page is the end.
	if want := limit; want <= 0 {
		want = 50
		if len(items) == want {
			out.NextBefore = items[len(items)-1].ID
		}
	} else if len(items) >= want {
		out.NextBefore = items[len(items)-1].ID
	}
	respondJSON(w, 200, out)
}

func (h *handlers) unreadNotificationCount(w http.ResponseWriter, r *http.Request) {
	c, err := h.Notifications.UnreadCount(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.UnreadCountSDO{Total: c.Total, ByWorkspace: c.ByWorkspace})
}

func (h *handlers) markNotificationsRead(w http.ResponseWriter, r *http.Request) {
	var in sdi.NotificationIDsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID := middleware.UserID(r.Context())
	var err error
	if in.All {
		_, err = h.Notifications.MarkAllRead(r.Context(), userID, in.WorkspaceID)
	} else {
		err = h.Notifications.MarkRead(r.Context(), userID, in.IDs)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) markNotificationsUnread(w http.ResponseWriter, r *http.Request) {
	var in sdi.NotificationIDsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Notifications.MarkUnread(r.Context(), middleware.UserID(r.Context()), in.IDs); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) archiveNotifications(w http.ResponseWriter, r *http.Request) {
	var in sdi.NotificationIDsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Notifications.Archive(r.Context(), middleware.UserID(r.Context()), in.IDs); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func toPreferencesSDO(rows []notification.KindPrefs) sdo.NotificationPreferencesSDO {
	out := sdo.NotificationPreferencesSDO{Preferences: make([]sdo.NotificationPreferenceDTO, 0, len(rows))}
	for _, p := range rows {
		out.Preferences = append(out.Preferences, sdo.NotificationPreferenceDTO{Kind: p.Kind, InApp: p.InApp, Push: p.Push, Email: p.Email})
	}
	return out
}

func (h *handlers) getNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Notifications.Preferences(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toPreferencesSDO(rows))
}

func (h *handlers) putNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	var in sdi.NotificationPreferencesSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	prefs := make([]notification.KindPrefs, 0, len(in.Preferences))
	for _, p := range in.Preferences {
		prefs = append(prefs, notification.KindPrefs{Kind: p.Kind, Prefs: notification.Prefs{InApp: p.InApp, Push: p.Push, Email: p.Email}})
	}
	rows, err := h.Notifications.SetPreferences(r.Context(), middleware.UserID(r.Context()), prefs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toPreferencesSDO(rows))
}

func (h *handlers) pushConfig(w http.ResponseWriter, _ *http.Request) {
	c := h.Notifications.PushConfig()
	respondJSON(w, 200, sdo.PushConfigSDO{Enabled: c.Enabled, PublicKey: c.PublicKey})
}

func (h *handlers) subscribePush(w http.ResponseWriter, r *http.Request) {
	var in sdi.PushSubscribeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Notifications.SubscribePush(r.Context(), middleware.UserID(r.Context()), in.Endpoint, in.Keys.P256dh, in.Keys.Auth, r.UserAgent())
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) unsubscribePush(w http.ResponseWriter, r *http.Request) {
	var in sdi.PushUnsubscribeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Notifications.UnsubscribePush(r.Context(), middleware.UserID(r.Context()), in.Endpoint); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}
