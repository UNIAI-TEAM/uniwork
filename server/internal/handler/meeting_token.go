package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) meetingToken(w http.ResponseWriter, r *http.Request) {
	display := ""
	if u, err := h.Auth.Me(r.Context(), middleware.UserID(r.Context())); err == nil {
		display = u.DisplayName
	}
	dec, err := h.Meetings.Join(r.Context(), service.AdmissionContext{
		MeetingID: chi.URLParam(r, "meetingID"), UserID: middleware.UserID(r.Context()), DisplayName: display,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if dec.Decision != service.DecisionAdmit || dec.Credential == nil {
		respondError(w, http.StatusForbidden, "meeting_not_started", "chưa được vào phòng")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, 200, map[string]string{"token": dec.Credential.Token, "url": dec.Credential.ServerURL})
}

func (h *handlers) livekitWebhook(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.LiveKitAPIKey == "" || h.Cfg.LiveKitAPISecret == "" {
		respondError(w, http.StatusServiceUnavailable, "livekit_not_configured", "LiveKit chưa được cấu hình trên server")
		return
	}
	provider := auth.NewSimpleKeyProvider(h.Cfg.LiveKitAPIKey, h.Cfg.LiveKitAPISecret)
	ev, err := webhook.ReceiveWebhookEvent(r, provider)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid_request", "webhook signature invalid")
		return
	}
	mapped := service.ProviderNeutralEvent{ProviderEventID: ev.GetId()}
	if ev.Room != nil {
		mapped.RoomName = ev.Room.Name
		mapped.RoomSID = ev.Room.Sid
	}
	if ev.Participant != nil {
		mapped.Identity = ev.Participant.Identity
	}
	switch ev.Event {
	case "room_started":
		mapped.Type = "conference.room_started"
	case "room_finished":
		mapped.Type = "conference.room_finished"
	case "participant_joined":
		mapped.Type = "conference.participant_joined"
	case "participant_left":
		mapped.Type = "conference.participant_left"
	case "participant_connection_aborted":
		mapped.Type = "conference.participant_connection_aborted"
	default:
		w.WriteHeader(http.StatusOK)
		return
	}
	if err := h.Meetings.HandleProviderEvent(r.Context(), mapped); err != nil {
		h.Log.Error("livekit webhook", "err", err)
		respondError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	w.WriteHeader(http.StatusOK)
}
