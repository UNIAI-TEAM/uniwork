package smtpclient

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

var (
	// prodDialTCP keeps the production dialer so a test can prove it is netguarded.
	prodDialTCP = dialTCP
	fakeCert    tls.Certificate
)

func TestMain(m *testing.M) {
	// Borrow httptest's self-signed cert (SANs 127.0.0.1, ::1, example.com) instead of minting one.
	hs := httptest.NewTLSServer(http.NotFoundHandler())
	fakeCert = hs.TLS.Certificates[0]
	roots := x509.NewCertPool()
	roots.AddCert(hs.Certificate())
	hs.Close()

	tlsRootCAs = roots
	dialTCP = (&net.Dialer{Timeout: dialTimeout}).DialContext
	os.Exit(m.Run())
}

type fakeSMTPConfig struct {
	implicitTLS bool   // listener speaks TLS from the first byte (465 style)
	startTLS    bool   // plaintext listener that advertises and accepts STARTTLS
	authMechs   string // EHLO AUTH line; default "PLAIN LOGIN"
	authReply   string // final reply to AUTH; default "235 2.7.0 Accepted"
	plainReply  string // when set, AUTH PLAIN answers this instead (e.g. 504 to force LOGIN)
	silent      bool   // accept TCP but never send a greeting
	stallTLS    bool   // answer STARTTLS with 220 then never handshake
}

type fakeSMTPLog struct {
	authUsers []string
	mechs     []string // AUTH mechanisms tried, upper case
	mailFrom  []string
	rcpts     []string
	data      string
	startTLS  int
}

type fakeSMTP struct {
	cfg  fakeSMTPConfig
	port int
	mu   sync.Mutex
	log  fakeSMTPLog
}

func newFakeSMTP(t *testing.T, cfg fakeSMTPConfig) *fakeSMTP {
	t.Helper()
	if cfg.authMechs == "" {
		cfg.authMechs = "PLAIN LOGIN"
	}
	if cfg.authReply == "" {
		cfg.authReply = "235 2.7.0 Accepted"
	}
	var (
		ln  net.Listener
		err error
	)
	if cfg.implicitTLS {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{fakeCert}})
	} else {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		t.Fatalf("fake smtp listen: %v", err)
	}
	f := &fakeSMTP{cfg: cfg, port: ln.Addr().(*net.TCPAddr).Port}
	done := make(chan struct{})
	t.Cleanup(func() {
		close(done)
		_ = ln.Close()
	})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn, done)
		}
	}()
	return f
}

func (f *fakeSMTP) creds(security string) Credentials {
	return Credentials{
		Host: "127.0.0.1", Port: f.port, Email: "user@example.com",
		Password: "secret", Security: security,
	}
}

func (f *fakeSMTP) seen() fakeSMTPLog {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.log
	out.authUsers = append([]string(nil), f.log.authUsers...)
	out.mechs = append([]string(nil), f.log.mechs...)
	out.mailFrom = append([]string(nil), f.log.mailFrom...)
	out.rcpts = append([]string(nil), f.log.rcpts...)
	return out
}

func (f *fakeSMTP) record(fn func(l *fakeSMTPLog)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(&f.log)
}

