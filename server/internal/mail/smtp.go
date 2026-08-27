package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strings"
	"time"
)

const (
	smtpDialTimeout    = 10 * time.Second
	smtpSessionTimeout = 30 * time.Second
	defaultSMTPPort    = "25"
)

// SMTPConfig carries plain values; the config package reads the environment
// and fills it, this package never touches os.Getenv.
type SMTPConfig struct {
	Host     string
	Port     string // default "25"
	Username string // empty means an unauthenticated relay
	Password string
	From     string // required
	// TLS selects the transport: "starttls" (default) upgrades a plain
	// connection when the server advertises STARTTLS; "implicit", "smtps" or
	// "ssl" open a TLS connection immediately (SMTPS). An empty value on port
	// 465 also means implicit. Unknown values fall back to starttls.
	TLS         string
	TLSInsecure bool   // skip certificate verification (self-signed relays)
	EHLOName    string // default os.Hostname()
}

// SMTPSender delivers messages through one SMTP relay. It opens a fresh
// connection per message; transactional volume does not justify pooling.
type SMTPSender struct {
	host        string
	port        string
	username    string
	password    string
	from        string
	tlsInsecure bool
	tlsImplicit bool
	ehloName    string
}

// NewSMTP resolves the configuration. It is the only place that consults
// os.Hostname(), so the log-mode path never does.
func NewSMTP(cfg SMTPConfig) (*SMTPSender, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, errors.New("mail: SMTP host is required")
	}
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		return nil, errors.New("mail: SMTP from address is required")
	}
	port := strings.TrimSpace(cfg.Port)
	if port == "" {
		port = defaultSMTPPort
	}

	// net/smtp greets with "localhost" by default, which strict relays
	// (e.g. smtp-relay.gmail.com) reject from a public source. Prefer the
	// configured name, then the machine hostname. If Hostname() fails the name
	// stays empty and Send skips the explicit EHLO.
	ehloName := strings.TrimSpace(cfg.EHLOName)
	if ehloName == "" {
		if hostname, err := os.Hostname(); err == nil {
			ehloName = hostname
		}
	}

	return &SMTPSender{
		host:        host,
		port:        port,
		username:    cfg.Username,
		password:    cfg.Password,
		from:        from,
		tlsInsecure: cfg.TLSInsecure,
		tlsImplicit: resolveImplicitTLS(cfg.TLS, port),
		ehloName:    ehloName,
	}, nil
}

// resolveImplicitTLS reports whether the connection starts with a TLS
// handshake. Providers such as Aliyun enterprise mail only offer port 465
// SSL and never advertise STARTTLS.
func resolveImplicitTLS(mode, port string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "implicit", "smtps", "ssl":
		return true
	case "":
		return port == "465"
	default:
		// "starttls" and anything unrecognised keep the upgrade behaviour.
		return false
	}
}

// Addr is the host:port the sender dials.
func (s *SMTPSender) Addr() string {
	return net.JoinHostPort(s.host, s.port)
}

// TLSMode is a label for logs: "starttls" or "implicit-tls".
func (s *SMTPSender) TLSMode() string {
	if s.tlsImplicit {
		return "implicit-tls"
	}
	return "starttls"
}

