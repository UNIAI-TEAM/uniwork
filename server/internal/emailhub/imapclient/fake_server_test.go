package imapclient

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"io"
	"math/big"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeServerTLS / fakeRootCAs: one self-signed certificate for 127.0.0.1,
// served by every fake and trusted through the test credentials.
var fakeServerTLS, fakeRootCAs = newFakeTLS()

func newFakeTLS() (*tls.Config, *x509.CertPool) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "fake imap"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		panic(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
		MinVersion:   tls.VersionTLS12,
	}, pool
}

// fakeIMAP is a scripted IMAP server. It records every command line it
// receives (tag stripped) and answers with reply when that returns true,
// otherwise with a minimal default. By default it speaks implicit TLS;
// with starttls it greets in plaintext, advertises STARTTLS and upgrades.
type fakeIMAP struct {
	caps            string
	starttls        bool
	reply           func(w *bufio.Writer, tag, cmd string) bool
	resetAfterReply func(cmd string) bool
	// authNo is the tagged answer to an XOAUTH2 token other than "good";
	// empty means Gmail's NO [AUTHENTICATIONFAILED].
	authNo string

	mu               sync.Mutex
	cmds             []string
	literals         []string
	authUsers        []string // XOAUTH2 user= values, decoded
	challengeReplies []string // what the client answered the error challenge with
}

func (f *fakeIMAP) start(t *testing.T) Credentials {
	t.Helper()
	var ln net.Listener
	var err error
	security := "" // empty means implicit TLS, so every default-fake test proves the default
	if f.starttls {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		security = "starttls"
	} else {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", fakeServerTLS)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return Credentials{
		Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port,
		Email: "user@example.com", Password: "secret", Security: security,
		dialer: &net.Dialer{Timeout: 5 * time.Second}, rootCAs: fakeRootCAs,
	}
}

func (f *fakeIMAP) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.cmds...)
}

func (f *fakeIMAP) serve(conn net.Conn) {
	defer func() { _ = conn.Close() }() // conn is reassigned on STARTTLS
	r := bufio.NewReader(conn)
	w := bufio.NewWriter(conn)
	fmt.Fprint(w, "* OK fake ready\r\n")
	_ = w.Flush()
	idleTag := ""
	upgraded := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "DONE" {
			f.record("DONE")
			fmt.Fprintf(w, "%s OK IDLE terminated\r\n", idleTag)
			_ = w.Flush()
			continue
		}
		if n, ok := literalSize(line); ok {
			// A synchronizing literal (APPEND): invite it, then read it and the CRLF ending the command.
			fmt.Fprint(w, "+ go\r\n")
			_ = w.Flush()
			lit := make([]byte, n)
			if _, err := io.ReadFull(r, lit); err != nil {
				return
			}
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
			f.mu.Lock()
			f.literals = append(f.literals, string(lit))
			f.mu.Unlock()
		}
		tag, cmd, _ := strings.Cut(line, " ")
		f.record(cmd)
		verb, _, _ := strings.Cut(strings.ToUpper(cmd), " ")
		if verb == "IDLE" {
			idleTag = tag
		}
		if f.reply != nil && f.reply(w, tag, cmd) {
			_ = w.Flush()
			if f.resetAfterReply != nil && f.resetAfterReply(cmd) {
				resetTCPConnection(conn)
				return
			}
			continue
		}
		switch verb {
		case "CAPABILITY":
			caps := f.caps
			if f.starttls && !upgraded {
				caps = strings.TrimSpace(caps + " STARTTLS")
			}
			fmt.Fprintf(w, "* CAPABILITY IMAP4rev1 IDLE %s\r\n%s OK done\r\n", caps, tag)
		case "STARTTLS":
			fmt.Fprintf(w, "%s OK begin TLS\r\n", tag)
			_ = w.Flush()
			conn = tls.Server(conn, fakeServerTLS)
			r, w = bufio.NewReader(conn), bufio.NewWriter(conn)
			upgraded = true
			continue
		case "SELECT":
			fmt.Fprintf(w, "* 30 EXISTS\r\n%s OK [READ-WRITE] selected\r\n", tag)
		case "IDLE":
			fmt.Fprint(w, "+ idling\r\n")
		case "LOGOUT":
			fmt.Fprintf(w, "* BYE bye\r\n%s OK done\r\n", tag)
			_ = w.Flush()
			return
		case "AUTHENTICATE":
			if !f.authenticate(r, w, tag, cmd) {
				return
			}
		case "APPEND":
			if strings.Contains(f.caps, "UIDPLUS") {
				fmt.Fprintf(w, "%s OK [APPENDUID 7 42] APPEND completed\r\n", tag)
			} else {
				fmt.Fprintf(w, "%s OK done\r\n", tag)
			}
		default:
			fmt.Fprintf(w, "%s OK done\r\n", tag)
		}
		_ = w.Flush()
	}
}

