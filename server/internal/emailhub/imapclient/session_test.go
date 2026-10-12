package imapclient

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"slices"
	"testing"
	"time"
)

// closeWithin fails the test when Close does not return in time: a hung
// LOGOUT is exactly how a leaked IDLE shows up.
func closeWithin(t *testing.T, sess *Session, d time.Duration) {
	t.Helper()
	closed := make(chan error, 1)
	go func() { closed <- sess.Close() }()
	select {
	case <-closed:
	case <-time.After(d):
		t.Fatalf("session Close did not return within %s", d)
	}
}

func assertDoneRightAfterIdle(t *testing.T, cmds []string) {
	t.Helper()
	i := slices.Index(cmds, "IDLE")
	if i < 0 || i+1 >= len(cmds) || cmds[i+1] != "DONE" {
		t.Fatalf("expected DONE right after IDLE, got %q", cmds)
	}
}

func TestWatchFolderEndsIdleBeforeReturningOnABurstOfUpdates(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if cmd != "IDLE" {
			return false
		}
		// A bulk archive in webmail: far more updates than the channel holds.
		fmt.Fprint(w, "+ idling\r\n")
		for i := 0; i < 20; i++ {
			fmt.Fprint(w, "* 1 EXPUNGE\r\n")
		}
		return true
	}}
	sess, err := OpenSessionIdle(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	changed, err := sess.WatchFolder(ctx, "INBOX")
	if err != nil || !changed {
		t.Fatalf("expected a change, got changed=%v err=%v", changed, err)
	}
	closeWithin(t, sess, 2*time.Second)
	cmds := f.commands()
	assertDoneRightAfterIdle(t, cmds)
	if cmds[len(cmds)-1] != "LOGOUT" {
		t.Fatalf("expected LOGOUT last, got %q", cmds)
	}
}

func TestWatchFolderEndsIdleWhenTheRoundExpires(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	sess, err := OpenSessionIdle(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	changed, err := sess.WatchFolder(ctx, "INBOX")
	if changed || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected round end, got changed=%v err=%v", changed, err)
	}
	// The session is usable again: a command right after the round succeeds.
	if _, err := sess.cl.Select("INBOX", false); err != nil {
		t.Fatalf("select after watch: %v", err)
	}
	closeWithin(t, sess, 2*time.Second)
	assertDoneRightAfterIdle(t, f.commands())
}

func TestDialReportsARefusedLoginAsAuthFailed(t *testing.T) {
	t.Parallel()
	cases := map[string]error{
		"NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)": ErrAuthFailed,
		// Outlook's wrong password, but also what a throttling server may say.
		"NO LOGIN failed.": ErrLoginRefused,
		"NO [ALERT] Too many simultaneous connections. (Failure)": nil,
		"NO [UNAVAILABLE] Try again later":                        nil,
	}
	for answer, want := range cases {
		f := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
			if len(cmd) < 5 || cmd[:5] != "LOGIN" {
				return false
			}
			fmt.Fprintf(w, "%s %s\r\n", tag, answer)
			return true
		}}
		_, err := dial(f.start(t))
		if err == nil {
			t.Fatalf("%q: expected an error", answer)
		}
		for _, sentinel := range []error{ErrAuthFailed, ErrLoginRefused} {
			if got := errors.Is(err, sentinel); got != (sentinel == want) {
				t.Fatalf("%q: errors.Is(%v)=%v, want %v (err %v)", answer, sentinel, got, sentinel == want, err)
			}
		}
	}
}

func TestDialNetworkErrorIsNotAuthFailed(t *testing.T) {
	t.Parallel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	_, err = dial(Credentials{
		Host: "127.0.0.1", Port: port, Email: "u", Password: "p",
		dialer: &net.Dialer{Timeout: time.Second}, rootCAs: fakeRootCAs,
	})
	if err == nil || errors.Is(err, ErrAuthFailed) || errors.Is(err, ErrLoginRefused) {
		t.Fatalf("expected a plain network error, got %v", err)
	}
}

func TestDialLogsInAndReadsPostLoginCapabilities(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "MOVE UIDPLUS"}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer cl.Logout()
	if ok, err := cl.Support("MOVE"); err != nil || !ok {
		t.Fatalf("expected MOVE from the post-login CAPABILITY, got %v %v", ok, err)
	}
	if _, err := cl.Select("INBOX", false); err != nil {
		t.Fatalf("select after login: %v", err)
	}
}
