package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// appleSignIn is the iPhone app's Sign in with Apple (ADR 0041): Apple's
// identity token in, the same native device session as the PKCE exchange out.
func (h *handlers) appleSignIn(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.AppleAuth.NativeEnabled() {
		respondError(w, http.StatusServiceUnavailable, "apple_auth_unavailable", "Sign in with Apple is not configured")
		return
	}
	var in sdi.AppleSignInSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	// The client's address goes on the context for the owner's alert mail.
	sess, err := h.AppleAuth.SignIn(h.authCtx(r).Context(), service.AppleSignInInput{
		IdentityToken: in.IdentityToken, Nonce: in.Nonce, AuthorizationCode: in.AuthorizationCode,
		GivenName: in.GivenName, FamilyName: in.FamilyName, ClientID: in.ClientID, DeploymentID: in.DeploymentID,
		DeviceLabel: in.DeviceLabel, Platform: in.Platform, Build: in.Build, Locale: requestLocale(r),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DesktopSessionSDO{AccountID: sess.AccountID, DeviceSessionID: sess.DeviceSessionID, SessionID: sess.SessionID, DeploymentID: sess.DeploymentID, AccessToken: sess.AccessToken, TokenType: "Bearer", ExpiresIn: sess.ExpiresIn, RefreshToken: sess.RefreshToken, RefreshExpiresIn: sess.RefreshExpiresIn, RefreshRotates: true})
}
