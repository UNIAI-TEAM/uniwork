package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
)

func TestClientSupportsGmailLabelsReusesSessionCapabilities(t *testing.T) {
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
		default:
			return false
		}
	}}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()

	before := countIMAPCommands(f.commands(), "CAPABILITY")
	if !ClientSupportsGmailLabels(cl) {
		t.Fatal("expected the Gmail extension on the first check")
	}
	if !ClientSupportsGmailLabels(cl) {
		t.Fatal("expected the Gmail extension on the second check")
	}
	after := countIMAPCommands(f.commands(), "CAPABILITY")
	if got := after - before; got > 1 {
		t.Fatalf("two checks sent %d CAPABILITY commands, want at most one: %q", got, f.commands())
	}
}

func countIMAPCommands(commands []string, verb string) int {
	count := 0
	for _, command := range commands {
		if strings.EqualFold(command, verb) {
			count++
		}
	}
	return count
}
