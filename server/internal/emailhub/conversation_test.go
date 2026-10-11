package emailhub

import "testing"

func TestNormalizeSubject(t *testing.T) {
	t.Parallel()
	if got := NormalizeSubject("Re: Re: Hello"); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestConversationKeyFallsBackToInReplyTo(t *testing.T) {
	t.Parallel()
	got := ConversationKey("acc", "Re: Hi", "<child@x.com>", "<parent@x.com>", "")
	if got != "mid:<parent@x.com>" {
		t.Fatalf("got %q", got)
	}
}

func TestConversationKeyPrefersReferencesRoot(t *testing.T) {
	t.Parallel()
	got := ConversationKey("acc", "Re: Hi", "<child@x.com>", "<parent@x.com>", "\r\n <ROOT@x.com><parent@x.com>")
	if got != "mid:<root@x.com>" {
		t.Fatalf("got %q", got)
	}
}

// A reply chain M1 -> M2 -> M3 -> M4 is one conversation, not one per parent.
func TestConversationKeyKeepsLongChainsTogether(t *testing.T) {
	t.Parallel()
	chain := []struct{ id, inReplyTo, refs string }{
		{"<m1@x>", "", ""},
		{"<m2@x>", "<m1@x>", "<m1@x>"},
		{"<m3@x>", "<m2@x>", "<m1@x> <m2@x>"},
		{"<m4@x>", "<m3@x>", "<m1@x> <m2@x> <m3@x>"},
	}
	for _, m := range chain {
		if got := ConversationKey("acc", "Re: Hi", m.id, m.inReplyTo, m.refs); got != "mid:<m1@x>" {
			t.Fatalf("%s: got %q", m.id, got)
		}
	}
}

func TestConversationKeySubjectFallback(t *testing.T) {
	t.Parallel()
	got := ConversationKey("acc1", "Chức năng", "", "", "")
	if got != "subj:acc1:chức năng" {
		t.Fatalf("got %q", got)
	}
}

func TestReferencesHeader(t *testing.T) {
	t.Parallel()
	got := ReferencesHeader("<p@x.com>", "")
	if got != "<p@x.com>" {
		t.Fatalf("got %q", got)
	}
	if got := ReferencesHeader("<p@x.com>", "<root@x.com>"); got != "<root@x.com> <p@x.com>" {
		t.Fatalf("got %q", got)
	}
}