func resetTCPConnection(conn net.Conn) {
	if tlsConn, ok := conn.(*tls.Conn); ok {
		conn = tlsConn.NetConn()
	}
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetLinger(0)
	}
	_ = conn.Close()
}

// authenticate answers AUTHENTICATE XOAUTH2 like Gmail: the initial response
// inline (SASL-IR) or after an empty "+", OK for the token "good", otherwise a
// base64 JSON error challenge, the client's reply, then a tagged NO.
func (f *fakeIMAP) authenticate(r *bufio.Reader, w *bufio.Writer, tag, cmd string) bool {
	fields := strings.Fields(cmd)
	if len(fields) < 2 || !strings.EqualFold(fields[1], "XOAUTH2") {
		fmt.Fprintf(w, "%s NO unsupported mechanism\r\n", tag)
		return true
	}
	ir := ""
	if len(fields) > 2 {
		ir = fields[2]
	} else {
		fmt.Fprint(w, "+ \r\n")
		_ = w.Flush()
		line, err := r.ReadString('\n')
		if err != nil {
			return false
		}
		ir = strings.TrimRight(line, "\r\n")
	}
	raw, _ := base64.StdEncoding.DecodeString(ir)
	user, token := xoauth2Fields(string(raw))
	f.mu.Lock()
	f.authUsers = append(f.authUsers, user)
	f.mu.Unlock()
	if token == "good" {
		fmt.Fprintf(w, "%s OK authenticated\r\n", tag)
		return true
	}
	fmt.Fprintf(w, "+ %s\r\n", base64.StdEncoding.EncodeToString([]byte(`{"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}`)))
	_ = w.Flush()
	line, err := r.ReadString('\n')
	if err != nil {
		return false
	}
	f.mu.Lock()
	f.challengeReplies = append(f.challengeReplies, strings.TrimRight(line, "\r\n"))
	f.mu.Unlock()
	no := f.authNo
	if no == "" {
		no = "NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)"
	}
	fmt.Fprintf(w, "%s %s\r\n", tag, no)
	return true
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

// xoauth2Seen returns the XOAUTH2 users and challenge replies, in order.
func (f *fakeIMAP) xoauth2Seen() (users, replies []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.authUsers...), append([]string(nil), f.challengeReplies...)
}

func (f *fakeIMAP) record(cmd string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cmds = append(f.cmds, cmd)
}

// sent reports whether a command starting with prefix was received.
func (f *fakeIMAP) sent(prefix string) bool {
	for _, c := range f.commands() {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

// appended returns the literals the fake received, in order.
func (f *fakeIMAP) appended() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.literals...)
}

// literalSize parses a trailing synchronizing literal "{N}" (RFC 3501 §4.3).
func literalSize(line string) (int, bool) {
	open := strings.LastIndexByte(line, '{')
	if open < 0 || !strings.HasSuffix(line, "}") {
		return 0, false
	}
	n, err := strconv.Atoi(line[open+1 : len(line)-1])
	return n, err == nil
}
