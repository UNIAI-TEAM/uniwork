package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
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
	w.Header().Set("Deprecation", "true")
	w.Header().Set("Link", "</api/v1/meetings/"+chi.URLParam(r, "meetingID")+"/join>; rel=\"successor-version\"")
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
	case "egress_ended":
		info := ev.GetEgressInfo()
		if info == nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		mapped.Type = "conference.recording_ended"
		mapped.RecordingID = info.GetEgressId()
		mapped.RecordingFailed = info.GetStatus() != livekit.EgressStatus_EGRESS_COMPLETE
		if files := info.GetFileResults(); len(files) > 0 {
			mapped.RecordingURL = files[0].GetLocation()
		}
	default:
		w.WriteHeader(http.StatusOK)
		return
	}
	payload, err := json.Marshal(mapped)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	providerKey := h.Cfg.MeetingProvider
	if providerKey == "" {
		providerKey = "livekit"
	}
	if _, err := h.Meetings.EnqueueProviderWebhook(r.Context(), providerKey, mapped.ProviderEventID, mapped.Type, payload); err != nil {
		h.Log.Error("livekit webhook enqueue", "err", err)
		respondError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	w.WriteHeader(http.StatusOK)
}
