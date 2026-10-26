package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The nonce cookie carries the start's nonce to the callback; the sealed
// state holds the same nonce, so a state lifted into another browser does not
// complete there (spec §5.2). Its path covers only the Drive callback route.
const (
	driveAuthCookie     = "uniwork_drive_oauth"
	driveAuthCookiePath = "/api/v1/drive-connections/google/callback"
)

func (h *handlers) driveFlagOrganization(r *http.Request) string {
	if h.DriveConnections != nil {
		return h.DriveConnections.FlagOrganization(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	}
	return h.documentFlagOrganization(r)
}

// StartDriveGoogleOAuth issues a Google OAuth 2.0 consent URL for the caller
// in the workspace's organization and sets the HttpOnly nonce cookie on the
// callback path (spec §5.2).
func (h *handlers) StartDriveGoogleOAuth(w http.ResponseWriter, r *http.Request) {
	if h.DriveConnections == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.StartDriveGoogleOAuthSDI
	if r.ContentLength != 0 {
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
	}
	u, nonce, err := h.DriveConnections.StartOAuth(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		in.ReconnectConnectionID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.setDriveAuthCookie(w, r, nonce)
	respondJSON(w, http.StatusOK, sdo.DriveOAuthStartSDO{AuthorizationURL: u})
}

func (h *handlers) setDriveAuthCookie(w http.ResponseWriter, r *http.Request, nonce string) {
	maxAge := 0
	expires := time.Time{}
	if nonce == "" {
		maxAge = -1
		expires = time.Unix(0, 0)
	} else {
		maxAge = int(10 * time.Minute / time.Second)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     driveAuthCookie,
		Value:    nonce,
		Path:     driveAuthCookiePath,
		MaxAge:   maxAge,
		Expires:  expires,
		HttpOnly: true,
		Secure:   h.Cfg.SecureCookies || r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		SameSite: http.SameSiteLaxMode,
	})
}

var (
	driveOAuthScript = `var d=JSON.parse(document.getElementById("d").textContent);try{if(window.opener&&d.origin)window.opener.postMessage({type:"uniwork:drive-oauth",ok:d.ok,code:d.code},d.origin)}catch(e){}try{window.close()}catch(e){}`
	driveOAuthCSP    = func() string {
		sum := sha256.Sum256([]byte(driveOAuthScript))
		return "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
	}()
)

// CompleteDriveGoogleOAuth is the OAuth redirect target, outside the authed
// group: the sealed state names the member and the nonce cookie ties the flow
// to the browser that started it. It always answers 200 with a small HTML
// page that posts `{type: "uniwork:drive-oauth", ok, code}` to the opener
// and closes (spec §5.2).
func (h *handlers) CompleteDriveGoogleOAuth(w http.ResponseWriter, r *http.Request) {
	var cookieNonce string
	if c, err := r.Cookie(driveAuthCookie); err == nil {
		cookieNonce = c.Value
	}
	h.setDriveAuthCookie(w, r, "")
	q := r.URL.Query()
	var code string
	if h.DriveConnections == nil {
		code = sdo.DriveOAuthProviderError
	} else {
		code = h.DriveConnections.CompleteOAuth(
			r.Context(),
			q.Get("state"),
			q.Get("code"),
			q.Get("error"),
			q.Get("error_subtype"),
			cookieNonce,
		)
	}
	writeDriveOAuthPage(w, h.Cfg.FrontendOrigin, code)
}

func writeDriveOAuthPage(w http.ResponseWriter, origin, code string) {
	ok := code == sdo.DriveOAuthConnected || code == sdo.DriveOAuthReconnected
	data, _ := json.Marshal(struct {
		Origin string `json:"origin"`
		OK     bool   `json:"ok"`
		Code   string `json:"code"`
	}{Origin: origin, OK: ok, Code: code})
	hdr := w.Header()
	hdr.Set("Content-Type", "text/html; charset=utf-8")
	hdr.Set("Cache-Control", "no-store")
	hdr.Set("Content-Security-Policy", driveOAuthCSP)
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><title>UniWork</title></head><body>`+
		`<script id="d" type="application/json">`+string(data)+`</script>`+
		`<script>`+driveOAuthScript+`</script></body></html>`)
}

// ListDriveConnections returns the caller's active and needs_reconnect Google
// Drive connections in the workspace's organization (spec §5.3).
func (h *handlers) ListDriveConnections(w http.ResponseWriter, r *http.Request) {
	if h.DriveConnections == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	rows, err := h.DriveConnections.List(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.DriveConnectionDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, toDriveConnectionDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.DriveConnectionListSDO{Connections: items})
}

func toDriveConnectionDTO(v service.DriveConnectionView) sdo.DriveConnectionDTO {
	var authFailedAt *string
	if v.AuthFailedAt != nil {
		formatted := v.AuthFailedAt.UTC().Format(time.RFC3339)
		authFailedAt = &formatted
	}
	dto := sdo.DriveConnectionDTO{
		ID:               v.ID,
		Provider:         v.Provider,
		GoogleEmail:      v.GoogleEmail,
		Status:           v.Status,
		NeedsReconnect:   v.NeedsReconnect,
		AuthFailedAt:     authFailedAt,
		AuthFailedReason: v.AuthFailedReason,
		LinkedFileCount:  int64(v.LinkedFileCount),
	}
	if !v.ConnectedAt.IsZero() {
		dto.ConnectedAt = v.ConnectedAt.UTC().Format(time.RFC3339)
	}
	if !v.UpdatedAt.IsZero() {
		dto.UpdatedAt = v.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return dto
}

// DisconnectDriveConnection disconnects one of the caller's Google Drive
// connections in the workspace's organization (spec §5.3).
func (h *handlers) DisconnectDriveConnection(w http.ResponseWriter, r *http.Request) {
	if h.DriveConnections == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	err := h.DriveConnections.Disconnect(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "connectionID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
