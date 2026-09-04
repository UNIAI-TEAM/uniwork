package mail

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- NewSMTP resolution matrices ---

func TestNewSMTP_TLSMode(t *testing.T) {
	tests := []struct {
		name         string
		tls          string
		port         string
		wantImplicit bool
	}{
		{"unset on 465 auto-enables implicit", "", "465", true},
		{"unset on 587 stays starttls", "", "587", false},
		{"unset default port stays starttls", "", "", false},
		{"explicit implicit on 587 forces SMTPS", "implicit", "587", true},
		{"smtps alias", "smtps", "587", true},
		{"ssl alias", "ssl", "587", true},
		{"explicit starttls on 465 overrides auto-detect", "starttls", "465", false},
		{"case-insensitive", "IMPLICIT", "587", true},
		{"trims whitespace", "  implicit  ", "587", true},
		{"unknown value falls back to starttls", "tls", "465", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := NewSMTP(SMTPConfig{Host: "smtp.example.com", Port: tt.port, TLS: tt.tls, From: "noreply@example.com"})
			if err != nil {
				t.Fatalf("NewSMTP: %v", err)
			}
			if s.tlsImplicit != tt.wantImplicit {
				t.Errorf("TLS=%q Port=%q: tlsImplicit = %v, want %v", tt.tls, tt.port, s.tlsImplicit, tt.wantImplicit)
			}
			wantMode := "starttls"
			if tt.wantImplicit {
				wantMode = "implicit-tls"
			}
			if got := s.TLSMode(); got != wantMode {
				t.Errorf("TLSMode() = %q, want %q", got, wantMode)
			}
		})
	}
}

func TestNewSMTP_EHLOName(t *testing.T) {
	tests := []struct {
		name     string
		ehlo     string
		want     string
		explicit bool
	}{
		{"explicit name wins", "mail.example.com", "mail.example.com", true},
		{"explicit name is trimmed", "  mail.example.com  ", "mail.example.com", true},
		{"unset falls back to hostname", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := NewSMTP(SMTPConfig{Host: "smtp.example.com", From: "noreply@example.com", EHLOName: tt.ehlo})
			if err != nil {
				t.Fatalf("NewSMTP: %v", err)
			}
			if tt.explicit {
				if s.ehloName != tt.want {
					t.Errorf("EHLOName=%q: ehloName = %q, want %q", tt.ehlo, s.ehloName, tt.want)
				}
				return
			}
			// Unset: must mirror os.Hostname() exactly, including the empty
			// result when Hostname() errors (Send then skips the EHLO override).
			want, _ := os.Hostname()
			if s.ehloName != want {
				t.Errorf("EHLOName unset: ehloName = %q, want os.Hostname() %q", s.ehloName, want)
			}
		})
	}
}

func TestNewSMTP_FromAndDefaults(t *testing.T) {
	t.Run("from is required", func(t *testing.T) {
		if _, err := NewSMTP(SMTPConfig{Host: "smtp.example.com"}); err == nil {
			t.Fatal("expected error when From is empty")
		}
		if _, err := NewSMTP(SMTPConfig{Host: "smtp.example.com", From: "   "}); err == nil {
			t.Fatal("expected error when From is blank")
		}
	})
	t.Run("host is required", func(t *testing.T) {
		if _, err := NewSMTP(SMTPConfig{From: "noreply@example.com"}); err == nil {
			t.Fatal("expected error when Host is empty")
		}
	})
	t.Run("port defaults to 25 and values are trimmed", func(t *testing.T) {
		s, err := NewSMTP(SMTPConfig{Host: " smtp.example.com ", From: " noreply@example.com "})
		if err != nil {
			t.Fatalf("NewSMTP: %v", err)
		}
		if s.port != "25" {
			t.Errorf("port = %q, want 25", s.port)
		}
		if s.host != "smtp.example.com" {
			t.Errorf("host = %q, want trimmed", s.host)
		}
		if s.from != "noreply@example.com" {
			t.Errorf("from = %q, want trimmed", s.from)
		}
		if got := s.Addr(); got != "smtp.example.com:25" {
			t.Errorf("Addr() = %q", got)
		}
	})
}

// --- smtpAuthWithFallback with a fake auth client ---

