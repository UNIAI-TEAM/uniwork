package imapclient

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
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

func TestDialWithTimeoutBoundsTLSGreeting(t *testing.T) {
	port := silentTLSGreetingServer(t)
	timeout := 150 * time.Millisecond
	started := time.Now()
	_, err := dialWithTimeout(Credentials{
		Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: "tls",
		dialer: &net.Dialer{Timeout: timeout}, rootCAs: fakeRootCAs,
	}, timeout)
	if err == nil {
		t.Fatal("expected a TLS greeting timeout")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("TLS greeting error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("TLS greeting timeout took %s, want at most 2s", elapsed)
	}
}

func TestDialWithTimeoutBoundsLogin(t *testing.T) {
	f := &fakeIMAP{reply: func(_ *bufio.Writer, _, cmd string) bool {
		return strings.HasPrefix(cmd, "LOGIN") // accept the command, then stay silent
	}}
	timeout := 150 * time.Millisecond
	started := time.Now()
	_, err := dialWithTimeout(f.start(t), timeout)
	if err == nil {
		t.Fatal("expected a LOGIN timeout")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("LOGIN error = %v, want context.DeadlineExceeded", err)
	}
	if !f.sent("LOGIN") {
		t.Fatalf("server never received LOGIN: commands=%q err=%v", f.commands(), err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("LOGIN timeout took %s, want at most 2s", elapsed)
	}
}

func TestDialStalledCapabilitiesKeepDeadlineTaxonomy(t *testing.T) {
	const timeout = 150 * time.Millisecond
	tests := []struct {
		name string
		run  func(*testing.T, time.Duration) error
	}{
		{"STARTTLS capability", stalledStartTLSCapability},
		{"XOAUTH2 capability", stalledXOAUTH2Capability},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run(t, timeout)
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("capability error = %v, want context.DeadlineExceeded", err)
			}
			if strings.Contains(err.Error(), "127.0.0.1") {
				t.Fatalf("capability error leaked endpoint: %v", err)
			}
		})
	}
}

func stalledStartTLSCapability(t *testing.T, timeout time.Duration) error {
	t.Helper()
	port := silentServer(t, "* OK hi\r\n")
	_, err := dialWithTimeout(Credentials{
		Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: "starttls",
		dialer: &net.Dialer{Timeout: timeout}, rootCAs: fakeRootCAs,
	}, timeout)
	return err
}

func stalledXOAUTH2Capability(t *testing.T, timeout time.Duration) error {
	t.Helper()
	capabilities := 0
	f := &fakeIMAP{starttls: true, reply: func(_ *bufio.Writer, _, cmd string) bool {
		if cmd != "CAPABILITY" {
			return false
		}
		capabilities++
		return capabilities == 2 // after STARTTLS, Support("SASL-IR") waits here
	}}
	creds := f.start(t)
	creds.Password, creds.AccessToken = "", "token"
	_, err := dialWithTimeout(creds, timeout)
	return err
}

func TestDialFailuresDoNotLogRawNetworkDetails(t *testing.T) {
	const subprocessCase = "UNIWORK_IMAP_FAILURE_LOG_CASE"
	if name := os.Getenv(subprocessCase); name != "" {
		runDialLogCase(t, name)
		return
	}
	for _, name := range []string{
		"tls-greeting", "login", "starttls", "starttls-capability", "xoauth2-capability", "malformed-read-failure",
	} {
		t.Run(name, func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestDialFailuresDoNotLogRawNetworkDetails$")
			cmd.Env = append(os.Environ(), subprocessCase+"="+name)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("dial subprocess failed: %v\n%s", err, out)
			}
			for _, raw := range []string{"127.0.0.1", "read tcp", "write tcp", "i/o timeout", "use of closed network connection"} {
				if strings.Contains(string(out), raw) {
					t.Fatalf("timeout log leaked %q:\n%s", raw, out)
				}
			}
			if name == "malformed-read-failure" && !strings.Contains(string(out), "error reading response") {
				t.Fatalf("malformed response diagnostic was unexpectedly disabled:\n%s", out)
			}
		})
	}
}

func runDialLogCase(t *testing.T, name string) {
	t.Helper()
	const timeout = 100 * time.Millisecond
	var err error
	switch name {
	case "tls-greeting":
		port := silentTLSGreetingServer(t)
		_, err = dialWithTimeout(Credentials{
			Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: "tls",
			dialer: &net.Dialer{Timeout: timeout}, rootCAs: fakeRootCAs,
		}, timeout)
	case "login":
		f := &fakeIMAP{reply: func(_ *bufio.Writer, _, cmd string) bool {
			return strings.HasPrefix(cmd, "LOGIN")
		}}
		_, err = dialWithTimeout(f.start(t), timeout)
	case "starttls":
		f := &fakeIMAP{starttls: true, reply: func(w *bufio.Writer, tag, cmd string) bool {
			if cmd != "STARTTLS" {
				return false
			}
			fmt.Fprintf(w, "%s OK begin TLS\r\n", tag)
			return true
		}}
		_, err = dialWithTimeout(f.start(t), timeout)
	case "starttls-capability":
		err = stalledStartTLSCapability(t, timeout)
	case "xoauth2-capability":
		err = stalledXOAUTH2Capability(t, timeout)
	case "malformed-read-failure":
		f := &fakeIMAP{
			reply: func(w *bufio.Writer, _, cmd string) bool {
				if !strings.HasPrefix(cmd, "LOGIN") {
					return false
				}
				fmt.Fprint(w, "not-an-imap-response\r\n")
				return true
			},
			resetAfterReply: func(cmd string) bool { return strings.HasPrefix(cmd, "LOGIN") },
		}
		_, err = dialWithTimeout(f.start(t), timeout)
	default:
		t.Fatalf("unknown subprocess case %q", name)
	}
	if name == "malformed-read-failure" {
		var netErr net.Error
		if !errors.As(err, &netErr) || strings.Contains(err.Error(), "127.0.0.1") {
			t.Fatalf("%s error = %v, want sanitized net.Error", name, err)
		}
		return
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("%s error = %v, want context.DeadlineExceeded", name, err)
	}
}

