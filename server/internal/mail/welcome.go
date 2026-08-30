package mail

type WelcomeData struct {
	DisplayName   string
	WorkspaceName string
	WorkspaceURL  string
}

// Welcome goes to a user who just finished onboarding into a workspace.
// User fields are trimmed with SafeField before rendering.
func (r Renderer) Welcome(to, locale, userID string, d WelcomeData) (Message, error) {
	locale = normalizeLocale(locale)
	d.DisplayName = SafeField(d.DisplayName)
	d.WorkspaceName = SafeField(d.WorkspaceName)
	subject, html, text, err := renderKind(KindWelcome, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindWelcome, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
