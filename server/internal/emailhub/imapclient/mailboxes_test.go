package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap"
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

func TestAssignMailboxes(t *testing.T) {
	t.Parallel()
	defaults := func() MailboxMap {
		return MailboxMap{"SENT": "SENT", "TRASH": "TRASH", "SPAM": "SPAM", "DRAFTS": "DRAFTS", "ARCHIVE": "ARCHIVE"}
	}
	mb := func(delim, name string, attrs ...string) *imap.MailboxInfo {
		return &imap.MailboxInfo{Delimiter: delim, Name: name, Attributes: attrs}
	}
	tests := []struct {
		name  string
		infos []*imap.MailboxInfo
		want  map[string]string
	}{
		{"attribute only", []*imap.MailboxInfo{mb("/", "[Gmail]/Sent Mail", imap.SentAttr), mb("/", "Bin", imap.TrashAttr)},
			map[string]string{"SENT": "[Gmail]/Sent Mail", "TRASH": "Bin", "SPAM": "SPAM"}},
		{"all attributes", []*imap.MailboxInfo{mb("/", "D", imap.DraftsAttr), mb("/", "J", imap.JunkAttr), mb("/", "A", imap.ArchiveAttr)},
			map[string]string{"DRAFTS": "D", "SPAM": "J", "ARCHIVE": "A"}},
		{"name only, dot delimiter", []*imap.MailboxInfo{mb(".", "INBOX"), mb(".", "INBOX.Sent"), mb(".", "INBOX.Deleted Items"), mb(".", "INBOX.Junk E-mail")},
			map[string]string{"SENT": "INBOX.Sent", "TRASH": "INBOX.Deleted Items", "SPAM": "INBOX.Junk E-mail"}},
		{"name only, slash delimiter", []*imap.MailboxInfo{mb("/", "Sent Messages"), mb("/", "Mail/Drafts"), mb("/", "Archive")},
			map[string]string{"SENT": "Sent Messages", "DRAFTS": "Mail/Drafts", "ARCHIVE": "Archive"}},
		{"case-insensitive", []*imap.MailboxInfo{mb("/", "TRASH"), mb("/", "sPaM")},
			map[string]string{"TRASH": "TRASH", "SPAM": "sPaM"}},
		{"attribute beats name, either order", []*imap.MailboxInfo{mb("/", "Sent"), mb("/", "Mine/Outgoing", imap.SentAttr)},
			map[string]string{"SENT": "Mine/Outgoing"}},
		{"first name match wins", []*imap.MailboxInfo{mb("/", "Sent Items"), mb("/", "Sent")},
			map[string]string{"SENT": "Sent Items"}},
		{"no match keeps the default", []*imap.MailboxInfo{mb("/", "INBOX"), mb("/", "Projects"), mb("/", "Resent")},
			map[string]string{"SENT": "SENT", "TRASH": "TRASH"}},
		{"no delimiter matches the whole name", []*imap.MailboxInfo{mb("", "Sent"), mb("", "X.Trash")},
			map[string]string{"SENT": "Sent", "TRASH": "TRASH"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := defaults()
			assignMailboxes(out, tc.infos)
			for k, want := range tc.want {
				if out[k] != want {
					t.Errorf("%s = %q, want %q", k, out[k], want)
				}
			}
		})
	}
}
