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

// requestLocale reads the uniwork-locale cookie the frontend writes; without
// it the answer is English, the product default. Accept-Language is not
// consulted — the web app ignores it too, so the account and the screen the
// user signed up on agree.
func requestLocale(r *http.Request) string {
	if c, err := r.Cookie("uniwork-locale"); err == nil && c.Value != "" {
		return service.NormalizeLocale(c.Value)
	}
	return "en"
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
	out.PushPreviews = !u.PushPreviewsHiddenAt.Valid
	if u.AiConsentVersion.Valid && u.AiConsentAt.Valid {
		v, at := u.AiConsentVersion.String, u.AiConsentAt.Time.Format(time.RFC3339)
		out.AIConsentVersion, out.AIConsentAt = &v, &at
	}
	if u.AiOptOutAt.Valid {
		at := u.AiOptOutAt.Time.Format(time.RFC3339)
		out.AIOptOutAt = &at
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
		LinkSkipped: sess.LinkSkipped, Reclaimed: sess.Reclaimed,
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
	h.clearSignInTicket(w)
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
	h.signedIn(w, sess, in.KeepSignInTicket)
}

// signedIn answers a sign-in route: the session (or its challenge), and a
// pending sign-in ticket dropped once a session opens, unless the request
// says it is the sign-in that ticket is about to be linked into.
func (h *handlers) signedIn(w http.ResponseWriter, sess service.Session, keepTicket bool) {
	if !sess.MFAPending() && !keepTicket {
		h.clearSignInTicket(w)
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
	h.clearSignInTicket(w)
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

// serviceFailure is how a service error reaches the wire: the one
// classification both the JSON mapping and the SSE error event read, so they
// cannot drift.
type serviceFailure struct {
	status     int
	code, msg  string
	fields     map[string]any
	retryAfter string
	unexpected bool // an internal error: logged, never described
}

func classifyServiceError(err error) serviceFailure {
	var ve service.ValidationError
	var ce service.CodedError
	var aiErr *ai.Error
	switch {
	case errors.As(err, &ve):
		return serviceFailure{status: 400, code: "invalid_request", msg: ve.Msg}
	case errors.As(err, &ce):
		f := serviceFailure{status: ce.Status, code: ce.Code, msg: ce.Msg, fields: ce.Fields}
		if retry, ok := uniworkRetrySeconds(ce.Fields); ok {
			f.retryAfter = retry
		}
		return f
	case errors.As(err, &aiErr):
		return serviceFailure{status: aiErr.Status, code: aiErr.Code, msg: aiErr.Msg}
	case errors.Is(err, service.ErrNotFound):
		return serviceFailure{status: 404, code: "not_found", msg: "not found"}
	case errors.Is(err, service.ErrForbidden):
		return serviceFailure{status: 403, code: "forbidden", msg: "forbidden"}
	case errors.Is(err, service.ErrInvalidCredentials):
		return serviceFailure{status: 401, code: "invalid_credentials", msg: "invalid credentials"}
	case errors.Is(err, service.ErrConflict):
		return serviceFailure{status: 409, code: "conflict", msg: "already exists"}
	case errors.Is(err, service.ErrMyFolderLocked):
		return serviceFailure{status: http.StatusConflict, code: "my_folder_locked", msg: "Thư mục của tôi là thư mục hệ thống cá nhân và không thể đổi tên, chia sẻ, di chuyển hoặc lưu trữ"}
	case errors.Is(err, service.ErrIdempotencyInFlight):
		return serviceFailure{status: 409, code: "idempotency_in_flight", msg: "yêu cầu trùng đang được xử lý; thử lại sau"}
	case errors.Is(err, service.ErrRateLimited):
		return serviceFailure{status: 429, code: "rate_limited", msg: "too many requests"}
	case errors.Is(err, service.ErrInvalidCode):
		return serviceFailure{status: 400, code: "invalid_code", msg: "invalid or expired code"}
	case errors.Is(err, service.ErrEmailUnverified):
		return serviceFailure{status: 403, code: "email_unverified", msg: "email address not verified"}
	case errors.Is(err, service.ErrInvalidToken):
		return serviceFailure{status: 400, code: "invalid_token", msg: "invalid or expired token"}
	case errors.Is(err, service.ErrEmailHubNotConfigured):
		return serviceFailure{status: http.StatusServiceUnavailable, code: "email_hub_not_configured", msg: "Email Hub is not configured"}
	case errors.Is(err, service.ErrEmailHubReauthRequired):
		return serviceFailure{status: http.StatusConflict, code: "email_hub_reauth_required", msg: "Email Hub account needs to be reconnected"}
	case errors.Is(err, service.ErrEmailHubSMTPDisabled):
		return serviceFailure{status: http.StatusBadRequest, code: "email_hub_smtp_disabled", msg: "SMTP AUTH is disabled for this mailbox"}
	case errors.Is(err, service.ErrCalendarProviderNotConfigured):
		return serviceFailure{status: http.StatusServiceUnavailable, code: "calendar_provider_not_configured", msg: "Calendar provider is not configured"}
	}
	return serviceFailure{status: 500, code: "internal", msg: "internal error", unexpected: true}
}

func (h *handlers) mapServiceError(w http.ResponseWriter, err error) {
	f := classifyServiceError(err)
	if f.unexpected {
		h.Log.Error("internal", "err", err)
	}
	if f.retryAfter != "" {
		w.Header().Set("Retry-After", f.retryAfter)
	}
	if f.fields != nil {
		respondErrorFields(w, f.status, f.code, f.msg, f.fields)
		return
	}
	respondError(w, f.status, f.code, f.msg)
}
