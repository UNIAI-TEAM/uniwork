package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const refreshCookie = "uniwork_refresh"

// requestLocale reads the uniwork-locale cookie the frontend writes, then
// Accept-Language; anything else means vi.
func requestLocale(r *http.Request) string {
	if c, err := r.Cookie("uniwork-locale"); err == nil && c.Value != "" {
		return service.NormalizeLocale(c.Value)
	}
	return service.NormalizeLocale(r.Header.Get("Accept-Language"))
}

func toUserDTO(u db.User) sdo.UserDTO {
	out := sdo.UserDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Locale: u.Locale, Timezone: u.Timezone, OnboardingQuestionnaire: json.RawMessage("{}"), HasPassword: u.PasswordHash.Valid}
	if u.AvatarUrl.Valid {
		out.AvatarURL = u.AvatarUrl.String
	}
	if u.OnboardedAt.Valid {
		s := u.OnboardedAt.Time.Format(time.RFC3339)
		out.OnboardedAt = &s
	}
	if u.EmailVerifiedAt.Valid {
		s := u.EmailVerifiedAt.Time.Format(time.RFC3339)
		out.EmailVerifiedAt = &s
	}
	if u.MfaEnabledAt.Valid {
		s := u.MfaEnabledAt.Time.Format(time.RFC3339)
		out.MFAEnabledAt = &s
	}
	if u.PlatformRole.Valid {
		out.PlatformRole = u.PlatformRole.String
	}
	if len(u.OnboardingQuestionnaire) > 0 {
		out.OnboardingQuestionnaire = json.RawMessage(u.OnboardingQuestionnaire)
	}
	return out
}

func (h *handlers) setRefreshCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: token, Path: "/api/v1/auth",
		Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: h.Cfg.SecureCookies,
	})
}

func (h *handlers) sessionResponse(w http.ResponseWriter, sess service.Session) {
	if sess.MFAPending() {
		h.mfaChallenge(w, sess)
		return
	}
	h.setRefreshCookie(w, sess.RefreshToken, sess.RefreshExpiresAt)
	out := sdo.SessionSDO{
		User: toUserDTO(sess.User), AccessToken: sess.AccessToken,
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	var in sdi.RegisterSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.Auth.Register(h.authCtx(r).Context(), in.Email, in.Password, in.DisplayName, requestLocale(r))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) login(w http.ResponseWriter, r *http.Request) {
	var in sdi.LoginSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.Auth.Login(h.authCtx(r).Context(), in.Email, in.Password)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil || c.Value == "" {
		respondError(w, 401, "unauthorized", "missing refresh token")
		return
	}
	sess, err := h.Auth.Refresh(h.authCtx(r).Context(), c.Value)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		_ = h.Auth.Logout(r.Context(), c.Value)
	}
	h.setRefreshCookie(w, "", time.Unix(0, 0))
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) me(w http.ResponseWriter, r *http.Request) {
	u, err := h.Auth.Me(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) patchMe(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchMeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	u, err := h.Auth.UpdateProfile(r.Context(), middleware.UserID(r.Context()), in.DisplayName, in.Locale, in.Timezone)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) mapServiceError(w http.ResponseWriter, err error) {
	var ve service.ValidationError
	var ce service.CodedError
	var aiErr *ai.Error
	switch {
	case errors.As(err, &ve):
		respondError(w, 400, "invalid_request", ve.Msg)
	case errors.As(err, &ce):
		respondErrorFields(w, ce.Status, ce.Code, ce.Msg, ce.Fields)
	case errors.As(err, &aiErr):
		respondError(w, aiErr.Status, aiErr.Code, aiErr.Msg)
	case errors.Is(err, service.ErrNotFound):
		respondError(w, 404, "not_found", "not found")
	case errors.Is(err, service.ErrForbidden):
		respondError(w, 403, "forbidden", "forbidden")
	case errors.Is(err, service.ErrInvalidCredentials):
		respondError(w, 401, "invalid_credentials", "invalid credentials")
	case errors.Is(err, service.ErrConflict):
		respondError(w, 409, "conflict", "already exists")
	case errors.Is(err, service.ErrIdempotencyInFlight):
		respondError(w, 409, "idempotency_in_flight", "yêu cầu trùng đang được xử lý; thử lại sau")
	case errors.Is(err, service.ErrRateLimited):
		respondError(w, 429, "rate_limited", "too many requests")
	case errors.Is(err, service.ErrInvalidCode):
		respondError(w, 400, "invalid_code", "invalid or expired code")
	case errors.Is(err, service.ErrEmailUnverified):
		respondError(w, 403, "email_unverified", "email address not verified")
	case errors.Is(err, service.ErrInvalidToken):
		respondError(w, 400, "invalid_token", "invalid or expired token")
	default:
		h.Log.Error("internal", "err", err)
		respondError(w, 500, "internal", "internal error")
	}
}
