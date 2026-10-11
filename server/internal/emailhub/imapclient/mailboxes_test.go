package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestMailboxMapResolve(t *testing.T) {
	t.Parallel()
	m := MailboxMap{"INBOX": "Inbox", "SENT": "[Gmail]/Sent Mail"}
	if got := m.Resolve("SENT"); got != "[Gmail]/Sent Mail" {
		t.Fatalf("resolve sent: %q", got)
	}
	if got := m.Resolve("DRAFTS"); got != "DRAFTS" {
		t.Fatalf("fallback to logical: %q", got)
	}
	var nilMap MailboxMap
	if got := nilMap.Resolve("INBOX"); got != "INBOX" {
		t.Fatalf("nil map fallback: %q", got)
	}
}

// A Gmail account with many labels answers LIST with more rows than any
// fixed channel buffer; collecting only after List returns used to hang.
func TestListMailboxMapWithManyFolders(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "LIST") {
			return false
		}
		for i := range 200 {
			fmt.Fprintf(w, "* LIST (\\HasNoChildren) \"/\" \"Label %d\"\r\n", i)
		}
		fmt.Fprint(w, "* LIST (\\HasNoChildren \\Sent) \"/\" \"[Gmail]/Sent Mail\"\r\n")
		fmt.Fprintf(w, "%s OK done\r\n", tag)
		return true
	}}
	creds := f.start(t)
	cl, err := dial(creds)
	if err != nil {
		t.Fatal(err)
	}
	defer cl.Terminate() // Logout would block behind a hung LIST

	type result struct {
		m   MailboxMap
		err error
	}
	done := make(chan result, 1)
	go func() {
		m, err := ListMailboxMap(cl, MailboxMap{"SENT": "Sent"})
		done <- result{m, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatal(r.err)
		}
		if got := r.m.Resolve("SENT"); got != "[Gmail]/Sent Mail" {
			t.Fatalf("sent folder = %q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListMailboxMap hung on a LIST reply with 201 folders")
	}
}
