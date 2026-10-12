package smtpclient

import (
	"errors"
	"net/smtp"
	"slices"
	"strings"
	"testing"
)

type mockSMTPAuth struct {
	authErr  error
	authLine string
}

func (m *mockSMTPAuth) Auth(_ smtp.Auth) error { return m.authErr }

func (m *mockSMTPAuth) Extension(ext string) (bool, string) {
	if ext == "AUTH" {
		return m.authLine != "", m.authLine
	}
	return false, ""
}

func TestSmtpAuthWithFallbackPlainOK(t *testing.T) {
	t.Parallel()
	fallback, err := smtpAuthWithFallback(&mockSMTPAuth{}, "smtp.example.com", "user@example.com", "secret")
	if err != nil || fallback {
		t.Fatalf("plain auth ok: fallback=%v err=%v", fallback, err)
	}
}

func TestSmtpAuthWithFallbackLogin(t *testing.T) {
	t.Parallel()
	fallback, err := smtpAuthWithFallback(
		&mockSMTPAuth{authErr: errors.New("504 5.7.4 Unrecognized authentication type"), authLine: "LOGIN PLAIN"},
		"smtp.example.com", "user@example.com", "secret",
	)
	if !fallback || err == nil {
		t.Fatalf("expected LOGIN fallback marker, fallback=%v err=%v", fallback, err)
	}
}

func TestLoginAuthStartAndNext(t *testing.T) {
	t.Parallel()
	auth := &loginAuth{username: "user@example.com", password: "secret", host: "smtp.example.com"}
	mech, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil || mech != "LOGIN" {
		t.Fatalf("start: mech=%q err=%v", mech, err)
	}
	resp, err := auth.Next([]byte("Username:"), true)
	if err != nil || string(resp) != "user@example.com" {
		t.Fatalf("username challenge: %q err=%v", resp, err)
	}
	resp, err = auth.Next([]byte("Password:"), true)
	if err != nil || string(resp) != "secret" {
		t.Fatalf("password challenge: %q err=%v", resp, err)
	}
}

func TestLoginAuthRejectsPlaintextLocalhost(t *testing.T) {
	t.Parallel()
	auth := &loginAuth{host: "127.0.0.1"}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "127.0.0.1", TLS: false}); err == nil {
		t.Fatal("expected unencrypted connection error even for loopback")
	}
}

func TestSmtpAuthWithFallbackReturnsPlainErrorWhenNotAuthTypeIssue(t *testing.T) {
	t.Parallel()
	mock := &mockSMTPAuth{authErr: errors.New("connection reset")}
	usedLogin, err := smtpAuthWithFallback(mock, "smtp.example.com", "u", "p")
	if usedLogin || err == nil || err.Error() != "connection reset" {
		t.Fatalf("want plain err, got usedLogin=%v err=%v", usedLogin, err)
	}
}

func TestLoginAuthRejectsPlaintextRemote(t *testing.T) {
	t.Parallel()
	auth := &loginAuth{host: "smtp.example.com"}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: false}); err == nil {
		t.Fatal("expected unencrypted connection error")
	}
}

func TestXOAUTH2AuthRefusesPlaintextAndWrongHost(t *testing.T) {
	t.Parallel()
	auth := &xoauth2Auth{username: "u", token: "t", host: "smtp.example.com"}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: false}); err == nil {
		t.Fatal("expected unencrypted connection error")
	}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "evil.example.com", TLS: true}); err == nil {
		t.Fatal("expected wrong host error")
	}
	mech, ir, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil || mech != "XOAUTH2" || string(ir) != "user=u\x01auth=Bearer t\x01\x01" {
		t.Fatalf("start: mech=%q ir=%q err=%v", mech, ir, err)
	}
}

// xoauth2SMTPCreds points at f with an access token instead of a password.
func xoauth2SMTPCreds(f *fakeSMTP, security, token string) Credentials {
	c := f.creds(security)
	c.Password, c.AccessToken = "", token
	return c
}

func TestXOAUTH2Auth(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		cfg      fakeSMTPConfig
		security string
	}{
		{"implicit tls", fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2 PLAIN LOGIN"}, "tls"},
		{"starttls", fakeSMTPConfig{startTLS: true, authMechs: "XOAUTH2 PLAIN LOGIN"}, "starttls"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newFakeSMTP(t, tc.cfg)
			if err := VerifyLogin(xoauth2SMTPCreds(f, tc.security, "good")); err != nil {
				t.Fatalf("verify: %v", err)
			}
			got := f.seen()
			if !slices.Equal(got.mechs, []string{"XOAUTH2"}) || !slices.Equal(got.authUsers, []string{"user@example.com"}) {
				t.Fatalf("mechs=%q users=%q, want one XOAUTH2 as the email", got.mechs, got.authUsers)
			}
		})
	}
}

func TestXOAUTH2Refused535(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2"})
	err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "expired"))
	if !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("want ErrAuthFailed, got %v", err)
	}
	if strings.Contains(err.Error(), "expired") {
		t.Fatalf("the error carries the token: %v", err)
	}
}

func TestXOAUTH2SMTPAuthDisabled(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{
		implicitTLS: true, authMechs: "XOAUTH2",
		authReply: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox.",
	})
	if err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "good")); !errors.Is(err, ErrSMTPAuthDisabled) {
		t.Fatalf("want ErrSMTPAuthDisabled, got %v", err)
	}
}

// Username only changes the login identity; the envelope, From and Message-ID
// stay on the mailbox address.
func TestXOAUTH2MailFromStaysEmail(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2"})
	c := xoauth2SMTPCreds(f, "tls", "good")
	c.Username = "login-id"
	msgID, _, err := Send(testCtx(t), c, testMessage())
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if !slices.Equal(got.authUsers, []string{"login-id"}) || !slices.Equal(got.mailFrom, []string{"user@example.com"}) {
		t.Fatalf("users=%q mail from=%q", got.authUsers, got.mailFrom)
	}
	if !strings.Contains(got.data, "From: user@example.com\r\n") || !strings.HasSuffix(msgID, "@example.com>") {
		t.Fatalf("From or Message-ID left the email address: id=%q\n%s", msgID, got.data)
	}
}

// A server without XOAUTH2 refuses it; the client never retries with PLAIN or
// LOGIN, which would send an empty password.
func TestXOAUTH2NoPlainFallback(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "PLAIN"})
	if err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "good")); err == nil {
		t.Fatal("want an error from a server without XOAUTH2")
	}
	if got := f.seen(); !slices.Equal(got.mechs, []string{"XOAUTH2"}) || len(got.authUsers) != 0 {
		t.Fatalf("mechs=%q users=%q, want only the refused XOAUTH2", got.mechs, got.authUsers)
	}
}
