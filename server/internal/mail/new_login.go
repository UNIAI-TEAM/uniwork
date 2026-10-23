package mail

import "time"

type NewLoginData struct {
	UserAgent   string
	IP          string
	At          time.Time
	SessionsURL string
	// App: the sign-in opened a session of the phone app (ADR 0041), and
	// UserAgent is the device's label, not a browser string.
	App bool
}

// NewLogin is the alert for a sign-in from a browser the account has not
// used before (F-01), or for a new phone session (App). UserAgent and IP are
// passed through SafeField by the caller; the template escapes them again.
func (r Renderer) NewLogin(to, locale, userID string, d NewLoginData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindNewLogin, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindNewLogin, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