type fakeAuthClient struct {
	authErrs  []error
	authCalls []smtp.Auth
	authLine  string
}

func (f *fakeAuthClient) Auth(auth smtp.Auth) error {
	f.authCalls = append(f.authCalls, auth)
	if len(f.authErrs) == 0 {
		return nil
	}
	err := f.authErrs[0]
	f.authErrs = f.authErrs[1:]
	return err
}

func (f *fakeAuthClient) Extension(name string) (bool, string) {
	if strings.EqualFold(name, "AUTH") && f.authLine != "" {
		return true, f.authLine
	}
	return false, ""
}

func TestSMTPAuthWithFallback_UsesPlainWhenAccepted(t *testing.T) {
	client := &fakeAuthClient{}
	fallback, err := smtpAuthWithFallback(client, "smtp.office365.com", "user", "pass")
	if err != nil {
		t.Fatalf("smtpAuthWithFallback returned error: %v", err)
	}
	if fallback {
		t.Fatal("expected no fallback when PLAIN auth succeeds")
	}
	if len(client.authCalls) != 1 {
		t.Fatalf("expected 1 auth call, got %d", len(client.authCalls))
	}
	if _, ok := client.authCalls[0].(*loginAuth); ok {
		t.Fatal("expected first auth to be PLAIN, got LOGIN")
	}
}

func TestSMTPAuthWithFallback_FallsBackToLoginOn504(t *testing.T) {
	client := &fakeAuthClient{
		authErrs: []error{errors.New("504 5.7.4 Unrecognized authentication type"), nil},
		authLine: "XOAUTH2 LOGIN",
	}
	fallback, err := smtpAuthWithFallback(client, "smtp.office365.com", "user", "pass")
	if !fallback {
		t.Fatal("expected fallback signal when the server rejects PLAIN auth")
	}
	if err == nil {
		t.Fatal("expected original PLAIN auth error to be returned for the reconnect path")
	}
	if len(client.authCalls) != 1 {
		t.Fatalf("expected 1 auth call before reconnect, got %d", len(client.authCalls))
	}
}

func TestSMTPAuthWithFallback_DoesNotFallbackWithoutLoginSupport(t *testing.T) {
	wantErr := errors.New("504 5.7.4 Unrecognized authentication type")
	client := &fakeAuthClient{authErrs: []error{wantErr}, authLine: "XOAUTH2"}
	fallback, err := smtpAuthWithFallback(client, "smtp.office365.com", "user", "pass")
	if fallback {
		t.Fatal("did not expect fallback when the server does not advertise LOGIN")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected original error, got %v", err)
	}
}

func TestSMTPAuthWithFallback_UnrelatedErrorIsReturned(t *testing.T) {
	wantErr := errors.New("535 5.7.8 Authentication credentials invalid")
	client := &fakeAuthClient{authErrs: []error{wantErr}, authLine: "PLAIN LOGIN"}
	fallback, err := smtpAuthWithFallback(client, "smtp.example.com", "user", "pass")
	if fallback {
		t.Fatal("bad credentials must not trigger the LOGIN fallback")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected original error, got %v", err)
	}
}

// --- loginAuth security contract ---

func TestLoginAuth_Start_RefusesUnencryptedRemote(t *testing.T) {
	auth := &loginAuth{username: "user", password: "pass", host: "smtp.office365.com"}
	_, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.office365.com", TLS: false})
	if err == nil {
		t.Fatal("expected error for unencrypted remote connection")
	}
	if !strings.Contains(err.Error(), "unencrypted connection") {
		t.Errorf("expected 'unencrypted connection' error, got: %v", err)
	}
}

func TestLoginAuth_Start_AllowsTLS(t *testing.T) {
	auth := &loginAuth{username: "user", password: "pass", host: "smtp.office365.com"}
	mech, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.office365.com", TLS: true})
	if err != nil {
		t.Fatalf("expected no error for TLS connection, got: %v", err)
	}
	if mech != "LOGIN" {
		t.Errorf("mechanism = %q, want LOGIN", mech)
	}
}

func TestLoginAuth_Start_AllowsLoopback(t *testing.T) {
	for _, name := range []string{"localhost", "127.0.0.1", "::1"} {
		auth := &loginAuth{username: "user", password: "pass", host: name}
		if _, _, err := auth.Start(&smtp.ServerInfo{Name: name, TLS: false}); err != nil {
			t.Errorf("expected no error for %s, got: %v", name, err)
		}
	}
}