func (f *fakeSMTP) serve(conn net.Conn, done <-chan struct{}) {
	defer func() { _ = conn.Close() }()
	if f.cfg.silent {
		<-done
		return
	}
	r := bufio.NewReader(conn)
	reply := func(lines ...string) {
		for _, l := range lines {
			_, _ = io.WriteString(conn, l+"\r\n")
		}
	}
	tlsOn := f.cfg.implicitTLS
	reply("220 fake.smtp ESMTP")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(strings.TrimRight(line, "\r\n"), " ")
		switch strings.ToUpper(verb) {
		case "EHLO", "HELO":
			lines := []string{"250-fake.smtp"}
			if f.cfg.startTLS && !tlsOn {
				lines = append(lines, "250-STARTTLS")
			}
			reply(append(lines, "250 AUTH "+f.cfg.authMechs)...)
		case "STARTTLS":
			if !f.cfg.startTLS || tlsOn {
				reply("502 5.5.1 STARTTLS not supported")
				continue
			}
			reply("220 2.0.0 Ready to start TLS")
			if f.cfg.stallTLS {
				<-done
				return
			}
			tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{fakeCert}})
			if tc.Handshake() != nil {
				return
			}
			conn, r, tlsOn = tc, bufio.NewReader(tc), true
			f.record(func(l *fakeSMTPLog) { l.startTLS++ })
		case "AUTH":
			mech, initial, _ := strings.Cut(arg, " ")
			f.record(func(l *fakeSMTPLog) { l.mechs = append(l.mechs, strings.ToUpper(mech)) })
			var user string
			switch strings.ToUpper(mech) {
			case "PLAIN":
				if f.cfg.plainReply != "" {
					reply(f.cfg.plainReply)
					continue
				}
				raw, _ := base64.StdEncoding.DecodeString(initial)
				if parts := strings.Split(string(raw), "\x00"); len(parts) == 3 {
					user = parts[1]
				}
			case "LOGIN":
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
				u, err := readBase64Line(r)
				if err != nil {
					return
				}
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
				if _, err := readBase64Line(r); err != nil {
					return
				}
				user = u
			case "XOAUTH2":
				if !strings.Contains(f.cfg.authMechs, "XOAUTH2") {
					reply("504 5.7.4 Unrecognized authentication type")
					continue
				}
				raw, _ := base64.StdEncoding.DecodeString(initial)
				var token string
				user, token = xoauth2Fields(string(raw))
				if token != "good" {
					// Gmail: a base64 JSON error challenge, an empty client reply, then 535.
					reply("334 " + base64.StdEncoding.EncodeToString([]byte(`{"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}`)))
					answer, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if strings.TrimSpace(answer) != "" {
						reply("501 5.5.2 expected an empty reply to the error challenge")
						continue
					}
					reply("535 5.7.8 Username and Password not accepted")
					continue
				}
			default:
				reply("504 5.7.4 Unrecognized authentication type")
				continue
			}
			f.record(func(l *fakeSMTPLog) { l.authUsers = append(l.authUsers, user) })
			reply(f.cfg.authReply)
		case "*":
			reply("501 5.7.0 Authentication cancelled")
		case "MAIL":
			from := strings.TrimSuffix(strings.TrimPrefix(arg, "FROM:<"), ">")
			f.record(func(l *fakeSMTPLog) { l.mailFrom = append(l.mailFrom, from) })
			reply("250 2.1.0 OK")
		case "RCPT":
			to := strings.TrimSuffix(strings.TrimPrefix(arg, "TO:<"), ">")
			f.record(func(l *fakeSMTPLog) { l.rcpts = append(l.rcpts, to) })
			reply("250 2.1.5 OK")
		case "DATA":
			reply("354 Go ahead")
			var b strings.Builder
			for {
				dl, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if dl == ".\r\n" {
					break
				}
				b.WriteString(dl)
			}
			f.record(func(l *fakeSMTPLog) { l.data = b.String() })
			reply("250 2.0.0 Queued")
		case "NOOP", "RSET":
			reply("250 2.0.0 OK")
		case "QUIT":
			reply("221 2.0.0 Bye")
			return
		default:
			reply("502 5.5.2 Command not recognized")
		}
	}
}

// xoauth2Fields reads user and token from "user=U\x01auth=Bearer T\x01\x01".
func xoauth2Fields(s string) (user, token string) {
	for _, kv := range strings.Split(s, "\x01") {
		if v, ok := strings.CutPrefix(kv, "user="); ok {
			user = v
		}
		if v, ok := strings.CutPrefix(kv, "auth=Bearer "); ok {
			token = v
		}
	}
	return user, token
}

func readBase64Line(r *bufio.Reader) (string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(line))
	return string(raw), err
}
