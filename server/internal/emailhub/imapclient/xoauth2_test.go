package imapclient

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/emersion/go-imap"
)

// xoauth2Creds points at f with an access token instead of a password.
func xoauth2Creds(t *testing.T, f *fakeIMAP, token string) Credentials {
	t.Helper()
	c := f.start(t)
	c.Password, c.AccessToken = "", token
	return c
}

// A token authenticates with AUTHENTICATE XOAUTH2, never LOGIN: inline when the
// server offers SASL-IR, after its empty continuation when it does not.
func TestXOAUTH2Succeeds(t *testing.T) {
	t.Parallel()
	for _, caps := range []string{"AUTH=XOAUTH2 SASL-IR", "AUTH=XOAUTH2"} {
		t.Run(caps, func(t *testing.T) {
			t.Parallel()
			f := &fakeIMAP{caps: caps}
			cl, err := dial(xoauth2Creds(t, f, "good"))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cl.Logout() }()
			if cl.State() != imap.AuthenticatedState {
				t.Fatalf("state = %v, want authenticated", cl.State())
			}
			if f.sent("LOGIN") {
				t.Fatalf("a token must never fall back to LOGIN: %q", f.commands())
			}
			inline := f.sent("AUTHENTICATE XOAUTH2 ")
			if want := strings.Contains(caps, "SASL-IR"); inline != want {
				t.Fatalf("initial response inline = %v, want %v: %q", inline, want, f.commands())
			}
			if users, _ := f.xoauth2Seen(); !slices.Equal(users, []string{"user@example.com"}) {
				t.Fatalf("XOAUTH2 user = %q, want the email when Username is empty", users)
			}
		})
	}
}

func TestXOAUTH2AuthenticationFailed(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	_, err := dial(xoauth2Creds(t, f, "expired"))
	if !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("want ErrAuthFailed, got %v", err)
	}
	if strings.Contains(err.Error(), "expired") {
		t.Fatalf("the error carries the token: %v", err)
	}
}

func TestXOAUTH2BareNO(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2", authNo: "NO AUTHENTICATE failed."}
	if _, err := dial(xoauth2Creds(t, f, "expired")); !errors.Is(err, ErrLoginRefused) {
		t.Fatalf("want ErrLoginRefused, got %v", err)
	}
}

// Gmail sends its error as a JSON challenge and waits for an empty line before
// the tagged NO; a "*" cancel would answer BAD and hide the code.
func TestXOAUTH2ErrorChallengeGetsEmptyReply(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	if _, err := dial(xoauth2Creds(t, f, "expired")); err == nil {
		t.Fatal("want an error")
	}
	if _, replies := f.xoauth2Seen(); !slices.Equal(replies, []string{""}) {
		t.Fatalf("challenge replies = %q, want one empty line", replies)
	}
}

func TestXOAUTH2UsesUsername(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	c := xoauth2Creds(t, f, "good")
	c.Username = "login-name"
	cl, err := dial(c)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	if users, _ := f.xoauth2Seen(); !slices.Equal(users, []string{"login-name"}) {
		t.Fatalf("XOAUTH2 user = %q, want Username", users)
	}
}
