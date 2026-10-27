package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

func (h *handlers) rateCall(w http.ResponseWriter, r *http.Request) {
	var in sdi.RateCallSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	if err := h.Meetings.RateCall(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"), in.Rating); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}
