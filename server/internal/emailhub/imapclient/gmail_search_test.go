package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
)

func TestUidSearchGmailRawParsesUIDs(t *testing.T) {
	t.Parallel()
	loggedIn := false
	f := &fakeIMAP{reply: func(w *bufio.Writer, tag, command string) bool {
		switch {
		case command == "CAPABILITY":
			caps := "IMAP4rev1"
			if loggedIn {
				caps += " X-GM-EXT-1"
			}
			fmt.Fprintf(w, "* CAPABILITY %s\r\n%s OK done\r\n", caps, tag)
			return true
		case strings.HasPrefix(command, "LOGIN "):
			loggedIn = true
			fmt.Fprintf(w, "%s OK logged in\r\n", tag)
			return true
		case strings.HasPrefix(command, "SELECT "):
			fmt.Fprintf(w, "* 2 EXISTS\r\n%s OK selected\r\n", tag)
			return true
		case strings.Contains(command, "UID SEARCH") && strings.Contains(command, "X-GM-RAW"):
			fmt.Fprintf(w, "* SEARCH 10 42\r\n%s OK search done\r\n", tag)
			return true
		default:
			return false
		}
	}}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	if _, err := cl.Select("INBOX", false); err != nil {
		t.Fatal(err)
	}
	uids, err := uidSearchGmailRaw(cl, "is:starred")
	if err != nil {
		t.Fatal(err)
	}
	if len(uids) != 2 || uids[0] != 10 || uids[1] != 42 {
		t.Fatalf("uids = %v, want [10 42]", uids)
	}
}
