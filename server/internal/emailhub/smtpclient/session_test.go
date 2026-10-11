package smtpclient

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

func testMessage() Message {
	return Message{To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Hello"}
}

func testCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestProductionDialIsNetguarded(t *testing.T) {
	t.Parallel()
	_, err := prodDialTCP(testCtx(t), "tcp", "127.0.0.1:587")
	if !errors.Is(err, netguard.ErrHostNotAllowed) {
		t.Fatalf("production dial to loopback: want ErrHostNotAllowed, got %v", err)
	}
}

func TestSendImplicitTLSUsesUsernameOnlyForAuth(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true})
	c := f.creds("") // "" means implicit TLS
	c.Username = "login-id"
	msgID, _, err := Send(testCtx(t), c, testMessage())
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if len(got.authUsers) != 1 || got.authUsers[0] != "login-id" {
		t.Fatalf("AUTH user = %v, want [login-id]", got.authUsers)
	}
	if len(got.mailFrom) != 1 || got.mailFrom[0] != "user@example.com" {
		t.Fatalf("MAIL FROM = %v, want [user@example.com]", got.mailFrom)
	}
	if len(got.rcpts) != 1 || got.rcpts[0] != "dest@example.com" {
		t.Fatalf("RCPT = %v", got.rcpts)
	}
	if !strings.Contains(got.data, "From: user@example.com\r\n") {
		t.Fatalf("From header not the email address:\n%s", got.data)
	}
	if !strings.HasSuffix(msgID, "@example.com>") {
		t.Fatalf("message id %q not on the sender domain", msgID)
	}
}

func TestSendRequiredStartTLS(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{startTLS: true})
	if _, _, err := Send(testCtx(t), f.creds("starttls"), testMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if got.startTLS != 1 {
		t.Fatalf("STARTTLS upgrades = %d, want 1", got.startTLS)
	}
	if len(got.authUsers) != 1 || got.authUsers[0] != "user@example.com" {
		t.Fatalf("AUTH user = %v, want the email when Username is empty", got.authUsers)
	}
}

func TestStartTLSNotOfferedIsTLSRequired(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{})
	err := VerifyLogin(f.creds("starttls"))
	if !errors.Is(err, ErrTLSRequired) {
		t.Fatalf("want ErrTLSRequired, got %v", err)
	}
	if got := f.seen(); len(got.authUsers) != 0 {
		t.Fatalf("credentials sent over plaintext: %v", got.authUsers)
	}
}

func TestUnknownSecurityModeRefusedBeforeDial(t *testing.T) {
	t.Parallel()
	err := VerifyLogin(Credentials{Host: "127.0.0.1", Port: 1, Email: "a@b.co", Password: "x", Security: "ssl"})
	if err == nil || !strings.Contains(err.Error(), "security") {
		t.Fatalf("want unknown security error, got %v", err)
	}
}

func TestLoginFallbackAfterPlainUnsupported(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{
		implicitTLS: true, authMechs: "LOGIN",
		plainReply: "504 5.7.4 Unrecognized authentication type",
	})
	c := f.creds("tls")
	c.Username = "login-id"
	if _, _, err := Send(testCtx(t), c, testMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if len(got.authUsers) != 1 || got.authUsers[0] != "login-id" {
		t.Fatalf("LOGIN user = %v, want [login-id]", got.authUsers)
	}
	if len(got.mailFrom) != 1 || got.mailFrom[0] != "user@example.com" {
		t.Fatalf("MAIL FROM = %v", got.mailFrom)
	}
}

func TestAuthErrorsAreClassified(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		cfg          fakeSMTPConfig
		wantAuth     bool
		wantDisabled bool
	}{
		{name: "535 bad credentials", cfg: fakeSMTPConfig{authReply: "535 5.7.8 Username and Password not accepted"}, wantAuth: true},
		{name: "534 app password required", cfg: fakeSMTPConfig{authReply: "534 5.7.9 Application-specific password required"}, wantAuth: true},
		{name: "m365 smtp auth disabled", cfg: fakeSMTPConfig{authReply: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox."}, wantDisabled: true},
		{name: "m365 5.7.139 bad credentials", cfg: fakeSMTPConfig{authReply: "535 5.7.139 Authentication unsuccessful, the request did not meet the criteria to be authenticated successfully."}, wantAuth: true},
		{name: "login fallback 535", cfg: fakeSMTPConfig{authMechs: "LOGIN", plainReply: "504 5.7.4 Unrecognized authentication type", authReply: "535 5.7.8 bad"}, wantAuth: true},
		{name: "454 temporary is not an auth failure", cfg: fakeSMTPConfig{authReply: "454 4.7.0 Temporary authentication failure"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.cfg.implicitTLS = true
			f := newFakeSMTP(t, tc.cfg)
			err := VerifyLogin(f.creds("tls"))
			if err == nil {
				t.Fatal("want an auth error")
			}
			if errors.Is(err, ErrAuthFailed) != tc.wantAuth {
				t.Fatalf("ErrAuthFailed = %v, want %v (err %v)", errors.Is(err, ErrAuthFailed), tc.wantAuth, err)
			}
			if errors.Is(err, ErrSMTPAuthDisabled) != tc.wantDisabled {
				t.Fatalf("ErrSMTPAuthDisabled = %v, want %v (err %v)", errors.Is(err, ErrSMTPAuthDisabled), tc.wantDisabled, err)
			}
		})
	}
}

func TestSendTimesOutWithoutGreeting(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{silent: true})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, _, err := Send(ctx, f.creds("starttls"), testMessage())
	if err == nil {
		t.Fatal("want a timeout error from a server that never greets")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("greeting wait took %v; deadline not applied before smtp.NewClient", elapsed)
	}
}

func TestSendTimesOutWhenStartTLSHandshakeStalls(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{startTLS: true, stallTLS: true})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, _, err := Send(ctx, f.creds("starttls"), testMessage()); err == nil {
		t.Fatal("want a timeout error from a server that stalls after STARTTLS")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("STARTTLS handshake wait took %v; deadline not covering the handshake", elapsed)
	}
}

// Send returns exactly what DATA carried, so the caller can file it in Sent;
// Bcc recipients get the mail but never appear in it.
func TestSendReturnsTheRawItWrote(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true})
	msg := testMessage()
	msg.Bcc = []string{"hidden@example.com"}
	msgID, raw, err := Send(testCtx(t), f.creds("tls"), msg)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if string(raw) != got.data {
		t.Fatalf("raw differs from DATA:\nraw:\n%s\ndata:\n%s", raw, got.data)
	}
	if !strings.Contains(string(raw), "Message-ID: "+msgID+"\r\n") {
		t.Fatalf("raw lacks the Message-ID header %q:\n%s", msgID, raw)
	}
	if strings.Contains(string(raw), "hidden@example.com") || strings.Contains(string(raw), "Bcc:") {
		t.Fatalf("raw leaks the Bcc recipient:\n%s", raw)
	}
	if len(got.rcpts) != 2 {
		t.Fatalf("RCPT = %v, want the To and the Bcc recipient", got.rcpts)
	}
}
