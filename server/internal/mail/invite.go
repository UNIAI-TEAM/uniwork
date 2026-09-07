package mail

import "time"

type InviteData struct {
	InviterName   string
	WorkspaceName string
	AcceptURL     string
	Expires       time.Duration
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

// OrganizationInviteData is the invitation to the company itself: there is no
// workspace behind it, so the copy names the organization.
type OrganizationInviteData struct {
	InviterName      string
	OrganizationName string
	AcceptURL        string
	Expires          time.Duration
}

// OrganizationInvite goes to an address that may have no account, so UserID is
// empty and the locale is the inviter's.
func (r Renderer) OrganizationInvite(to, locale string, d OrganizationInviteData) (Message, error) {
	locale = normalizeLocale(locale)
	d.InviterName = SafeField(d.InviterName)
	d.OrganizationName = SafeField(d.OrganizationName)
	subject, html, text, err := renderKind(KindOrganizationInvite, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindOrganizationInvite, Locale: locale, To: to, Subject: subject, HTML: html, Text: text}, nil
}
