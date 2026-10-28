package imapclient

import (
	"bufio"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func noBareExpunge(t *testing.T, f *fakeIMAP) {
	t.Helper()
	// A bare EXPUNGE also removes every message another client flagged \Deleted.
	if slices.Contains(f.commands(), "EXPUNGE") {
		t.Fatalf("bare EXPUNGE sent: %q", f.commands())
	}
}

func TestMoveMessageUsesUIDMove(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "MOVE UIDPLUS"}
	if err := MoveMessage(f.start(t), "INBOX", 1, "Archive"); err != nil {
		t.Fatal(err)
	}
	if !f.sent(`UID MOVE 1 "Archive"`) || f.sent("UID STORE") || f.sent("UID COPY") {
		t.Fatalf("expected a single UID MOVE, got %q", f.commands())
	}
	noBareExpunge(t, f)
}

func TestMoveMessageWithoutMoveExpungesOnlyThatUID(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "UIDPLUS"}
	if err := MoveMessage(f.start(t), "INBOX", 1, "Archive"); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`UID COPY 1 "Archive"`, `UID STORE 1 +FLAGS.SILENT (\Deleted)`, "UID EXPUNGE 1"} {
		if !f.sent(want) {
			t.Fatalf("expected %q, got %q", want, f.commands())
		}
	}
	noBareExpunge(t, f)
}

func TestMoveMessageRefusesWithoutMoveOrUIDPlus(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	if err := MoveMessage(f.start(t), "INBOX", 1, "Archive"); err == nil {
		t.Fatal("expected an error when the server can move neither safely")
	}
	if f.sent("UID STORE") || f.sent("UID COPY") {
		t.Fatalf("nothing may change on the server, got %q", f.commands())
	}
	noBareExpunge(t, f)
}

func TestMoveMessageOutOfGmailAllMailOnlyCopies(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "X-GM-EXT-1 MOVE UIDPLUS", reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "LIST") {
			return false
		}
		fmt.Fprintf(w, "* LIST (\\HasNoChildren \\All) \"/\" \"[Gmail]/All Mail\"\r\n%s OK done\r\n", tag)
		return true
	}}
	if err := MoveMessage(f.start(t), "[Gmail]/All Mail", 1, "INBOX"); err != nil {
		t.Fatal(err)
	}
	// Gmail reads "gone from All Mail" as "move to Trash": restoring only adds the Inbox label.
	if !f.sent("UID COPY 1 INBOX") || f.sent("UID MOVE") || f.sent("UID STORE") || f.sent("UID EXPUNGE") {
		t.Fatalf("expected only UID COPY, got %q", f.commands())
	}
	noBareExpunge(t, f)
}

func TestMoveUIDsBatchesOnOneSession(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "MOVE UIDPLUS"}
	creds := f.start(t)
	sess, err := OpenSessionInteractive(creds)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	if err := sess.MoveUIDs("INBOX", []uint32{1, 2, 3}, "Archive"); err != nil {
		t.Fatal(err)
	}
	moved := false
	for _, cmd := range f.commands() {
		if strings.HasPrefix(cmd, "UID MOVE ") && strings.Contains(cmd, `"Archive"`) {
			moved = true
			break
		}
	}
	if !moved {
		t.Fatalf("expected one batched UID MOVE, got %q", f.commands())
	}
	selects := 0
	for _, cmd := range f.commands() {
		if strings.HasPrefix(cmd, "SELECT ") {
			selects++
		}
	}
	if selects != 1 {
		t.Fatalf("expected one SELECT for the batch, got %d in %q", selects, f.commands())
	}
	noBareExpunge(t, f)
}
