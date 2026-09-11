package mail

// DigestItem is one line of the daily notification digest.
type DigestItem struct {
	Title string
	URL   string
	Count int // > 1 when several events merged into this line
}

// DigestGroup is the lines of one workspace. Key is the workspace id (empty
// for organization-level rows) and is only used for grouping.
type DigestGroup struct {
	Key       string
	Workspace string
	Items     []DigestItem
}

// DigestData is what the notification_digest template renders.
type DigestData struct {
	DisplayName string
	Groups      []DigestGroup
	More        int // rows beyond the cap, mentioned as "and N more"
	SettingsURL string
}

// NotificationDigest renders the once-a-day unread summary (F-07 §4.4).
func (r Renderer) NotificationDigest(to, locale, userID string, d DigestData) (Message, error) {
	locale = normalizeLocale(locale)
	d.DisplayName = SafeField(d.DisplayName)
	for gi := range d.Groups {
		d.Groups[gi].Workspace = SafeField(d.Groups[gi].Workspace)
		for ii := range d.Groups[gi].Items {
			d.Groups[gi].Items[ii].Title = stripControl(d.Groups[gi].Items[ii].Title, maxSubjectRunes)
		}
	}
	subject, html, text, err := renderKind(KindNotificationDigest, locale, r.AppURL, d)
	if err != nil {
		return Message{}, err
	}
	return Message{Kind: KindNotificationDigest, Locale: locale, UserID: userID, To: to, Subject: subject, HTML: html, Text: text}, nil
}