func TestLoginAuth_Start_RejectsWrongHost(t *testing.T) {
	auth := &loginAuth{username: "user", password: "pass", host: "smtp.office365.com"}
	_, _, err := auth.Start(&smtp.ServerInfo{Name: "evil-relay.example.com", TLS: true})
	if err == nil {
		t.Fatal("expected error for host mismatch")
	}
	if !strings.Contains(err.Error(), "wrong host name") {
		t.Errorf("expected 'wrong host name' error, got: %v", err)
	}
}

func TestLoginAuth_Next_AnswersChallenges(t *testing.T) {
	auth := &loginAuth{username: "user", password: "pass", host: "localhost"}
	tests := []struct {
		challenge string
		want      string
	}{
		{"Username:", "user"},
		{"Password:", "pass"},
		{"VXNlcm5hbWU6", "user"}, // base64("Username:") passed through undecoded
		{"UGFzc3dvcmQ6", "pass"},
		{"User Name\x00", "user"},
	}
	for _, tt := range tests {
		got, err := auth.Next([]byte(tt.challenge), true)
		if err != nil {
			t.Errorf("Next(%q): %v", tt.challenge, err)
			continue
		}
		if string(got) != tt.want {
			t.Errorf("Next(%q) = %q, want %q", tt.challenge, got, tt.want)
		}
	}
	if _, err := auth.Next([]byte("Something else"), true); err == nil {
		t.Error("expected error for unknown challenge")
	}
	if got, err := auth.Next([]byte("235 ok"), false); err != nil || got != nil {
		t.Errorf("Next(more=false) = %q, %v; want nil, nil", got, err)
	}
}

// --- Fake in-process SMTP server ---

type fakeServerOptions struct {
	authMechs    string // advertised in EHLO, e.g. "PLAIN LOGIN"; empty hides AUTH
	rejectPlain  bool   // AUTH PLAIN answers 504 5.7.4
	user, pass   string // credentials accepted by AUTH LOGIN / PLAIN
	starttls     bool   // advertise STARTTLS and upgrade on request
	implicitTLS  bool   // wrap the socket in TLS before the greeting
	eightBitMIME bool   // advertise 8BITMIME
	rejectRcpt   bool   // RCPT TO answers 550 5.1.1
}

type fakeSession struct {
	ehlo     []string
	commands []string
	tls      bool
	data     string
	from     string
	rcpt     string
}

type fakeServer struct {
	t     *testing.T
	ln    net.Listener
	addr  string
	opts  fakeServerOptions
	cert  tls.Certificate
	mu    sync.Mutex
	sess  []*fakeSession
	group sync.WaitGroup
}

func startFakeServer(t *testing.T, opts fakeServerOptions) *fakeServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeServer{t: t, ln: ln, addr: ln.Addr().String(), opts: opts}
	if opts.starttls || opts.implicitTLS {
		s.cert = selfSignedCert(t)
	}
	s.group.Add(1)
	go func() {
		defer s.group.Done()
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			s.group.Add(1)
			go func() {
				defer s.group.Done()
				s.handle(conn)
			}()
		}
	}()
	t.Cleanup(func() {
		ln.Close()
		s.group.Wait()
	})
	return s
}

func (s *fakeServer) hostPort() (string, string) {
	host, port, err := net.SplitHostPort(s.addr)
	if err != nil {
		s.t.Fatalf("split host port: %v", err)
	}
	return host, port
}

// sessions returns copies of every session seen so far, in accept order.
func (s *fakeServer) sessions() []fakeSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]fakeSession, 0, len(s.sess))
	for _, sess := range s.sess {
		out = append(out, *sess)
	}
	return out
}

func (s *fakeServer) record(sess *fakeSession, fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn()
}

