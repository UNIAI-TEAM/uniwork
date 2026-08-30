package mail

type InviteData struct {
	InviterName   string
	WorkspaceName string
	AcceptURL     string
	ExpiresInDays int
}

// Invite goes to an address that may have no account, so UserID is empty
// and the locale is the inviter's. User fields are trimmed with SafeField.
func (r Renderer) Invite(to, locale string, d InviteData) (Message, error) {
	locale = normalizeLocale(locale)
	d.InviterName = SafeField(d.InviterName)
	d.WorkspaceName = SafeField(d.WorkspaceName)
	subject, html, text, err := renderKind(KindWorkspaceInvite, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindWorkspaceInvite, Locale: locale, To: to, Subject: subject, HTML: html, Text: text}, nil
}
