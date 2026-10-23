package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
	"time"
)

var appendRaw = []byte("From: user@example.com\r\nTo: dest@example.com\r\nSubject: Hi\r\n" +
	"Message-ID: <a1@example.com>\r\n\r\nHello\r\n")

func appendCommand(f *fakeIMAP) string {
	for _, c := range f.commands() {
		if strings.HasPrefix(c, "APPEND ") {
			return c
		}
	}
	return ""
}

func TestSessionAppendReturnsAPPENDUID(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "UIDPLUS"}
	sess, err := OpenSession(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess, 2*time.Second)
	at := time.Date(2026, 10, 11, 9, 30, 0, 0, time.UTC)
	uid, err := sess.Append("Sent", []string{`\Seen`}, at, appendRaw)
	if err != nil || uid != 42 {
		t.Fatalf("Append = %d, %v; want 42 from APPENDUID", uid, err)
	}
	want := fmt.Sprintf(`APPEND "Sent" (\Seen) "11-Oct-2026 09:30:00 +0000" {%d}`, len(appendRaw))
	if got := appendCommand(f); got != want {
		t.Fatalf("APPEND line = %q, want %q", got, want)
	}
	if lits := f.appended(); len(lits) != 1 || lits[0] != string(appendRaw) {
		t.Fatalf("literal = %q, want the raw message byte for byte", lits)
	}
}

func TestSessionAppendWithoutUIDPLUS(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	sess, err := OpenSession(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess, 2*time.Second)
	uid, err := sess.Append("Sent", []string{`\Seen`}, time.Now(), appendRaw)
	if err != nil || uid != 0 {
		t.Fatalf("plain OK: Append = %d, %v; want 0, nil", uid, err)
	}

	refused := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "APPEND ") {
			return false
		}
		fmt.Fprintf(w, "%s NO [TRYCREATE] Mailbox does not exist\r\n", tag)
		return true
	}}
	sess2, err := OpenSession(refused.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess2, 2*time.Second)
	if uid, err := sess2.Append("SENT", []string{`\Seen`}, time.Now(), appendRaw); err == nil || uid != 0 {
		t.Fatalf("NO [TRYCREATE]: Append = %d, %v; want an error", uid, err)
	}
}
