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

// Hidden, a push names no one and nothing: not the sender, the room, the task
// or document, nor a reminder's words (audit "Security & privacy": the title
// passes through Expo, FCM and APNs as the body does). It still says what kind
// of thing happened, so a person knows whether to open the app.
func TestHiddenPushTitleNamesNoOneAndNothing(t *testing.T) {
	cases := []struct{ locale, kind, channel, want string }{
		{"vi", KindChatDM, ChannelMessages, "Tin nhắn riêng mới"},
		{"vi", KindChatMentioned, ChannelMentions, "Bạn được nhắc đến trong một cuộc trò chuyện"},
		{"vi", KindChatThreadReplied, ChannelMessages, "Có trả lời mới trong một thread"},
		{"vi", KindChatDM, ChannelMissedCalls, "Cuộc gọi nhỡ"},
		{"vi", KindTaskAssigned, ChannelGeneral, "Bạn có thông báo mới"},
		{"vi", KindChatReminder, ChannelGeneral, "Bạn có thông báo mới"},
		{"en", KindChatDM, ChannelMessages, "New direct message"},
		{"en", KindChatMentioned, ChannelMentions, "You were mentioned in a conversation"},
		{"en", KindChatThreadReplied, ChannelMessages, "New reply in a thread"},
		{"en", KindChatDM, ChannelMissedCalls, "Missed call"},
		{"en", KindDocumentShared, ChannelGeneral, "You have a new notification"},
		{"fr", KindChatDM, ChannelMessages, "New direct message"},
	}
	for _, c := range cases {
		if got := hiddenPushTitle(c.locale, c.kind, c.channel); got != c.want {
			t.Errorf("%s %s %s: %q, want %q", c.locale, c.kind, c.channel, got, c.want)
		}
	}
}