// Send delivers one message. It supports unauthenticated relays (empty
// Username) and authenticated SMTP with a PLAIN→LOGIN fallback for servers
// like Office 365 that reject PLAIN with "504 5.7.4".
func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	to := strings.TrimSpace(msg.To)
	if to == "" || strings.ContainsAny(to, "\r\n") {
		return fmt.Errorf("mail: invalid recipient %q", msg.To)
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	c, err := s.open(ctx)
	if err != nil {
		return err
	}
	// c is reassigned on the LOGIN reconnect; the closure closes whichever
	// client is current when Send returns.
	defer func() { _ = c.Close() }()

	if s.username != "" {
		fallbackToLogin, authErr := smtpAuthWithFallback(c, s.host, s.username, s.password)
		if authErr != nil {
			if !fallbackToLogin {
				return fmt.Errorf("smtp auth: %w", authErr)
			}
			// net/smtp sends QUIT after a failed AUTH, so the session is gone:
			// reconnect and try LOGIN on a fresh one.
			_ = c.Close()
			c, err = s.open(ctx)
			if err != nil {
				return fmt.Errorf("smtp auth: plain auth failed (%v); login reconnect failed: %w", authErr, err)
			}
			if err = c.Auth(&loginAuth{username: s.username, password: s.password, host: s.host}); err != nil {
				return fmt.Errorf("smtp auth: plain auth failed (%v); login auth fallback failed: %w", authErr, err)
			}
		}
	}

	// Probe 8BITMIME after (possible) STARTTLS so the extension list is
	// current. Relays that do not advertise it get quoted-printable, which is
	// safe for Vietnamese text crossing strict or older hops.
	has8Bit, _ := c.Extension("8BITMIME")
	body, err := buildMessage(s.from, to, msg, s.host, has8Bit, time.Now())
	if err != nil {
		return fmt.Errorf("smtp build message: %w", err)
	}

	if err = c.Mail(s.from); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err = c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO <%s>: %w", to, err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err = w.Write(body); err != nil {
		return fmt.Errorf("smtp write body: %w", err)
	}
	if err = w.Close(); err != nil {
		return fmt.Errorf("smtp end data: %w", err)
	}
	return c.Quit()
}

// open dials, greets and (for starttls mode) upgrades the connection.
func (s *SMTPSender) open(ctx context.Context) (*smtp.Client, error) {
	addr := s.Addr()
	tlsCfg := &tls.Config{
		ServerName:         s.host,
		InsecureSkipVerify: s.tlsInsecure, // opt-in via SMTPConfig.TLSInsecure
		MinVersion:         tls.VersionTLS12,
	}
	dialer := &net.Dialer{Timeout: smtpDialTimeout}

	var conn net.Conn
	var err error
	if s.tlsImplicit {
		td := &tls.Dialer{NetDialer: dialer, Config: tlsCfg}
		conn, err = td.DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, fmt.Errorf("smtp dial %s: %w", addr, err)
	}

	deadline := time.Now().Add(smtpSessionTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err = conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp set deadline: %w", err)
	}

	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}

	if s.ehloName != "" {
		if err = c.Hello(s.ehloName); err != nil {
			_ = c.Close()
			return nil, fmt.Errorf("smtp EHLO %s: %w", s.ehloName, err)
		}
	}

	if !s.tlsImplicit {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err = c.StartTLS(tlsCfg); err != nil {
				_ = c.Close()
				return nil, fmt.Errorf("smtp starttls: %w", err)
			}
		}
	}

	return c, nil
}

// smtpAuthClient is the slice of *smtp.Client the fallback needs; tests
// substitute a fake.
type smtpAuthClient interface {
	Auth(smtp.Auth) error
	Extension(string) (bool, string)
}

// smtpAuthWithFallback tries PLAIN and reports whether the caller should
// reconnect and retry with LOGIN: true only when the server rejected the
// mechanism itself (not the credentials) and advertises LOGIN. The PLAIN
// error is returned in both cases so the caller can include it.
func smtpAuthWithFallback(c smtpAuthClient, host, username, password string) (bool, error) {
	plainErr := c.Auth(smtp.PlainAuth("", username, password, host))
	if plainErr == nil {
		return false, nil
	}

	msg := strings.ToLower(plainErr.Error())
	if !strings.Contains(msg, "unrecognized authentication type") && !strings.Contains(msg, "504 5.7.4") {
		return false, plainErr
	}

	ok, authLine := c.Extension("AUTH")
	if !ok || !strings.Contains(strings.ToUpper(authLine), "LOGIN") {
		return false, plainErr
	}
	return true, plainErr
}

func isLocalhost(name string) bool {
	return name == "localhost" || name == "127.0.0.1" || name == "::1"
}

