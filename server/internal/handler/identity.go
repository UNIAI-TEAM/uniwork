package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// mfaCookie carries the challenge token through the redirect flows (Google,
// password reset) where the browser, not a fetch, lands on /login?mfa=1.
const mfaCookie = "uniwork_mfa"

const mfaCookieTTL = 5 * time.Minute

// authCtx puts the client's address and browser on the context so every
// path that mints a session records them.
func (h *handlers) authCtx(r *http.Request) *http.Request {
	meta := service.SessionMeta{UserAgent: r.UserAgent(), IP: middleware.ClientIP(r, h.proxies)}
	return r.WithContext(service.WithSessionMeta(r.Context(), meta))
}

func (h *handlers) setMFACookie(w http.ResponseWriter, token string) {
	c := &http.Cookie{
		Name: mfaCookie, Value: token, Path: "/api/v1/auth",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	}
	if token == "" {
		c.Expires = time.Unix(0, 0)
	} else {
		c.MaxAge = int(mfaCookieTTL / time.Second)
	}
	http.SetCookie(w, c)
}

// mfaChallenge answers a first factor that passed on an MFA account.
func (h *handlers) mfaChallenge(w http.ResponseWriter, sess service.Session) {
	h.setMFACookie(w, sess.MFAToken)
	respondJSON(w, http.StatusOK, sdo.MFAChallengeSDO{MFARequired: true, MFAToken: sess.MFAToken})
}

func (h *handlers) mfaVerify(w http.ResponseWriter, r *http.Request) {
	var in sdi.MFAVerifySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	token := in.MFAToken
	if token == "" {
		if c, err := r.Cookie(mfaCookie); err == nil {
			token = c.Value
		}
	}
	sess, err := h.Auth.VerifyMFA(h.authCtx(r).Context(), token, in.Code)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.setMFACookie(w, "")
	h.signedIn(w, sess, in.KeepSignInTicket)
}

func (h *handlers) mfaSetup(w http.ResponseWriter, r *http.Request) {
	// A body-less POST (clients from before the step-up) reads as one
	// without a token: 403 proof_required, not 400.
	emptyBodyAsObject(r)
	var in sdi.StepUpTokenSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	out, err := h.Auth.SetupTOTP(r.Context(), middleware.UserID(r.Context()), in.StepUpToken)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MFASetupSDO{Secret: out.Secret, OTPAuthURL: out.OTPAuthURL})
}

func (h *handlers) mfaConfirm(w http.ResponseWriter, r *http.Request) {
	var in sdi.MFAConfirmSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	codes, err := h.Auth.ConfirmTOTP(r.Context(), middleware.UserID(r.Context()), in.Code, in.StepUpToken)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MFARecoveryCodesSDO{RecoveryCodes: codes})
}

func (h *handlers) mfaDisable(w http.ResponseWriter, r *http.Request) {
	var in sdi.MFACodeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	u, err := h.Auth.DisableTOTP(r.Context(), middleware.UserID(r.Context()), in.Code)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) listSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Auth.ListSessions(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	current := middleware.SessionID(r.Context())
	out := sdo.SessionListSDO{Sessions: make([]sdo.UserSessionDTO, 0, len(rows))}
	for _, s := range rows {
		out.Sessions = append(out.Sessions, sdo.UserSessionDTO{
			ID: s.SessionID, UserAgent: s.UserAgent, IP: s.Ip,
			CreatedAt:  s.CreatedAt.Time.Format(time.RFC3339),
			LastSeenAt: s.LastSeenAt.Time.Format(time.RFC3339),
			Current:    s.SessionID == current,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) revokeSession(w http.ResponseWriter, r *http.Request) {
	if err := h.Auth.RevokeSession(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "sessionId")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	if _, err := h.Auth.RevokeOtherSessions(r.Context(), middleware.UserID(r.Context()), middleware.SessionID(r.Context())); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) setAIConsent(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetAIConsentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if strings.TrimSpace(in.Version) == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "version is required")
		return
	}
	h.answerAIConsent(w, r, in.Version)
}

func (h *handlers) withdrawAIConsent(w http.ResponseWriter, r *http.Request) {
	h.answerAIConsent(w, r, "")
}

func (h *handlers) answerAIConsent(w http.ResponseWriter, r *http.Request, version string) {
	u, err := h.Auth.SetAIConsent(r.Context(), middleware.UserID(r.Context()), version)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) setPushPreviews(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetPushPreviewsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if in.Show == nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "show is required")
		return
	}
	u, err := h.Auth.SetPushPreviews(r.Context(), middleware.UserID(r.Context()), *in.Show)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var in sdi.DeleteAccountSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.Auth.DeleteAccount(h.authCtx(r).Context(), middleware.UserID(r.Context()), service.DeleteAccountInput{
		StepUpToken: in.StepUpToken, Password: in.Password, Code: in.Code, EmailConfirmation: in.EmailConfirmation,
		CloseOrganization: in.CloseOrganization,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.setRefreshCookie(w, "", time.Unix(0, 0))
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
