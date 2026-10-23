package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
)

func TestCapIncrementalUIDs(t *testing.T) {
	t.Parallel()
	in := []uint32{105, 101, 103, 102, 104}
	got := capIncrementalUIDs(in)
	if len(got) != len(in) {
		t.Fatalf("expected all %d uids, got %d", len(in), len(got))
	}
	for i, uid := range in {
		if got[i] != uid {
			t.Fatalf("expected order preserved under cap, got %v", got)
		}
	}

	burst := make([]uint32, maxIncrementalUIDBatch+10)
	for i := range burst {
		burst[i] = uint32(i + 1)
	}
	got = capIncrementalUIDs(burst)
	if len(got) != maxIncrementalUIDBatch {
		t.Fatalf("expected batch cap %d, got %d", maxIncrementalUIDBatch, len(got))
	}
	if got[0] != 1 || got[len(got)-1] != uint32(maxIncrementalUIDBatch) {
		t.Fatalf("expected lowest uids first, got %v", got)
	}
}

func TestMaxUID(t *testing.T) {
	t.Parallel()
	if got := maxUID(nil); got != 0 {
		t.Fatalf("empty: %d", got)
	}
	items := []ThreadMeta{{UID: 3}, {UID: 9}, {UID: 5}}
	if got := maxUID(items); got != 9 {
		t.Fatalf("max uid: %d", got)
	}
}

func TestFetchMessagesReadsReferences(t *testing.T) {
	t.Parallel()
	lit := "References: <m1@x>\r\n <m2@x>\r\n\r\n"
	f := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "UID FETCH") {
			return false
		}
		fmt.Fprintf(w, "* 1 FETCH (UID 7 FLAGS () BODY[HEADER.FIELDS (REFERENCES)] {%d}\r\n%s)\r\n", len(lit), lit)
		fmt.Fprintf(w, "%s OK done\r\n", tag)
		return true
	}}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	if _, err := cl.Select("INBOX", false); err != nil {
		t.Fatal(err)
	}
	items, err := fetchUIDs(cl, []uint32{7}, false)
	if err != nil || len(items) != 1 {
		t.Fatalf("fetch: err=%v items=%d", err, len(items))
	}
	if !f.sent("UID FETCH 7 (") || !strings.Contains(strings.Join(f.commands(), "\n"), "BODY.PEEK[HEADER.FIELDS (REFERENCES)]") {
		t.Fatalf("References not requested: %q", f.commands())
	}
	if got := strings.Fields(items[0].References); len(got) != 2 || got[0] != "<m1@x>" || got[1] != "<m2@x>" {
		t.Fatalf("references: %q", items[0].References)
	}
}
