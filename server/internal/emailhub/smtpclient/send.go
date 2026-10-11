package smtpclient

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// Credentials for authenticated SMTP submission.
type Credentials struct {
	Host  string
	Port  int
	Email string // envelope sender, From header and Message-ID domain
	// Username is the AUTH login; empty means Email.
	Username string
	Password string
	// Security is "tls" (implicit TLS) or "starttls" (required); empty means "tls".
	Security string
	// AccessToken is an OAuth access token; when set, AUTH XOAUTH2 replaces
	// PLAIN/LOGIN and Password is ignored.
	AccessToken string
}

// Message is one outbound mail.
type Message struct {
	To          []string
	Cc          []string
	Bcc         []string
	Subject     string
	BodyText    string
	BodyHTML    string
	Attachments []OutboundAttachment
	InReplyTo   string
	References  string
	MessageID   string
}

// VerifyLogin checks SMTP credentials without sending a message.
func VerifyLogin(c Credentials) error {
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	client, err := authenticate(ctx, c)
	if err != nil {
		return err
	}
	return client.Close()
}

// Send delivers a message over implicit TLS or required STARTTLS, per c.Security.
// It returns the Message-ID and the MIME exactly as written after DATA (no Bcc
// header, before dot-stuffing), which the caller can file in the Sent mailbox.
func Send(ctx context.Context, c Credentials, msg Message) (string, []byte, error) {
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	to := cleanAddrs(msg.To)
	if len(to) == 0 {
		return "", nil, fmt.Errorf("smtp: at least one recipient required")
	}
	msgID := strings.TrimSpace(msg.MessageID)
	if msgID == "" {
		msgID = newMessageID(c.Email)
	}
	raw := []byte(buildRaw(c.Email, to, msg.Cc, msg.Bcc, msg.Subject, msg.BodyText, msg.BodyHTML, msg.Attachments, msgID, msg.InReplyTo, msg.References))

	client, err := authenticate(ctx, c)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = client.Close() }()

	if err := client.Mail(c.Email); err != nil {
		return "", nil, fmt.Errorf("smtp mail from: %w", err)
	}
	for _, rcpt := range append(append(to, cleanAddrs(msg.Cc)...), cleanAddrs(msg.Bcc)...) {
		if err := client.Rcpt(rcpt); err != nil {
			return "", nil, fmt.Errorf("smtp rcpt %s: %w", rcpt, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return "", nil, fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return "", nil, fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", nil, fmt.Errorf("smtp close data: %w", err)
	}
	return msgID, raw, nil
}

func cleanAddrs(in []string) []string {
	out := make([]string, 0, len(in))
	for _, a := range in {
		a = strings.TrimSpace(strings.ToLower(a))
		if a != "" && !strings.ContainsAny(a, "\r\n") {
			out = append(out, a)
		}
	}
	return out
}

func newMessageID(fromEmail string) string {
	domain := "localhost"
	if at := strings.LastIndex(fromEmail, "@"); at >= 0 && at < len(fromEmail)-1 {
		domain = fromEmail[at+1:]
	}
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("<%s@%s>", hex.EncodeToString(buf), domain)
}

func buildRaw(
	from string, to, cc, bcc []string, subject, bodyText, bodyHTML string,
	attachments []OutboundAttachment, msgID, inReplyTo, references string,
) string {
	var b strings.Builder
	now := time.Now().Format(time.RFC1123Z)
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + strings.Join(to, ", ") + "\r\n")
	if len(cc) > 0 {
		b.WriteString("Cc: " + strings.Join(cc, ", ") + "\r\n")
	}
	b.WriteString("Subject: " + encodeHeader(subject) + "\r\n")
	b.WriteString("Date: " + now + "\r\n")
	b.WriteString("Message-ID: " + msgID + "\r\n")
	if inReplyTo != "" {
		b.WriteString("In-Reply-To: " + inReplyTo + "\r\n")
	}
	if references != "" {
		b.WriteString("References: " + references + "\r\n")
	}
	contentType, body := buildBodyPart(bodyText, bodyHTML, attachments)
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: " + contentType + "\r\n")
	if !strings.HasPrefix(contentType, "multipart/") {
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	}
	b.WriteString("\r\n")
	b.WriteString(body)
	if !strings.HasSuffix(body, "\r\n") {
		b.WriteString("\r\n")
	}
	return b.String()
}

func encodeHeader(s string) string {
	if strings.ContainsAny(s, "\r\n") {
		return strings.Map(func(r rune) rune {
			if r == '\r' || r == '\n' {
				return ' '
			}
			return r
		}, s)
	}
	return s
}
