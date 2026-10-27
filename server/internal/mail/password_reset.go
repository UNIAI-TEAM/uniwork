package mail

import (
	"fmt"
	"time"
)

type PasswordResetData struct {
	ResetURL string
	Expires  time.Duration
	// SetPassword: the account has no password yet, it signs in with a
	// provider (ADR 0047, spec §3.7). The same one-time link sets the first
	// one, and the mail says so instead of "reset".
	SetPassword bool
	// SignInWith is the providers (SignInMethodGoogle, SignInMethodApple)
	// that open the account; each is offered as a way in that needs no
	// password at all.
	SignInWith []string
}

// providerSignIn is one "Sign in with …" button of the set-a-password
// variant.
type providerSignIn struct {
	Name string
	URL  string
}

// passwordResetView adds the provider buttons, their links built here so no
// caller can point them elsewhere: the login page with provider set sends
// the browser straight to that provider (spec §3.5).
type passwordResetView struct {
	PasswordResetData
	Providers []providerSignIn
}

// PasswordReset is the one-time reset-link mail, or for an account without a
// password the set-a-password one with the provider sign-ins it has.
func (r Renderer) PasswordReset(to, locale, userID string, d PasswordResetData) (Message, error) {
	locale = normalizeLocale(locale)
	view := passwordResetView{PasswordResetData: d}
	for _, m := range d.SignInWith {
		if m != SignInMethodGoogle && m != SignInMethodApple {
			return Message{}, fmt.Errorf("mail: a password reset offers a provider sign-in, not %q", m)
		}
		view.Providers = append(view.Providers, providerSignIn{Name: signInMethodName(m, locale), URL: r.AppURL + "/login?provider=" + m})
	}
	subject, html, text, err := renderKind(KindPasswordReset, locale, r.AppURL, view)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindPasswordReset, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
