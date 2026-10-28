package mail

import (
	"fmt"
	"time"
)

// The changes a sign_in_method_changed mail tells of (ADR 0049).
const (
	SignInChangeLinked             = "linked"
	SignInChangeUnlinked           = "unlinked"
	SignInChangeReclaimed          = "reclaimed"
	SignInChangeMoved              = "moved"
	SignInChangePasswordSet        = "password_set"
	SignInChangePasswordChanged    = "password_changed"
	SignInChangeSecondFactorLocked = "second_factor_locked"
)

// The sign-in methods a change can be about.
const (
	SignInMethodGoogle   = "google"
	SignInMethodApple    = "apple"
	SignInMethodPassword = "password"
)

// signInChangeMethods is, per change, the methods it can name: a provider
// change names a provider, a password change the password, a lockout none.
var signInChangeMethods = map[string][]string{
	SignInChangeLinked:             {SignInMethodGoogle, SignInMethodApple},
	SignInChangeUnlinked:           {SignInMethodGoogle, SignInMethodApple},
	SignInChangeMoved:              {SignInMethodGoogle, SignInMethodApple},
	SignInChangeReclaimed:          {SignInMethodGoogle, SignInMethodApple, SignInMethodPassword},
	SignInChangePasswordSet:        {SignInMethodPassword},
	SignInChangePasswordChanged:    {SignInMethodPassword},
	SignInChangeSecondFactorLocked: {""},
}

type SignInMethodChangedData struct {
	// Change is one of the SignInChange* constants.
	Change string
	// Method is the SignInMethod* the change is about; "" for a lockout.
	Method string
	// MovedAway, on a move: the identity left this account (the empty one it
	// was taken from) instead of arriving in it.
	MovedAway bool
	// Device and IP name where the change came from; the caller passes them
	// through SafeField and the template escapes them again. Either may be
	// empty.
	Device string
	IP     string
	At     time.Time
	// LockedFor, on a lockout: how long the second factor stays locked, the
	// same Duration the service enforces, so copy and behaviour cannot drift.
	LockedFor time.Duration
}

// signInMethodChangedView is what the templates read: the caller's data plus
// the method's name in the mail's language and the two links every variant
// carries, built here so no caller can point them elsewhere.
type signInMethodChangedView struct {
	SignInMethodChangedData
	MethodName  string
	SecurityURL string
	ResetURL    string
}

// SignInMethodChanged tells the owner that a way into their account changed,
// with where it came from, a link to review security settings and one to
// reset the password if it was not them.
func (r Renderer) SignInMethodChanged(to, locale, userID string, d SignInMethodChangedData) (Message, error) {
	methods, ok := signInChangeMethods[d.Change]
	if !ok {
		return Message{}, fmt.Errorf("mail: unknown sign-in change %q", d.Change)
	}
	known := false
	for _, m := range methods {
		known = known || m == d.Method
	}
	if !known {
		return Message{}, fmt.Errorf("mail: sign-in change %q cannot name method %q", d.Change, d.Method)
	}
	locale = normalizeLocale(locale)
	view := signInMethodChangedView{
		SignInMethodChangedData: d,
		MethodName:              signInMethodName(d.Method, locale),
		SecurityURL:             r.AppURL + "/settings?tab=security",
		ResetURL:                r.AppURL + "/forgot-password",
	}
	subject, html, text, err := renderKind(KindSignInMethodChanged, locale, r.AppURL, view)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindSignInMethodChanged, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}

func signInMethodName(method, locale string) string {
	switch method {
	case SignInMethodGoogle:
		return "Google"
	case SignInMethodApple:
		return "Apple"
	case SignInMethodPassword:
		if locale == "vi" {
			return "mật khẩu"
		}
		return "password"
	default:
		return ""
	}
}
