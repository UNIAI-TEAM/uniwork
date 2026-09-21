package imapclient

import "testing"

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
