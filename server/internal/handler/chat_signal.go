package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) signalChatVoiceInvite(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceInvite(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) signalChatVoiceAccept(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceAccept(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) signalChatVoiceHangup(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceHangup(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID, in.DurationSeconds,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) signalChatTyping(w http.ResponseWriter, r *http.Request) {
	err := h.Chat.SignalTyping(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
