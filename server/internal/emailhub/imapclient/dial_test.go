package imapclient

import (
	"bufio"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestDialStartTLSUpgradesBeforeLogin(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{starttls: true}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	cmds := f.commands()
	upgrade := slices.Index(cmds, "STARTTLS")
	login := slices.IndexFunc(cmds, func(c string) bool { return strings.HasPrefix(c, "LOGIN") })
	if upgrade < 0 || login < 0 || upgrade > login {
		t.Fatalf("expected STARTTLS before LOGIN, got %q", cmds)
	}
}

func TestDialStartTLSWithoutCapabilityIsTLSRequired(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{starttls: true, reply: func(w *bufio.Writer, tag, cmd string) bool {
		if cmd != "CAPABILITY" {
			return false
		}
		fmt.Fprintf(w, "* CAPABILITY IMAP4rev1\r\n%s OK done\r\n", tag)
		return true
	}}
	_, err := dial(f.start(t))
	if !errors.Is(err, ErrTLSRequired) {
		t.Fatalf("expected ErrTLSRequired, got %v", err)
	}
	if f.sent("LOGIN") || f.sent("STARTTLS") {
		t.Fatalf("the password must never cross a plaintext connection: %q", f.commands())
	}
}

func TestDialLogsInWithUsernameWhenSet(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	creds := f.start(t)
	creds.Username = "login-name"
	cl, err := dial(creds)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	for _, c := range f.commands() {
		if strings.HasPrefix(c, "LOGIN") {
			if !strings.Contains(c, "login-name") || strings.Contains(c, "user@example.com") {
				t.Fatalf("LOGIN must carry Username, got %q", c)
			}
			return
		}
	}
	t.Fatalf("no LOGIN sent: %q", f.commands())
}

// Not parallel: it swaps the package-wide tlsRootCAs.
func TestDialRefusesAnUntrustedCertificate(t *testing.T) {
	saved := tlsRootCAs
	tlsRootCAs = x509.NewCertPool() // trusts nothing
	t.Cleanup(func() { tlsRootCAs = saved })
	f := &fakeIMAP{}
	if _, err := dial(f.start(t)); err == nil {
		t.Fatal("expected a certificate error")
	}
	if f.sent("LOGIN") {
		t.Fatal("LOGIN sent over an unverified connection")
	}
}

// silentServer accepts TCP, writes greet (possibly nothing) and never answers.
func silentServer(t *testing.T, greet string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
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
			go func() {
				defer conn.Close()
				_, _ = io.WriteString(conn, greet)
				_, _ = io.Copy(io.Discard, conn) // until the client gives up and closes
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

// Not parallel: it shortens the package-wide greetingTimeout.
func TestDialGivesUpOnASilentServer(t *testing.T) {
	saved := greetingTimeout
	greetingTimeout = 300 * time.Millisecond
	t.Cleanup(func() { greetingTimeout = saved })
	cases := []struct{ name, greet, security string }{
		{"no greeting", "", "starttls"},
		{"tls handshake never answered", "", "tls"},
		// client.New sends CAPABILITY with no timeout when the greeting lacks it.
		{"greeting then silence", "* OK hi\r\n", "starttls"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			port := silentServer(t, tc.greet)
			done := make(chan error, 1)
			go func() {
				_, err := dial(Credentials{Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: tc.security})
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("expected an error from a silent server")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("dial hung past the greeting timeout")
			}
		})
	}
}

// Not parallel: it shortens the package-wide greetingTimeout.
func TestDialGivesUpOnAStalledStartTLSHandshake(t *testing.T) {
	saved := greetingTimeout
	greetingTimeout = 300 * time.Millisecond
	t.Cleanup(func() { greetingTimeout = saved })
	f := &fakeIMAP{starttls: true, reply: func(w *bufio.Writer, tag, cmd string) bool {
		if cmd != "STARTTLS" {
			return false
		}
		fmt.Fprintf(w, "%s OK begin TLS\r\n", tag) // then never answers the ClientHello
		return true
	}}
	creds := f.start(t)
	done := make(chan error, 1)
	go func() { _, err := dial(creds); done <- err }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error from a stalled handshake")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("dial hung in the STARTTLS handshake")
	}
}
