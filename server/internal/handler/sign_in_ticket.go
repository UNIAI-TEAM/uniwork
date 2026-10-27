package handler

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// signInTicketCookie carries a browser's pending provider sign-in (ADR 0047,
// spec §3.2) from the provider's callback to the choice screen's commands.
// HttpOnly, so no script reads the identity; Lax, so it rides the same-site
// fetches of /auth/continue and the top-level navigation back from the
// provider; on /api/v1/auth only.
const signInTicketCookie = "uniwork_sign_in_ticket"

const signInTicketCookieTTL = 15 * time.Minute

func (h *handlers) setSignInTicketCookie(w http.ResponseWriter, ticket string) {
	http.SetCookie(w, &http.Cookie{
		Name: signInTicketCookie, Value: ticket, Path: "/api/v1/auth",
		MaxAge: int(signInTicketCookieTTL / time.Second), HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}

// clearSignInTicket drops the pending sign-in: every sign-in that is not the
// one linking it, every sign-out, and every ticket command that spent it.
func (h *handlers) clearSignInTicket(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: signInTicketCookie, Value: "", Path: "/api/v1/auth", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}

func signInTicketFrom(r *http.Request) string {
	if c, err := r.Cookie(signInTicketCookie); err == nil {
		return c.Value
	}
	return ""
}

// keepsSignInTicket: a browser sign-in whose next is the choice screen's
// link step is "I already have an account" (spec §4.3, §4.4), so it keeps the
// ticket the person is about to link.
func keepsSignInTicket(next string) bool {
	u, err := url.Parse(next)
	return err == nil && u.Path == "/auth/continue" && u.Query().Get("step") == "link"
}

// ticketRefused answers a ticket command's failure; a ticket that is gone
// takes its cookie with it.
func (h *handlers) ticketRefused(w http.ResponseWriter, err error) {
	if errors.Is(err, service.ErrSignInTicketMissing) {
		h.clearSignInTicket(w)
	}
	h.mapServiceError(w, err)
}

func (h *handlers) signInTicket(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	t, err := h.SignInTickets.Describe(r.Context(), signInTicketFrom(r), service.WebTicket())
	if err != nil {
		h.ticketRefused(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.SignInTicketSDO{
		Provider: t.Provider, Kind: t.Kind, Email: t.Email, Name: t.Name, PrivateRelay: t.PrivateRelay,
	})
}

func (h *handlers) signInTicketCreate(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	var in sdi.SignInTicketCreateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.SignInTickets.Create(h.authCtx(r).Context(), signInTicketFrom(r), service.WebTicket(), in.DisplayName, requestLocale(r))
	if err != nil {
		h.ticketRefused(w, err)
		return
	}
	h.clearSignInTicket(w)
	h.sessionResponse(w, sess)
}

func (h *handlers) signInTicketClaimEmail(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	var in sdi.SignInEmailClaimSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.SignInTickets.SendEmailClaim(r.Context(), signInTicketFrom(r), service.WebTicket(), in.Email, requestLocale(r)); err != nil {
		h.ticketRefused(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "sent"})
}

func (h *handlers) signInTicketClaimEmailVerify(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	var in sdi.SignInEmailClaimVerifySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sess, err := h.SignInTickets.VerifyEmailClaim(h.authCtx(r).Context(), signInTicketFrom(r), service.WebTicket(),
		in.Email, in.Code, in.DisplayName, requestLocale(r))
	if err != nil {
		h.ticketRefused(w, err)
		return
	}
	h.clearSignInTicket(w)
	h.sessionResponse(w, sess)
}

func (h *handlers) signInTicketDiscard(w http.ResponseWriter, r *http.Request) {
	h.SignInTickets.Discard(r.Context(), signInTicketFrom(r), service.WebTicket())
	h.clearSignInTicket(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) signInTicketLink(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	var in sdi.SignInTicketLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	out, err := h.SignInTickets.Link(h.authCtx(r).Context(), signInTicketFrom(r), service.WebTicket(), in.Move)
	if err != nil {
		h.ticketRefused(w, err)
		return
	}
	h.clearSignInTicket(w)
	respondJSON(w, http.StatusOK, toSignInMethodsChangeSDO(out))
}

func rfc3339Ptr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func toSignInMethodsSDO(m service.SignInMethods) sdo.SignInMethodsSDO {
	proofs := m.Proofs
	if proofs == nil {
		proofs = []string{}
	}
	return sdo.SignInMethodsSDO{
		Password: sdo.SignInPasswordSDO{Set: m.PasswordSet, ChangedAt: rfc3339Ptr(m.PasswordChangedAt)},
		Google: sdo.SignInProviderSDO{
			Linked: m.Google.Linked, Email: nonEmpty(m.Google.Email), LinkedAt: rfc3339Ptr(m.Google.LinkedAt),
		},
		Apple: sdo.SignInAppleSDO{
			Linked: m.Apple.Linked, Email: nonEmpty(m.Apple.Email), LinkedAt: rfc3339Ptr(m.Apple.LinkedAt),
			PrivateRelay: m.Apple.PrivateRelay,
		},
		AccountEmailIsRelay: m.AccountEmailIsRelay,
		Proofs:              proofs,
	}
}

func toSignInMethodsChangeSDO(c service.SignInMethodsChange) sdo.SignInMethodsChangeSDO {
	return sdo.SignInMethodsChangeSDO{User: toUserDTO(c.User), SignInMethods: toSignInMethodsSDO(c.Methods)}
}