func TestCauseOrPreservesSemanticIMAPErrors(t *testing.T) {
	held := &deadlineHeldConn{}
	held.remember(context.DeadlineExceeded)
	dialer := &deadlineHoldingDialer{conn: held}
	for _, sentinel := range []error{ErrAuthFailed, ErrLoginRefused, ErrTLSRequired} {
		fallback := fmt.Errorf("semantic response: %w", sentinel)
		if got := dialer.causeOr(fallback); !errors.Is(got, sentinel) {
			t.Errorf("causeOr(%v) = %v, want semantic sentinel", sentinel, got)
		}
	}
	closed := errors.New("imap: connection closed")
	if got := dialer.causeOr(closed); !errors.Is(got, context.DeadlineExceeded) {
		t.Fatalf("causeOr(connection closed) = %v, want context.DeadlineExceeded", got)
	}
	wrappedClosed := fmt.Errorf("imap capability: %w", closed)
	if got := dialer.causeOr(wrappedClosed); !errors.Is(got, context.DeadlineExceeded) {
		t.Fatalf("causeOr(wrapped connection closed) = %v, want context.DeadlineExceeded", got)
	}
}

func TestDialSemanticFailuresWinOverConcurrentReset(t *testing.T) {
	tests := []struct {
		name  string
		start func(*testing.T) Credentials
		want  error
	}{
		{
			name: "authentication failed",
			start: func(t *testing.T) Credentials {
				f := &fakeIMAP{
					reply: func(w *bufio.Writer, tag, cmd string) bool {
						if !strings.HasPrefix(cmd, "LOGIN") {
							return false
						}
						fmt.Fprintf(w, "%s NO [AUTHENTICATIONFAILED] invalid\r\n", tag)
						return true
					},
					resetAfterReply: func(cmd string) bool { return strings.HasPrefix(cmd, "LOGIN") },
				}
				return f.start(t)
			},
			want: ErrAuthFailed,
		},
		{
			name: "bare login refusal",
			start: func(t *testing.T) Credentials {
				f := &fakeIMAP{
					reply: func(w *bufio.Writer, tag, cmd string) bool {
						if !strings.HasPrefix(cmd, "LOGIN") {
							return false
						}
						fmt.Fprintf(w, "%s NO login refused\r\n", tag)
						return true
					},
					resetAfterReply: func(cmd string) bool { return strings.HasPrefix(cmd, "LOGIN") },
				}
				return f.start(t)
			},
			want: ErrLoginRefused,
		},
		{
			name: "STARTTLS required",
			start: func(t *testing.T) Credentials {
				f := &fakeIMAP{
					starttls: true,
					reply: func(w *bufio.Writer, tag, cmd string) bool {
						if cmd != "CAPABILITY" {
							return false
						}
						fmt.Fprintf(w, "* CAPABILITY IMAP4rev1\r\n%s OK done\r\n", tag)
						return true
					},
					resetAfterReply: func(cmd string) bool { return cmd == "CAPABILITY" },
				}
				return f.start(t)
			},
			want: ErrTLSRequired,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := dialWithTimeout(tc.start(t), 500*time.Millisecond)
			if !errors.Is(err, tc.want) {
				t.Fatalf("dial error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestDialRefusesAnUntrustedCertificate(t *testing.T) {
	f := &fakeIMAP{}
	creds := f.start(t)
	creds.rootCAs = x509.NewCertPool() // trusts nothing
	if _, err := dial(creds); err == nil {
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

// silentTLSGreetingServer completes the TLS handshake, then never sends the
// IMAP greeting. This distinguishes greeting stalls from TLS handshake stalls.
func silentTLSGreetingServer(t *testing.T) int {
	t.Helper()
	ln, err := tls.Listen("tcp", "127.0.0.1:0", fakeServerTLS)
	if err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	t.Cleanup(func() {
		_ = ln.Close()
		workers.Wait()
	})
	workers.Add(1)
	go func() {
		defer workers.Done()
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer conn.Close()
				if err := conn.(*tls.Conn).Handshake(); err != nil {
					return
				}
				_, _ = io.Copy(io.Discard, conn)
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestDialGivesUpOnASilentServer(t *testing.T) {
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
				_, err := dialWithTimeout(Credentials{
					Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: tc.security,
					dialer: &net.Dialer{Timeout: 300 * time.Millisecond}, rootCAs: fakeRootCAs,
				}, 300*time.Millisecond)
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("expected an error from a silent server")
				}
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("silent server error = %v, want context.DeadlineExceeded", err)
				}
				if strings.Contains(err.Error(), "127.0.0.1") {
					t.Fatalf("silent server error leaked endpoint: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("dial hung past the greeting timeout")
			}
		})
	}
}

func TestDialGivesUpOnAStalledStartTLSHandshake(t *testing.T) {
	f := &fakeIMAP{starttls: true, reply: func(w *bufio.Writer, tag, cmd string) bool {
		if cmd != "STARTTLS" {
			return false
		}
		fmt.Fprintf(w, "%s OK begin TLS\r\n", tag) // then never answers the ClientHello
		return true
	}}
	creds := f.start(t)
	done := make(chan error, 1)
	go func() { _, err := dialWithTimeout(creds, 300*time.Millisecond); done <- err }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error from a stalled handshake")
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("STARTTLS error = %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("dial hung in the STARTTLS handshake")
	}
}