func (s *fakeServer) handle(conn net.Conn) {
	defer conn.Close()
	sess := &fakeSession{}
	s.record(sess, func() { s.sess = append(s.sess, sess) })

	tlsCfg := &tls.Config{Certificates: []tls.Certificate{s.cert}, MinVersion: tls.VersionTLS12}
	if s.opts.implicitTLS {
		tc := tls.Server(conn, tlsCfg)
		if err := tc.Handshake(); err != nil {
			return
		}
		conn = tc
		s.record(sess, func() { sess.tls = true })
	}
	tp := textproto.NewConn(conn)
	if err := tp.PrintfLine("220 fake ESMTP"); err != nil {
		return
	}
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		upper := strings.ToUpper(line)
		verb := upper
		if i := strings.IndexByte(upper, ' '); i >= 0 {
			verb = upper[:i]
		}
		s.record(sess, func() { sess.commands = append(sess.commands, upper) })
		switch {
		case verb == "EHLO":
			s.record(sess, func() { sess.ehlo = append(sess.ehlo, strings.TrimSpace(line[4:])) })
			_ = tp.PrintfLine("250-fake Hello")
			if s.opts.starttls && !sess.tls {
				_ = tp.PrintfLine("250-STARTTLS")
			}
			if s.opts.authMechs != "" {
				_ = tp.PrintfLine("250-AUTH %s", s.opts.authMechs)
			}
			if s.opts.eightBitMIME {
				_ = tp.PrintfLine("250-8BITMIME")
			}
			_ = tp.PrintfLine("250 OK")
		case verb == "STARTTLS":
			if !s.opts.starttls {
				_ = tp.PrintfLine("454 TLS not available")
				continue
			}
			if err := tp.PrintfLine("220 Ready to start TLS"); err != nil {
				return
			}
			tc := tls.Server(conn, tlsCfg)
			if err := tc.Handshake(); err != nil {
				return
			}
			conn = tc
			tp = textproto.NewConn(conn)
			s.record(sess, func() { sess.tls = true })
		case strings.HasPrefix(upper, "AUTH PLAIN"):
			if s.opts.rejectPlain {
				_ = tp.PrintfLine("504 5.7.4 Unrecognized authentication type")
				continue
			}
			raw, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(line[len("AUTH PLAIN"):]))
			parts := strings.Split(string(raw), "\x00")
			if len(parts) == 3 && parts[1] == s.opts.user && parts[2] == s.opts.pass {
				_ = tp.PrintfLine("235 2.7.0 Auth succeeded")
			} else {
				_ = tp.PrintfLine("535 5.7.8 Auth failed")
			}
		case strings.HasPrefix(upper, "AUTH LOGIN"):
			_ = tp.PrintfLine("334 VXNlcm5hbWU6") // base64("Username:")
			userLine, _ := tp.ReadLine()
			user, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(userLine))
			_ = tp.PrintfLine("334 UGFzc3dvcmQ6") // base64("Password:")
			passLine, _ := tp.ReadLine()
			pass, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(passLine))
			if string(user) == s.opts.user && string(pass) == s.opts.pass {
				_ = tp.PrintfLine("235 2.7.0 Auth succeeded")
			} else {
				_ = tp.PrintfLine("535 5.7.8 Auth failed")
			}
		case verb == "*":
			_ = tp.PrintfLine("501 Authentication aborted")
		case verb == "MAIL":
			s.record(sess, func() { sess.from = line })
			_ = tp.PrintfLine("250 OK")
		case verb == "RCPT":
			s.record(sess, func() { sess.rcpt = line })
			if s.opts.rejectRcpt {
				_ = tp.PrintfLine("550 5.1.1 User unknown")
			} else {
				_ = tp.PrintfLine("250 OK")
			}
		case verb == "DATA":
			if err := tp.PrintfLine("354 End data with <CR><LF>.<CR><LF>"); err != nil {
				return
			}
			data, err := io.ReadAll(tp.DotReader())
			if err != nil {
				return
			}
			s.record(sess, func() { sess.data = string(data) })
			_ = tp.PrintfLine("250 OK queued")
		case verb == "QUIT":
			_ = tp.PrintfLine("221 bye")
			return
		default:
			_ = tp.PrintfLine("500 unrecognized command")
		}
	}
}

