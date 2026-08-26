package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const refreshCookie = "uniwork_refresh"

type userDTO struct {
	ID                      string          `json:"id"`
	Email                   string          `json:"email"`
	DisplayName             string          `json:"display_name"`
	AvatarURL               string          `json:"avatar_url,omitempty"`
	OnboardedAt             *string         `json:"onboarded_at"`
	OnboardingQuestionnaire json.RawMessage `json:"onboarding_questionnaire"`
}

func toUserDTO(u db.User) userDTO {
	dto := userDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, OnboardingQuestionnaire: json.RawMessage("{}")}
	if u.AvatarUrl.Valid {
		dto.AvatarURL = u.AvatarUrl.String
	}
	if u.OnboardedAt.Valid {
		s := u.OnboardedAt.Time.Format(time.RFC3339)
		dto.OnboardedAt = &s
	}
	if len(u.OnboardingQuestionnaire) > 0 {
		dto.OnboardingQuestionnaire = json.RawMessage(u.OnboardingQuestionnaire)
	}
	return dto
}

func (h *handlers) setRefreshCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: token, Path: "/api/v1/auth",
		Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: h.Cfg.SecureCookies,
	})
}

func (h *handlers) sessionResponse(w http.ResponseWriter, sess service.Session) {
	h.setRefreshCookie(w, sess.RefreshToken, sess.RefreshExpiresAt)
	respondJSON(w, http.StatusOK, map[string]any{
		"user": toUserDTO(sess.User), "access_token": sess.AccessToken,
	})
}

func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	sess, err := h.Auth.Register(r.Context(), in.Email, in.Password, in.DisplayName)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	sess, err := h.Auth.Login(r.Context(), in.Email, in.Password)
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
	sess, err := h.Auth.Refresh(r.Context(), c.Value)
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

func (h *handlers) mapServiceError(w http.ResponseWriter, err error) {
	var ve service.ValidationError
	switch {
	case errors.As(err, &ve):
		respondError(w, 400, "invalid_request", ve.Msg)
	case errors.Is(err, service.ErrNotFound):
		respondError(w, 404, "not_found", "not found")
	case errors.Is(err, service.ErrForbidden):
		respondError(w, 403, "forbidden", "forbidden")
	case errors.Is(err, service.ErrInvalidCredentials):
		respondError(w, 401, "invalid_credentials", "invalid credentials")
	case errors.Is(err, service.ErrConflict):
		respondError(w, 409, "conflict", "already exists")
	default:
		h.Log.Error("internal", "err", err)
		respondError(w, 500, "internal", "internal error")
	}
}
