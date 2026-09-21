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
	Host     string
	Port     int
	Email    string
	Password string
}

// Message is one outbound mail.
type Message struct {
	To         []string
	Cc         []string
	Subject    string
	BodyText   string
	InReplyTo  string
	References string
	MessageID  string
}

// VerifyLogin checks SMTP credentials without sending a message.
func VerifyLogin(c Credentials) error {
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	client, err := authenticate(ctx, c.Host, c.Port, c.Email, c.Password)
	if err != nil {
		return err
	}
	return client.Close()
}

// Send delivers a message via STARTTLS on the configured port (587 by default).
func Send(ctx context.Context, c Credentials, msg Message) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	to := cleanAddrs(msg.To)
	if len(to) == 0 {
		return "", fmt.Errorf("smtp: at least one recipient required")
	}
	msgID := strings.TrimSpace(msg.MessageID)
	if msgID == "" {
		msgID = newMessageID(c.Email)
	}
	raw := buildRaw(c.Email, to, msg.Cc, msg.Subject, msg.BodyText, msgID, msg.InReplyTo, msg.References)

	client, err := authenticate(ctx, c.Host, c.Port, c.Email, c.Password)
	if err != nil {
		return "", err
	}
	defer func() { _ = client.Close() }()

	if err := client.Mail(c.Email); err != nil {
		return "", fmt.Errorf("smtp mail from: %w", err)
	}
	for _, rcpt := range append(to, cleanAddrs(msg.Cc)...) {
		if err := client.Rcpt(rcpt); err != nil {
			return "", fmt.Errorf("smtp rcpt %s: %w", rcpt, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return "", fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write([]byte(raw)); err != nil {
		return "", fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("smtp close data: %w", err)
	}
	return msgID, nil
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

func buildRaw(from string, to, cc []string, subject, body, msgID, inReplyTo, references string) string {
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
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
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