func selfSignedCert(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func newTestSender(t *testing.T, srv *fakeServer, mutate func(*SMTPConfig)) *SMTPSender {
	t.Helper()
	host, port := srv.hostPort()
	cfg := SMTPConfig{Host: host, Port: port, From: "from@example.com", EHLOName: "test.local"}
	if mutate != nil {
		mutate(&cfg)
	}
	s, err := NewSMTP(cfg)
	if err != nil {
		t.Fatalf("NewSMTP: %v", err)
	}
	return s
}

func hasCommand(sess fakeSession, prefix string) bool {
	for _, c := range sess.commands {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

// --- Send flow against the fake server ---

func TestSMTPSender_Send_PlainAuthAccepted(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{authMechs: "PLAIN LOGIN", user: "testuser", pass: "testpass"})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.Username = "testuser"; c.Password = "testpass" })

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Test Subject", HTML: "<p>Hello</p>"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	sessions := srv.sessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	sess := sessions[0]
	if !hasCommand(sess, "AUTH PLAIN") || hasCommand(sess, "AUTH LOGIN") {
		t.Errorf("expected only AUTH PLAIN, commands: %v", sess.commands)
	}
	if len(sess.ehlo) == 0 || sess.ehlo[0] != "test.local" {
		t.Errorf("EHLO name = %v, want test.local", sess.ehlo)
	}
	if sess.from != "MAIL FROM:<from@example.com>" {
		t.Errorf("MAIL FROM = %q", sess.from)
	}
	if sess.rcpt != "RCPT TO:<to@example.com>" {
		t.Errorf("RCPT TO = %q", sess.rcpt)
	}
	if !strings.Contains(sess.data, "<p>Hello</p>") {
		t.Errorf("body missing HTML part:\n%s", sess.data)
	}
}

func TestSMTPSender_Send_FallbackReconnectsAndAuthsWithLOGIN(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{authMechs: "PLAIN LOGIN", rejectPlain: true, user: "testuser", pass: "testpass"})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.Username = "testuser"; c.Password = "testpass" })

	// No STARTTLS advertised: the plain connection is to 127.0.0.1, which
	// loginAuth.Start allows.
	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Test Subject", HTML: "<p>Hello</p>"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	sessions := srv.sessions()
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions (reconnect after 504), got %d", len(sessions))
	}
	if !hasCommand(sessions[0], "AUTH PLAIN") || sessions[0].data != "" {
		t.Errorf("first session should try PLAIN and send nothing: %v", sessions[0].commands)
	}
	if !hasCommand(sessions[1], "AUTH LOGIN") || hasCommand(sessions[1], "AUTH PLAIN") {
		t.Errorf("second session should authenticate with LOGIN only: %v", sessions[1].commands)
	}
	if sessions[1].data == "" {
		t.Error("second session should carry the message")
	}
}

func TestSMTPSender_Send_LoginFallbackBadPassword(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{authMechs: "PLAIN LOGIN", rejectPlain: true, user: "testuser", pass: "right"})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.Username = "testuser"; c.Password = "wrong" })

	err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "x", Text: "y"})
	if err == nil {
		t.Fatal("expected LOGIN failure to surface")
	}
	if !strings.Contains(err.Error(), "login auth fallback failed") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestSMTPSender_Send_NoAuthWhenUsernameEmpty(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{authMechs: "PLAIN LOGIN"})
	s := newTestSender(t, srv, nil)

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Test Subject", Text: "Hello"}); err != nil {
		t.Fatalf("Send for unauthenticated relay: %v", err)
	}
	sessions := srv.sessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if hasCommand(sessions[0], "AUTH") {
		t.Errorf("expected no AUTH command, got %v", sessions[0].commands)
	}
}

