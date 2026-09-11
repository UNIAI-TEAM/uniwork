package mail

import "time"

type VerificationData struct {
	Code    string
	Expires time.Duration
}

// VerificationCode is the sign-up code mail. The expiry is a parameter so
// the copy and the service that enforces it share one number.
func (r Renderer) VerificationCode(to, locale, userID string, d VerificationData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindVerificationCode, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindVerificationCode, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