// loginAuth implements the legacy AUTH LOGIN mechanism with the same
// safeguards net/smtp applies to PLAIN: never over an unencrypted channel to
// a remote host, never to a server whose name differs from the one dialed.
type loginAuth struct {
	username string
	password string
	host     string
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !isLocalhost(server.Name) {
		return "", nil, errors.New("unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, fmt.Errorf("wrong host name: %q does not match expected %q", server.Name, a.host)
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}

	// net/smtp hands us the decoded challenge, but some servers send it
	// base64-encoded twice; accept either form.
	raw := strings.TrimSpace(string(fromServer))
	challenge := strings.ToLower(raw)
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		challenge = strings.ToLower(strings.TrimSpace(string(decoded)))
	}

	switch {
	case strings.Contains(challenge, "username") || strings.Contains(challenge, "user name"):
		return []byte(a.username), nil
	case strings.Contains(challenge, "password"):
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("unexpected LOGIN challenge %q", raw)
	}
}

// buildMessage renders the RFC 5322 message. Both bodies set produce
// multipart/alternative with text/plain first; otherwise the single part.
// The subject is Q-encoded so non-ASCII (and any control character) never
// reaches the header verbatim.
func buildMessage(from, to string, msg Message, host string, eightBit bool, now time.Time) ([]byte, error) {
	cte := "quoted-printable"
	if eightBit {
		cte = "8bit"
	}

	var b bytes.Buffer
	header := func(name, value string) {
		b.WriteString(name)
		b.WriteString(": ")
		b.WriteString(value)
		b.WriteString("\r\n")
	}
	header("From", from)
	header("To", to)
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", now.UTC().Format(time.RFC1123Z))
	header("Message-ID", messageID(host, now))
	header("MIME-Version", "1.0")

	switch {
	case msg.Text != "" && msg.HTML != "":
		mw := multipart.NewWriter(&b)
		header("Content-Type", mime.FormatMediaType("multipart/alternative", map[string]string{"boundary": mw.Boundary()}))
		b.WriteString("\r\n")
		parts := []struct{ contentType, body string }{
			{"text/plain", msg.Text},
			{"text/html", msg.HTML},
		}
		for _, p := range parts {
			pw, err := mw.CreatePart(textproto.MIMEHeader{
				"Content-Type":              {p.contentType + "; charset=UTF-8"},
				"Content-Transfer-Encoding": {cte},
			})
			if err != nil {
				return nil, err
			}
			if err := writeBody(pw, p.body, eightBit); err != nil {
				return nil, err
			}
		}
		if err := mw.Close(); err != nil {
			return nil, err
		}
	case msg.HTML != "":
		header("Content-Type", "text/html; charset=UTF-8")
		header("Content-Transfer-Encoding", cte)
		b.WriteString("\r\n")
		if err := writeBody(&b, msg.HTML, eightBit); err != nil {
			return nil, err
		}
	default:
		header("Content-Type", "text/plain; charset=UTF-8")
		header("Content-Transfer-Encoding", cte)
		b.WriteString("\r\n")
		if err := writeBody(&b, msg.Text, eightBit); err != nil {
			return nil, err
		}
	}
	return b.Bytes(), nil
}

// writeBody copies the part verbatim for 8bit and quoted-printable
// otherwise. Bare LF is normalised to CRLF by the DATA writer.
func writeBody(w io.Writer, body string, eightBit bool) error {
	if eightBit {
		_, err := io.WriteString(w, body)
		return err
	}
	qp := quotedprintable.NewWriter(w)
	if _, err := io.WriteString(qp, body); err != nil {
		return err
	}
	return qp.Close()
}

// messageID synthesises a Message-ID so relays and clients do not have to;
// a random suffix keeps two messages in the same nanosecond apart.
func messageID(host string, now time.Time) string {
	var nonce [8]byte
	_, _ = rand.Read(nonce[:])
	return fmt.Sprintf("<%d.%s@%s>", now.UnixNano(), hex.EncodeToString(nonce[:]), host)
}
