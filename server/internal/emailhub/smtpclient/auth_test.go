package smtpclient

import (
	"errors"
	"net/smtp"
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

func TestIsLocalhost(t *testing.T) {
	t.Parallel()
	for _, host := range []string{"localhost", "127.0.0.1", "::1"} {
		if !isLocalhost(host) {
			t.Fatalf("expected local: %q", host)
		}
	}
	if isLocalhost("mail.example.com") {
		t.Fatal("expected remote")
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
