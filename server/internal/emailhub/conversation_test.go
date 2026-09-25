package emailhub

import "testing"

func TestNormalizeSubject(t *testing.T) {
	t.Parallel()
	if got := NormalizeSubject("Re: Re: Hello"); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestConversationKeyPrefersInReplyTo(t *testing.T) {
	t.Parallel()
	got := ConversationKey("acc", "Re: Hi", "<child@x.com>", "<parent@x.com>")
	if got != "mid:<parent@x.com>" {
		t.Fatalf("got %q", got)
	}
}

func TestConversationKeySubjectFallback(t *testing.T) {
	t.Parallel()
	got := ConversationKey("acc1", "Chức năng", "", "")
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
}
