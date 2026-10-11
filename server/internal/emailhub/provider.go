package emailhub

import (
	"strings"
)

// Provider holds IMAP/SMTP endpoints for a mailbox vendor.
type Provider struct {
	Name     string
	IMAPHost string
	IMAPPort int
	SMTPHost string
	SMTPPort int
}

var providers = map[string]Provider{
	"gmail.com": {
		Name: "gmail", IMAPHost: "imap.gmail.com", IMAPPort: 993,
		SMTPHost: "smtp.gmail.com", SMTPPort: 587,
	},
	"googlemail.com": {
		Name: "gmail", IMAPHost: "imap.gmail.com", IMAPPort: 993,
		SMTPHost: "smtp.gmail.com", SMTPPort: 587,
	},
	"outlook.com": {
		Name: "outlook", IMAPHost: "outlook.office365.com", IMAPPort: 993,
		SMTPHost: "smtp.office365.com", SMTPPort: 587,
	},
	"hotmail.com": {
		Name: "outlook", IMAPHost: "outlook.office365.com", IMAPPort: 993,
		SMTPHost: "smtp.office365.com", SMTPPort: 587,
	},
	"live.com": {
		Name: "outlook", IMAPHost: "outlook.office365.com", IMAPPort: 993,
		SMTPHost: "smtp.office365.com", SMTPPort: 587,
	},
	"msn.com": {
		Name: "outlook", IMAPHost: "outlook.office365.com", IMAPPort: 993,
		SMTPHost: "smtp.office365.com", SMTPPort: 587,
	},
	"yahoo.com": {
		Name: "yahoo", IMAPHost: "imap.mail.yahoo.com", IMAPPort: 993,
		SMTPHost: "smtp.mail.yahoo.com", SMTPPort: 587,
	},
}

// ProviderForEmail maps an address domain to known IMAP/SMTP settings.
func ProviderForEmail(email string) (Provider, bool) {
	at := strings.LastIndex(email, "@")
	if at < 0 || at == len(email)-1 {
		return Provider{}, false
	}
	domain := strings.ToLower(strings.TrimSpace(email[at+1:]))
	p, ok := providers[domain]
	return p, ok
}

// ServerSavesSent reports whether mail submitted over SMTP for a mailbox on
// this IMAP host is filed in Sent by the server itself (Gmail, Microsoft 365,
// including custom domains hosted there), so an IMAP APPEND would duplicate it.
func ServerSavesSent(imapHost string) bool {
	switch strings.ToLower(imapHost) {
	case "imap.gmail.com", "outlook.office365.com":
		return true
	}
	return false
}