func TestSMTPSender_Send_MultipartAlternative(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{eightBitMIME: true})
	s := newTestSender(t, srv, nil)

	msg := Message{To: "to@example.com", Subject: "Mã xác nhận", Text: "Mã của bạn: 123456", HTML: "<p>Mã của bạn: <b>123456</b></p>"}
	if err := s.Send(context.Background(), msg); err != nil {
		t.Fatalf("Send: %v", err)
	}
	data := srv.sessions()[0].data
	for _, want := range []string{
		"From: from@example.com\n",
		"To: to@example.com\n",
		"Subject: =?utf-8?q?",
		"Date: ",
		"Message-ID: <",
		"MIME-Version: 1.0\n",
		"Content-Type: multipart/alternative; boundary=",
		"Content-Type: text/plain; charset=UTF-8\n",
		"Content-Type: text/html; charset=UTF-8\n",
		"Content-Transfer-Encoding: 8bit\n",
		"Mã của bạn: 123456",
		"<p>Mã của bạn: <b>123456</b></p>",
	} {
		if !strings.Contains(data, want) {
			t.Errorf("message missing %q:\n%s", want, data)
		}
	}
	if strings.Contains(data, "Subject: Mã") {
		t.Errorf("subject must be RFC 2047 encoded:\n%s", data)
	}
	// text/plain must precede text/html so clients prefer the richest last part.
	if strings.Index(data, "text/plain") > strings.Index(data, "text/html") {
		t.Errorf("text/plain part must come before text/html:\n%s", data)
	}
	if !strings.Contains(srv.sessions()[0].from, "BODY=8BITMIME") {
		t.Errorf("MAIL FROM should carry BODY=8BITMIME when advertised: %q", srv.sessions()[0].from)
	}
}

func TestSMTPSender_Send_QuotedPrintableWithout8BITMIME(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{})
	s := newTestSender(t, srv, nil)

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Hi", HTML: "<p>Xin chào</p>"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	data := srv.sessions()[0].data
	if !strings.Contains(data, "Content-Transfer-Encoding: quoted-printable\n") {
		t.Errorf("expected quoted-printable encoding:\n%s", data)
	}
	if !strings.Contains(data, "Xin ch=C3=A0o") {
		t.Errorf("expected QP-encoded body:\n%s", data)
	}
	if strings.Contains(data, "multipart/") {
		t.Errorf("single-part message must not be multipart:\n%s", data)
	}
	if !strings.Contains(data, "Content-Type: text/html; charset=UTF-8\n") {
		t.Errorf("expected single text/html part:\n%s", data)
	}
}

func TestSMTPSender_Send_TextOnly(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{eightBitMIME: true})
	s := newTestSender(t, srv, nil)

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Hi", Text: "plain only"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	data := srv.sessions()[0].data
	if !strings.Contains(data, "Content-Type: text/plain; charset=UTF-8\n") || strings.Contains(data, "text/html") {
		t.Errorf("expected single text/plain part:\n%s", data)
	}
}

func TestSMTPSender_Send_STARTTLS(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{starttls: true, authMechs: "LOGIN", rejectPlain: true, user: "u", pass: "p", eightBitMIME: true})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.Username = "u"; c.Password = "p"; c.TLSInsecure = true })

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Hi", Text: "secure"}); err != nil {
		t.Fatalf("Send over STARTTLS: %v", err)
	}
	sessions := srv.sessions()
	if len(sessions) != 2 {
		t.Fatalf("expected reconnect after 504, got %d sessions", len(sessions))
	}
	for i, sess := range sessions {
		if !sess.tls || !hasCommand(sess, "STARTTLS") {
			t.Errorf("session %d: expected STARTTLS upgrade, commands %v", i, sess.commands)
		}
		if len(sess.ehlo) != 2 {
			t.Errorf("session %d: expected EHLO before and after STARTTLS, got %v", i, sess.ehlo)
		}
	}
	if !hasCommand(sessions[1], "AUTH LOGIN") || sessions[1].data == "" {
		t.Errorf("second session should LOGIN and deliver: %v", sessions[1].commands)
	}
}

func TestSMTPSender_Send_ImplicitTLS(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{implicitTLS: true, authMechs: "PLAIN", user: "u", pass: "p"})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.Username = "u"; c.Password = "p"; c.TLS = "implicit"; c.TLSInsecure = true })

	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Hi", Text: "secure"}); err != nil {
		t.Fatalf("Send over implicit TLS: %v", err)
	}
	sessions := srv.sessions()
	if len(sessions) != 1 || !sessions[0].tls {
		t.Fatalf("expected one TLS session, got %+v", sessions)
	}
	if hasCommand(sessions[0], "STARTTLS") {
		t.Error("implicit TLS must not issue STARTTLS")
	}
	if sessions[0].data == "" {
		t.Error("message was not delivered")
	}
}

func TestSMTPSender_Send_RejectsBadCertificate(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{implicitTLS: true})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.TLS = "implicit" }) // TLSInsecure stays false

	err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "Hi", Text: "x"})
	if err == nil {
		t.Fatal("expected certificate verification failure")
	}
}

