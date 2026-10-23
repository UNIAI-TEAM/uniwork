package smtpclient

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

const (
	dialTimeout    = 15 * time.Second
	sessionTimeout = 30 * time.Second
)

var (
	// ErrAuthFailed means the server rejected the credentials (535/534).
	ErrAuthFailed = errors.New("smtp authentication failed")
	// ErrSMTPAuthDisabled means the mailbox has SMTP AUTH turned off (M365); the credential may still be valid.
	ErrSMTPAuthDisabled = errors.New("smtp auth disabled for mailbox")
	// ErrTLSRequired means a starttls account's server does not offer STARTTLS.
	ErrTLSRequired = errors.New("smtp server does not offer STARTTLS")
)

// Only this package's tests replace these.
var (
	dialTCP    = netguard.Dial
	tlsRootCAs *x509.CertPool
)

func openSession(ctx context.Context, c Credentials) (*smtp.Client, error) {
	security := c.Security
	if security == "" {
		security = "tls"
	}
	if security != "tls" && security != "starttls" {
		return nil, fmt.Errorf("smtp: unknown security mode %q", security)
	}
	tlsCfg := &tls.Config{
		ServerName: c.Host,
		MinVersion: tls.VersionTLS12,
		RootCAs:    tlsRootCAs,
	}
	conn, err := dialTCP(ctx, "tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.Port)))
	if err != nil {
		return nil, fmt.Errorf("smtp dial: %w", err)
	}

	// One deadline on the raw conn covers greeting, implicit-TLS and STARTTLS handshakes and auth (net/smtp never resets it).
	deadline := time.Now().Add(sessionTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp set deadline: %w", err)
	}
	if security == "tls" {
		conn = tls.Client(conn, tlsCfg)
	}

	client, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	if hostname, err := os.Hostname(); err == nil {
		hostname = strings.TrimSpace(hostname)
		if hostname != "" {
			if err := client.Hello(hostname); err != nil {
				_ = client.Close()
				return nil, fmt.Errorf("smtp ehlo: %w", err)
			}
		}
	}
	if security == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			_ = client.Close()
			return nil, ErrTLSRequired
		}
		if err := client.StartTLS(tlsCfg); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp starttls: %w", err)
		}
	}
	return client, nil
}

func authenticate(ctx context.Context, c Credentials) (*smtp.Client, error) {
	user := c.Username
	if user == "" {
		user = c.Email
	}
	client, err := openSession(ctx, c)
	if err != nil {
		return nil, err
	}
	if c.AccessToken != "" {
		// No PLAIN/LOGIN fallback: an OAuth account has no password to offer.
		if err := client.Auth(&xoauth2Auth{username: user, token: c.AccessToken, host: c.Host}); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: %w", classifyAuthErr(err))
		}
		return client, nil
	}
	fallback, authErr := smtpAuthWithFallback(client, c.Host, user, c.Password)
	if authErr != nil {
		_ = client.Close()
		if !fallback {
			return nil, fmt.Errorf("smtp auth: %w", classifyAuthErr(authErr))
		}
		client, err = openSession(ctx, c)
		if err != nil {
			return nil, fmt.Errorf("smtp auth: plain failed (%v); reconnect: %w", authErr, err)
		}
		if err = client.Auth(&loginAuth{username: user, password: c.Password, host: c.Host}); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: plain failed (%v); login: %w", authErr, classifyAuthErr(err))
		}
	}
	return client, nil
}

// classifyAuthErr matches M365's disabled-AUTH text, not its 5.7.139 code, which M365 also uses for bad credentials.
func classifyAuthErr(err error) error {
	var te *textproto.Error
	switch {
	case !errors.As(err, &te):
		return err
	case strings.Contains(te.Msg, "SmtpClientAuthentication is disabled"):
		return fmt.Errorf("%w: %w", ErrSMTPAuthDisabled, err)
	case te.Code == 535 || te.Code == 534:
		return fmt.Errorf("%w: %w", ErrAuthFailed, err)
	}
	return err
}
