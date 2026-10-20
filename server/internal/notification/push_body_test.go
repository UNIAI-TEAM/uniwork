package notification

import (
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestPushBody(t *testing.T) {
	long := strings.Repeat("ă", 130)
	cases := []struct {
		name, locale string
		msg          db.ChatMessage
		want         string
	}{
		{"text with mention and markdown", "vi", db.ChatMessage{Kind: "text", Body: "[@Minh](mention://member/01X) xem **gấp** `nhé`"}, "@Minh xem gấp nhé"},
		{"cut at 120 runes", "vi", db.ChatMessage{Kind: "text", Body: long}, strings.Repeat("ă", 120) + "…"},
		{"file vi", "vi", db.ChatMessage{Kind: "file", Body: "bao-cao.xlsx", Metadata: []byte(`{"content_type":"application/vnd.ms-excel"}`)}, "[Tệp]"},
		{"image en", "en", db.ChatMessage{Kind: "file", Body: "a.png", Metadata: []byte(`{"content_type":"image/png"}`)}, "[Image]"},
		{"voice unknown locale falls back to en", "fr", db.ChatMessage{Kind: "voice", Body: ""}, "[Voice message]"},
		{"call log has no body", "vi", db.ChatMessage{Kind: "voice_call_log", Body: "x"}, ""},
	}
	for _, c := range cases {
		if got := pushBody(c.locale, c.msg); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}
