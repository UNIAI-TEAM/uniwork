package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) signalChatVoiceInvite(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceInvite(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID, in.Video,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// voiceSignalContext names the device session answering, declining or
// hanging up, so the ring's end skips the device that already knows
// (service.WithDeviceSession).
func voiceSignalContext(r *http.Request) context.Context {
	return service.WithDeviceSession(r.Context(), middleware.SessionID(r.Context()))
}

func (h *handlers) signalChatVoiceAccept(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceAccept(
		voiceSignalContext(r), middleware.UserID(r.Context()),
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
		voiceSignalContext(r), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) signalChatVoiceDecline(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Chat.SignalVoiceDecline(
		voiceSignalContext(r), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
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
	outgoing, err := h.Chat.ListOutgoingVoiceCalls(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.PendingVoiceInvitesSDO{
		Invites:  make([]sdo.PendingVoiceInviteSDO, 0, len(invites)),
		Outgoing: make([]sdo.OutgoingVoiceCallSDO, 0, len(outgoing)),
	}
	for _, inv := range invites {
		out.Invites = append(out.Invites, sdo.PendingVoiceInviteSDO{
			RoomID: inv.RoomID, CallID: inv.CallID,
			CallerID: inv.CallerID, CallerName: inv.CallerName,
			CallKind: inv.CallKind, RoomName: inv.RoomName,
			InvitedAt: inv.InvitedAt.Format(time.RFC3339),
		})
	}
	for _, call := range outgoing {
		out.Outgoing = append(out.Outgoing, sdo.OutgoingVoiceCallSDO{RoomID: call.RoomID, CallID: call.CallID, Accepted: call.Accepted})
	}
	respondJSON(w, http.StatusOK, out)
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
	online, err := h.Chat.SignalPresence(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		in.State,
		in.Visible,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatPresenceSDO{Status: "ok", OnlineUserIDs: online})
}
