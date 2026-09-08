// Package mail sends transactional email. Sender is the only thing services
// depend on; New picks the SMTP implementation when SMTP_HOST is configured
// and otherwise a logger that prints the message, so local development and
// CI run without a mail server.
package mail

import (
	"context"
	"log/slog"
)

const (
	KindVerificationCode = "verification_code"
	KindPasswordReset    = "password_reset"
	KindWorkspaceInvite  = "workspace_invite"
	// An invitation to the organization itself, with no workspace behind it
	// (F-03). Its own kind because the copy says "join the company", which is
	// not what the workspace invitation says.
	KindOrganizationInvite = "organization_invite"
	KindWelcome            = "welcome"
	KindNotificationDigest = "notification_digest"
	// A sign-in from a browser the account has never used (F-01).
	KindNewLogin = "new_login"
)

type Message struct {
	Kind    string // Kind* constants
	Locale  string // "vi" | "en"
	UserID  string // "" when the recipient has no account (invites)
	To      string
	Subject string
	HTML    string
	Text    string
}

type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// New picks the transport: SMTP when cfg.Host is set, otherwise LogSender.
// One Info line records the choice so an operator can tell from the boot log
// whether mail actually leaves the process.
func New(cfg SMTPConfig, log *slog.Logger) (Sender, error) {
	if log == nil {
		log = slog.Default()
	}
	if cfg.Host == "" {
		log.Info("mail: log mode, messages are printed")
		return LogSender{Log: log}, nil
	}
	s, err := NewSMTP(cfg)
	if err != nil {
		return nil, err
	}
	log.Info("mail: smtp", "addr", s.Addr(), "tls", s.TLSMode(), "from", s.from, "auth", s.username != "")
	return s, nil
}

// LogSender prints the message at Info level. The text body carries the
// verification code, which is how a developer reads it from the terminal.
type LogSender struct {
	Log *slog.Logger
}

func (s LogSender) Send(_ context.Context, msg Message) error {
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	log.Info("mail not configured, printing message", "kind", msg.Kind, "to", msg.To, "subject", msg.Subject, "text", msg.Text) // log-pii-ok: dev sink replaces SMTP; the address is the message
	return nil
}
