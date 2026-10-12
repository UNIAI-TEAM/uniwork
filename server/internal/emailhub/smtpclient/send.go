package smtpclient

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	preferredHeaderLineLen = 78
	subjectHeaderPrefixLen = len("Subject: ")
	maxHeaderWordLen       = preferredHeaderLineLen - subjectHeaderPrefixLen
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
		s = strings.Map(func(r rune) rune {
			if r == '\r' || r == '\n' {
				return ' '
			}
			return r
		}, s)
	}
	if headerNeedsEncoding(s) {
		s = encodeHeaderWords(s, maxHeaderWordLen)
	}
	return foldHeaderValue(s, subjectHeaderPrefixLen)
}

func headerNeedsEncoding(value string) bool {
	runLen := 0
	for i := 0; i < len(value); i++ {
		if (value[i] < ' ' || value[i] > '~') && value[i] != '\t' {
			return true
		}
		if value[i] == ' ' || value[i] == '\t' {
			runLen = 0
			continue
		}
		runLen++
		if runLen > maxHeaderWordLen {
			return true
		}
	}
	return false
}

func encodeHeaderWords(value string, maxWordLen int) string {
	if value == "" {
		return ""
	}
	const (
		wordPrefix = "=?UTF-8?q?"
		wordSuffix = "?="
	)
	maxContentLen := maxWordLen - len(wordPrefix) - len(wordSuffix)
	var words []string
	for start := 0; start < len(value); {
		end := start
		contentLen := 0
		for end < len(value) {
			_, size := utf8.DecodeRuneInString(value[end:])
			encodedLen := qEncodedLen(value[end : end+size])
			candidateEnd := end + size
			if end > start && contentLen+encodedLen > maxContentLen {
				break
			}
			end = candidateEnd
			contentLen += encodedLen
		}
		words = append(words, encodeQHeaderWord(value[start:end], wordPrefix, wordSuffix))
		start = end
	}
	return strings.Join(words, " ")
}

func qEncodedLen(value string) int {
	length := 0
	for i := 0; i < len(value); i++ {
		if value[i] == ' ' || (value[i] >= '!' && value[i] <= '~' && value[i] != '=' && value[i] != '?' && value[i] != '_') {
			length++
		} else {
			length += 3
		}
	}
	return length
}

func encodeQHeaderWord(value, prefix, suffix string) string {
	const upperHex = "0123456789ABCDEF"
	var encoded strings.Builder
	encoded.Grow(len(prefix) + qEncodedLen(value) + len(suffix))
	encoded.WriteString(prefix)
	for i := 0; i < len(value); i++ {
		b := value[i]
		switch {
		case b == ' ':
			encoded.WriteByte('_')
		case b >= '!' && b <= '~' && b != '=' && b != '?' && b != '_':
			encoded.WriteByte(b)
		default:
			encoded.WriteByte('=')
			encoded.WriteByte(upperHex[b>>4])
			encoded.WriteByte(upperHex[b&0x0f])
		}
	}
	encoded.WriteString(suffix)
	return encoded.String()
}

func foldHeaderValue(value string, initialLineLen int) string {
	var folded strings.Builder
	remaining := value
	lineLen := initialLineLen
	for len(remaining) > 0 {
		available := preferredHeaderLineLen - lineLen
		if len(remaining) <= available {
			folded.WriteString(remaining)
			break
		}

		split := lastHeaderWhitespace(remaining, available)
		if split < 0 {
			// headerNeedsEncoding guarantees every indivisible word fits here.
			folded.WriteString(remaining)
			break
		}
		folded.WriteString(remaining[:split])
		folded.WriteString("\r\n")
		folded.WriteByte(remaining[split])
		remaining = remaining[split+1:]
		lineLen = 1
	}
	return folded.String()
}

func lastHeaderWhitespace(value string, limit int) int {
	if limit >= len(value) {
		limit = len(value) - 1
	}
	for i := limit; i >= 0; i-- {
		if value[i] == ' ' || value[i] == '\t' {
			return i
		}
	}
	return -1
}
