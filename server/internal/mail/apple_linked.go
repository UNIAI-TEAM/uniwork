package mail

import "time"

type AppleLinkedData struct {
	Device      string
	IP          string
	At          time.Time
	SessionsURL string
}

// AppleLinked tells the owner that Sign in with Apple was linked to their
// account by its address and signed a phone in (ADR 0041). Device and IP are
// passed through SafeField by the caller; the template escapes them again.
func (r Renderer) AppleLinked(to, locale, userID string, d AppleLinkedData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindAppleLinked, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindAppleLinked, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
