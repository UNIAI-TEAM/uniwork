package handler

import (
	"net/http"
	"time"

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

func (h *handlers) listPendingChatVoiceInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := h.Chat.ListPendingVoiceInvites(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.PendingVoiceInviteSDO, 0, len(invites))
	for _, inv := range invites {
		out = append(out, sdo.PendingVoiceInviteSDO{
			RoomID: inv.RoomID, CallID: inv.CallID,
			CallerID: inv.CallerID, CallerName: inv.CallerName,
			CallKind: inv.CallKind, RoomName: inv.RoomName,
			InvitedAt: inv.InvitedAt.Format(time.RFC3339),
		})
	}
	respondJSON(w, http.StatusOK, map[string]any{"invites": out})
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

func (h *handlers) signalChatPresence(w http.ResponseWriter, r *http.Request) {
	var in sdi.ChatPresenceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalPresence(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		in.State,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