func TestSMTPSender_Send_UnreachableHostReturnsError(t *testing.T) {
	// Grab a free port, then close it so the dial is refused immediately.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	ln.Close()

	s, err := NewSMTP(SMTPConfig{Host: host, Port: port, From: "from@example.com", Username: "user", Password: "pass", EHLOName: "test.local"})
	if err != nil {
		t.Fatalf("NewSMTP: %v", err)
	}
	err = s.Send(context.Background(), Message{To: "to@example.com", Subject: "Subject", HTML: "<p>body</p>"})
	if err == nil {
		t.Fatal("expected error from unreachable SMTP server")
	}
	if !strings.Contains(err.Error(), "smtp dial") {
		t.Errorf("expected dial error, got: %v", err)
	}
}

func TestSMTPSender_Send_HonoursCancelledContext(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{})
	s := newTestSender(t, srv, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := s.Send(ctx, Message{To: "to@example.com", Subject: "Hi", Text: "x"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if n := len(srv.sessions()); n != 0 {
		t.Errorf("cancelled context must not dial, got %d sessions", n)
	}
}

func TestSMTPSender_Send_RejectsInvalidRecipient(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{})
	s := newTestSender(t, srv, nil)

	for _, to := range []string{"", "  ", "a@example.com\r\nBcc: evil@example.com"} {
		if err := s.Send(context.Background(), Message{To: to, Subject: "Hi", Text: "x"}); err == nil {
			t.Errorf("To=%q: expected error", to)
		}
	}
	if n := len(srv.sessions()); n != 0 {
		t.Errorf("invalid recipients must be rejected before dialing, got %d sessions", n)
	}
}

// --- New picks the mode ---

func TestNew_LogModeWhenHostEmpty(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	sender, err := New(SMTPConfig{}, log)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(LogSender); !ok {
		t.Fatalf("expected LogSender, got %T", sender)
	}
	if !strings.Contains(buf.String(), "mail: log mode") {
		t.Errorf("expected log-mode line, got %q", buf.String())
	}
}

func TestNew_SMTPModeWhenHostSet(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	sender, err := New(SMTPConfig{Host: "smtp.example.com", Port: "465", From: "noreply@example.com", EHLOName: "app.example.com"}, log)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*SMTPSender); !ok {
		t.Fatalf("expected *SMTPSender, got %T", sender)
	}
	out := buf.String()
	for _, want := range []string{"mail: smtp", "smtp.example.com:465", "implicit-tls"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in log line, got %q", want, out)
		}
	}
}

func TestNew_SMTPModeRequiresFrom(t *testing.T) {
	if _, err := New(SMTPConfig{Host: "smtp.example.com"}, nil); err == nil {
		t.Fatal("expected error when From is missing in SMTP mode")
	}
}

func TestSMTPSender_Send_DisplayNameFromUsesBareEnvelope(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{})
	s := newTestSender(t, srv, func(c *SMTPConfig) { c.From = "UniWork <noreply@example.com>" })
	if err := s.Send(context.Background(), Message{To: "to@example.com", Subject: "s", Text: "t"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	sess := srv.sessions()[0]
	if sess.from != "MAIL FROM:<noreply@example.com>" {
		t.Errorf("MAIL FROM = %q, want bare address", sess.from)
	}
	if !strings.Contains(sess.data, "From: UniWork <noreply@example.com>\n") {
		t.Errorf("From header should keep the display name:\n%s", sess.data)
	}
}

func TestNewSMTP_RejectsMalformedFrom(t *testing.T) {
	if _, err := NewSMTP(SMTPConfig{Host: "smtp.example.com", From: "not an address"}); err == nil {
		t.Fatal("expected error for malformed From")
	}
}

func TestSMTPSender_Send_RcptRejectedIsPermanent(t *testing.T) {
	srv := startFakeServer(t, fakeServerOptions{rejectRcpt: true})
	s := newTestSender(t, srv, nil)
	err := s.Send(context.Background(), Message{To: "nobody@example.com", Subject: "s", Text: "t"})
	if !errors.Is(err, ErrPermanent) {
		t.Fatalf("550 on RCPT should wrap ErrPermanent, got %v", err)
	}
}
