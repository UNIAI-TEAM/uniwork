package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The app's own sign-in screen (ADR 0049 §8, spec §3.6): /api/v1/auth/native/*
// and the app's Settings links. Every answer is no-store; the service holds
// the app to the native client allowlist and judges every token, ticket and
// code, and the handler only shapes NativeSignInSDO.

func (h *handlers) nativeReady(w http.ResponseWriter) bool {
	if h.NativeSignIn == nil {
		respondError(w, http.StatusServiceUnavailable, "native_sign_in_unavailable", "the app's sign-in is not configured")
		return false
	}
	return true
}

func nativeClient(in sdi.NativeClientSDI) service.NativeClient {
	return service.NativeClient{
		ClientID: in.ClientID, DeploymentID: in.DeploymentID, DeviceLabel: in.DeviceLabel, Platform: in.Platform, Build: in.Build,
	}
}

func toDesktopSessionSDO(s service.DesktopSession) sdo.DesktopSessionSDO {
	return sdo.DesktopSessionSDO{
		AccountID: s.AccountID, DeviceSessionID: s.DeviceSessionID, SessionID: s.SessionID, DeploymentID: s.DeploymentID,
		AccessToken: s.AccessToken, TokenType: "Bearer", ExpiresIn: s.ExpiresIn, RefreshToken: s.RefreshToken,
		RefreshExpiresIn: s.RefreshExpiresIn, RefreshRotates: true,
	}
}

func toNativeSignInSDO(res service.NativeSignInResult) sdo.NativeSignInSDO {
	out := sdo.NativeSignInSDO{
		Status: res.Status, Reclaimed: res.Reclaimed, LinkSkipped: res.LinkSkipped, MFAToken: res.MFAToken, Ticket: res.Ticket,
	}
	if res.Status == service.NativeSignedIn {
		s := toDesktopSessionSDO(res.Session)
		out.Session = &s
	}
	if res.Ticket != "" {
		out.Identity = &sdo.NativeIdentitySDO{
			Provider: res.Identity.Provider, Email: res.Identity.Email, Name: res.Identity.Name, PrivateRelay: res.Identity.PrivateRelay,
		}
	}
	return out
}

func (h *handlers) nativeAnswer(w http.ResponseWriter, res service.NativeSignInResult, err error) {
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toNativeSignInSDO(res))
}

func (h *handlers) nativePassword(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativePasswordSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.Password(h.authCtx(r).Context(), in.Email, in.Password, nativeClient(in.NativeClientSDI))
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeMFA(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeMFASDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.VerifyMFA(h.authCtx(r).Context(), in.MFAToken, in.Code, nativeClient(in.NativeClientSDI))
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeGoogle(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	if !h.NativeSignIn.GoogleEnabled() {
		respondError(w, http.StatusServiceUnavailable, "google_not_configured", "Google sign-in in the app is not configured")
		return
	}
	var in sdi.NativeGoogleSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.Google(h.authCtx(r).Context(), service.NativeProviderSignIn{
		Token: in.IDToken, Nonce: in.Nonce, Intent: in.Intent, Locale: requestLocale(r), Client: nativeClient(in.NativeClientSDI),
	})
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeApple(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	if !h.NativeSignIn.AppleEnabled() {
		respondError(w, http.StatusServiceUnavailable, "apple_auth_unavailable", "Sign in with Apple is not configured")
		return
	}
	var in sdi.NativeAppleSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.Apple(h.authCtx(r).Context(), service.NativeProviderSignIn{
		Token: in.IdentityToken, Nonce: in.Nonce, AuthorizationCode: in.AuthorizationCode,
		GivenName: in.GivenName, FamilyName: in.FamilyName, Intent: in.Intent, Locale: requestLocale(r),
		Client: nativeClient(in.NativeClientSDI),
	})
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeRegister(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeRegisterSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.Register(h.authCtx(r).Context(), in.Email, in.Password, in.DisplayName, requestLocale(r), nativeClient(in.NativeClientSDI))
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeTicketCreate(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeTicketCreateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.CreateFromTicket(h.authCtx(r).Context(), in.Ticket, in.Nonce, in.DisplayName, requestLocale(r), nativeClient(in.NativeClientSDI))
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeTicketClaimEmail(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeEmailClaimSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.NativeSignIn.SendEmailClaim(r.Context(), in.Ticket, in.Nonce, in.Email, requestLocale(r), nativeClient(in.NativeClientSDI)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "sent"})
}

func (h *handlers) nativeTicketClaimEmailVerify(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeEmailClaimVerifySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.NativeSignIn.VerifyEmailClaim(h.authCtx(r).Context(), in.Ticket, in.Nonce, in.Email, in.Code, in.DisplayName, requestLocale(r), nativeClient(in.NativeClientSDI))
	h.nativeAnswer(w, res, err)
}

func (h *handlers) nativeTicketLink(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.nativeReady(w) {
		return
	}
	var in sdi.NativeTicketLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	out, err := h.NativeSignIn.LinkTicket(h.authCtx(r).Context(), in.Ticket, in.Nonce,
		service.TicketLink{Move: in.Move, StepUpToken: in.StepUpToken}, nativeClient(in.NativeClientSDI))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toSignInMethodsChangeSDO(out))
}

// signInMethodLinkNative links provider from the app's Settings with the
// token the provider's own sheet returned (spec §3.7).
func (h *handlers) signInMethodLinkNative(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if !h.signInMethodsReady(w) {
			return
		}
		if provider == service.ProviderGoogle && !h.Auth.GoogleNativeEnabled() {
			respondError(w, http.StatusServiceUnavailable, "google_not_configured", "Google sign-in in the app is not configured")
			return
		}
		if provider == service.ProviderApple && !h.AppleAuth.NativeEnabled() {
			respondError(w, http.StatusServiceUnavailable, "apple_auth_unavailable", "Sign in with Apple is not configured")
			return
		}
		var link service.AppLink
		if provider == service.ProviderGoogle {
			var in sdi.LinkGoogleNativeSDI
			if !decode(w, r, &in, maxJSONBody) {
				return
			}
			link = service.AppLink{StepUpToken: in.StepUpToken, Token: in.IDToken, Nonce: in.Nonce, Move: in.Move}
		} else {
			var in sdi.LinkAppleNativeSDI
			if !decode(w, r, &in, maxJSONBody) {
				return
			}
			link = service.AppLink{StepUpToken: in.StepUpToken, Token: in.IdentityToken, Nonce: in.Nonce, AuthorizationCode: in.AuthorizationCode, Move: in.Move}
		}
		out, err := h.SignInMethods.LinkFromApp(h.authCtx(r).Context(), middleware.UserID(r.Context()), provider, link)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, toSignInMethodsChangeSDO(out))
	}
}
