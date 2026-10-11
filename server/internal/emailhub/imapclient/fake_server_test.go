package imapclient

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeServerTLS / fakeRootCAs: one self-signed certificate for 127.0.0.1,
// served by every fake and trusted by dial through tlsRootCAs.
var fakeServerTLS, fakeRootCAs = newFakeTLS()

// Tests dial loopback, which netguard refuses; production keeps netguard.
func init() {
	dialTCP = (&net.Dialer{Timeout: 5 * time.Second}).DialContext
	tlsRootCAs = fakeRootCAs
}

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
	caps     string
	starttls bool
	reply    func(w *bufio.Writer, tag, cmd string) bool

	mu   sync.Mutex
	cmds []string
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
		tag, cmd, _ := strings.Cut(line, " ")
		f.record(cmd)
		verb, _, _ := strings.Cut(strings.ToUpper(cmd), " ")
		if verb == "IDLE" {
			idleTag = tag
		}
		if f.reply != nil && f.reply(w, tag, cmd) {
			_ = w.Flush()
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
		default:
			fmt.Fprintf(w, "%s OK done\r\n", tag)
		}
		_ = w.Flush()
	}
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
