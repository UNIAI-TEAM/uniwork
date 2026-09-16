package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) mintChatVoiceToken(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.LiveKitAPIKey == "" || h.Cfg.LiveKitAPISecret == "" || h.Cfg.LiveKitURL == "" {
		respondError(w, http.StatusServiceUnavailable, "livekit_not_configured",
			"LiveKit chưa được cấu hình trên server")
		return
	}
	var in sdi.MintChatVoiceTokenSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	roomID := strings.TrimSpace(in.RoomID)
	if roomID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "room_id is required")
		return
	}
	callID := strings.TrimSpace(in.CallID)
	if callID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "call_id is required")
		return
	}
	userID := middleware.UserID(r.Context())
	u, err := h.Auth.Me(r.Context(), userID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	liveKitRoom, err := h.Chat.MintVoiceTokenRoom(r.Context(), userID, roomID, callID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tok, err := meetings.MintChatVoiceToken(
		h.Cfg.LiveKitAPIKey,
		h.Cfg.LiveKitAPISecret,
		liveKitRoom,
		u.ID,
		u.DisplayName,
		2*time.Hour,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MeetingTokenSDO{Token: tok, URL: h.Cfg.LiveKitURL})
}

func (h *handlers) startChatVoiceRecording(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	rec, err := h.Chat.StartVoiceRecording(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceRecordingSDO{Recording: chatVoiceRecordingDTO(rec)})
}

func (h *handlers) stopChatVoiceRecording(w http.ResponseWriter, r *http.Request) {
	var in sdi.VoiceSignalSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	rec, err := h.Chat.StopVoiceRecording(
		r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "roomID"), in.CallID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceRecordingSDO{Recording: chatVoiceRecordingDTO(rec)})
}

func (h *handlers) getActiveChatVoiceRecording(w http.ResponseWriter, r *http.Request) {
	callID := strings.TrimSpace(r.URL.Query().Get("call_id"))
	if callID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "call_id is required")
		return
	}
	rec, err := h.Chat.ActiveVoiceRecording(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		callID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceRecordingSDO{Recording: chatVoiceRecordingDTO(rec)})
}

func (h *handlers) listChatVoiceRecordings(w http.ResponseWriter, r *http.Request) {
	limit := int32(50)
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 32); err == nil && n > 0 {
			limit = int32(n)
		}
	}
	rows, err := h.Chat.ListVoiceRecordings(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatVoiceRecordingDTO, 0, len(rows))
	for _, rec := range rows {
		out = append(out, chatVoiceRecordingListItemDTO(rec))
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceRecordingListSDO{Recordings: out})
}

func (h *handlers) getChatVoiceRecordingPlaybackURL(w http.ResponseWriter, r *http.Request) {
	presigner, ok := h.Storage.(storage.DownloadPresigner)
	if !ok {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	rec, err := h.Chat.GetVoiceRecordingForPlayback(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "recordingID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	key := h.Storage.KeyFromURL(rec.FileUrl.String)
	if key == "" {
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	expiresAt := time.Now().UTC().Add(recordingPlaybackTTL)
	playbackURL, err := presigner.PresignGetWithContentDisposition(
		r.Context(), key, recordingPlaybackTTL, "inline",
	)
	if err != nil {
		h.Log.Error("chat voice recording presign", "err", err, "recording_id", rec.ID)
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceRecordingPlaybackSDO{
		PlaybackURL: playbackURL,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
	})
}

func (h *handlers) streamChatVoiceRecording(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	rec, err := h.Chat.GetVoiceRecordingForPlayback(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		chi.URLParam(r, "recordingID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	key := h.Storage.KeyFromURL(rec.FileUrl.String)
	if key == "" {
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	h.streamRecordingObject(w, r, key, rec.ID)
}

func chatVoiceRecordingDTO(rec db.ChatVoiceRecording) sdo.ChatVoiceRecordingDTO {
	out := sdo.ChatVoiceRecordingDTO{
		ID: rec.ID, RoomID: rec.RoomID, CallID: rec.CallID,
		Status: rec.Status, StartedBy: rec.StartedBy,
		StartedAt: rec.StartedAt.Time.UTC().Format(time.RFC3339),
	}
	if rec.FileUrl.Valid {
		out.FileURL = rec.FileUrl.String
	}
	if rec.EndedAt.Valid {
		out.EndedAt = rec.EndedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

func chatVoiceRecordingListItemDTO(rec db.ChatVoiceRecording) sdo.ChatVoiceRecordingDTO {
	out := chatVoiceRecordingDTO(rec)
	out.FileURL = ""
	return out
}
