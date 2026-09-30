package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}

func (h *handlers) desktopReady(w http.ResponseWriter) bool {
	if h.DesktopAuth != nil {
		return true
	}
	respondError(w, http.StatusServiceUnavailable, "desktop_auth_unavailable", "desktop auth is not configured")
	return false
}

func (h *handlers) desktopStart(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	q := r.URL.Query()
	a, err := h.DesktopAuth.Start(r.Context(), service.DesktopStartInput{
		ClientID: q.Get("client_id"), CodeChallenge: q.Get("code_challenge"), CodeChallengeMethod: q.Get("code_challenge_method"), State: q.Get("state"), RedirectURI: q.Get("redirect_uri"), DeploymentID: q.Get("deployment_id"), DeviceLabel: q.Get("device_label"), Platform: q.Get("platform"), Build: q.Get("build"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DesktopStartSDO{AuthorizationURL: a.AuthorizationURL, AttemptExpiresAt: a.ExpiresAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")})
}

func (h *handlers) desktopConsent(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	consent, err := h.DesktopAuth.Consent(r.Context(), middleware.UserID(r.Context()), r.URL.Query().Get("attempt_id"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DesktopConsentSDO{AttemptID: consent.AttemptID, AccountID: consent.AccountID, ClientID: consent.ClientID, DeploymentID: consent.DeploymentID, RedirectURI: consent.RedirectURI, DeviceLabel: consent.DeviceLabel, Platform: consent.Platform, Build: consent.Build, CSRFToken: consent.CSRFToken})
}

func (h *handlers) desktopConsentCommand(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	var in sdi.DesktopConsentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID := middleware.UserID(r.Context())
	switch strings.ToLower(strings.TrimSpace(in.Decision)) {
	case "approve":
		_, callback, err := h.DesktopAuth.Approve(r.Context(), userID, in.AttemptID, in.CSRFToken)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		// The browser follows this callback only after the explicit POST. The
		// code is single-use and contains no bearer or refresh token.
		respondJSON(w, http.StatusOK, sdo.DesktopConsentResultSDO{Status: "approved", CallbackURL: &callback})
	case "cancel":
		if err := h.DesktopAuth.Cancel(r.Context(), userID, in.AttemptID, in.CSRFToken); err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, sdo.DesktopConsentResultSDO{Status: "cancelled"})
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", "decision must be approve or cancel")
	}
}

func (h *handlers) desktopExchange(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	var in sdi.DesktopExchangeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.DesktopAuth.Exchange(r.Context(), in.ClientID, in.Code, in.CodeVerifier, in.RedirectURI, in.DeploymentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DesktopSessionSDO{AccountID: sess.AccountID, DeviceSessionID: sess.DeviceSessionID, SessionID: sess.SessionID, DeploymentID: sess.DeploymentID, AccessToken: sess.AccessToken, TokenType: "Bearer", ExpiresIn: sess.ExpiresIn, RefreshToken: sess.RefreshToken, RefreshExpiresIn: sess.RefreshExpiresIn, RefreshRotates: true})
}

func (h *handlers) desktopRefresh(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	var in sdi.DesktopRefreshSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.DesktopAuth.Refresh(r.Context(), in.DeviceSessionID, in.RefreshToken, in.DeploymentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DesktopSessionSDO{AccountID: sess.AccountID, DeviceSessionID: sess.DeviceSessionID, SessionID: sess.SessionID, DeploymentID: sess.DeploymentID, AccessToken: sess.AccessToken, TokenType: "Bearer", ExpiresIn: sess.ExpiresIn, RefreshToken: sess.RefreshToken, RefreshExpiresIn: sess.RefreshExpiresIn, RefreshRotates: true})
}

func (h *handlers) desktopLogout(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	var in sdi.DesktopLogoutSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.DesktopAuth.Logout(r.Context(), middleware.UserID(r.Context()), in.DeviceSessionID, in.DeploymentID, in.Scope); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) desktopDevices(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	devices, err := h.DesktopAuth.List(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.DesktopDeviceDTO, 0, len(devices))
	for _, d := range devices {
		var revoked *string
		if d.RevokedAt != nil {
			v := d.RevokedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
			revoked = &v
		}
		out = append(out, sdo.DesktopDeviceDTO{ID: d.ID, ClientID: d.ClientID, DeploymentID: d.DeploymentID, DeviceLabel: d.DeviceLabel, Platform: d.Platform, Build: d.Build, CreatedAt: d.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), LastUsedAt: d.LastUsedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), ExpiresAt: d.ExpiresAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), RevokedAt: revoked, Current: middleware.SessionID(r.Context()) == d.ID})
	}
	respondJSON(w, http.StatusOK, sdo.DesktopDeviceListSDO{Devices: out})
}

func (h *handlers) desktopRevokeDevice(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.desktopReady(w) {
		return
	}
	if err := h.DesktopAuth.Revoke(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "deviceSessionID")); err != nil {
		if errors.Is(err, service.ErrDesktopDeviceRevoked) {
			respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
			return
		}
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
