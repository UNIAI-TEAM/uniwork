package handler

import (
	"net/http"
	netmail "net/mail"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

// forgotPassword answers 200 for every syntactically valid address so the
// response cannot be used to enumerate accounts.
func (h *handlers) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var in sdi.ForgotPasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if _, err := netmail.ParseAddress(in.Email); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "email không hợp lệ")
		return
	}
	if err := h.PasswordReset.Request(r.Context(), in.Email); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in sdi.ResetPasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.PasswordReset.Reset(r.Context(), in.Token, in.Password)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}
