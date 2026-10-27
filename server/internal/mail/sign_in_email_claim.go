package mail

import (
	"fmt"
	"time"
)

// SignInEmailClaimData is the code that proves an address typed during a
// pending provider sign-in ("I was invited with another address", ADR 0047).
type SignInEmailClaimData struct {
	Code    string
	Expires time.Duration
	// Method is the SignInMethodGoogle or SignInMethodApple sign-in waiting
	// on this address.
	Method string
}

type signInEmailClaimView struct {
	SignInEmailClaimData
	MethodName string
}

// SignInEmailClaim mails the code to an address that may have no account
// yet, so it names no user. The expiry is the one the service enforces.
func (r Renderer) SignInEmailClaim(to, locale string, d SignInEmailClaimData) (Message, error) {
	if d.Method != SignInMethodGoogle && d.Method != SignInMethodApple {
		return Message{}, fmt.Errorf("mail: an email claim waits on a provider, not %q", d.Method)
	}
	locale = normalizeLocale(locale)
	view := signInEmailClaimView{SignInEmailClaimData: d, MethodName: signInMethodName(d.Method, locale)}
	subject, html, text, err := renderKind(KindSignInEmailClaim, locale, r.AppURL, view)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindSignInEmailClaim, Locale: locale, To: to, Subject: subject, HTML: html, Text: text}, nil
}
