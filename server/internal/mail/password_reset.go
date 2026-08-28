package mail

type PasswordResetData struct {
	ResetURL         string
	ExpiresInMinutes int
}

// PasswordReset is the one-time reset-link mail.
func (r Renderer) PasswordReset(to, locale, userID string, d PasswordResetData) (Message, error) {
	locale = normalizeLocale(locale)
	subject, html, text, err := renderKind(KindPasswordReset, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindPasswordReset, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
