package notification

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// isChatPushKind reports the kinds whose push carries a message preview.
func isChatPushKind(kind string) bool {
	return kind == KindChatMentioned || kind == KindChatDM || kind == KindChatThreadReplied
}

var pushBodyLabels = map[string]map[string]string{
	"vi": {"file": "[Tệp]", "image": "[Ảnh]", "voice": "[Tin thoại]"},
	"en": {"file": "[File]", "image": "[Image]", "voice": "[Voice message]"},
}

// hiddenPushTitles stand in for the whole push when the recipient or their
// organization hides previews (service.SetPushPreviews, SetPushPreviewPolicy).
// A title passes through Expo, FCM and APNs and sits on a lock screen as the
// body does, so these name no one and nothing: not the sender, the room, a
// task or document, nor a reminder's words. They say only what kind of thing
// happened. "" is every kind without a line of its own.
var hiddenPushTitles = map[string]map[string]string{
	"vi": {
		KindChatDM:            "Tin nhắn riêng mới",
		KindChatMentioned:     "Bạn được nhắc đến trong một cuộc trò chuyện",
		KindChatThreadReplied: "Có trả lời mới trong một thread",
		ChannelMissedCalls:    "Cuộc gọi nhỡ",
		"":                    "Bạn có thông báo mới",
	},
	"en": {
		KindChatDM:            "New direct message",
		KindChatMentioned:     "You were mentioned in a conversation",
		KindChatThreadReplied: "New reply in a thread",
		ChannelMissedCalls:    "Missed call",
		"":                    "You have a new notification",
	},
}

// hiddenPushTitle is the title of a hidden push; the body is left empty. A
// missed call is told by its channel, since its row is a chat_dm.
func hiddenPushTitle(locale, kind, channel string) string {
	titles, ok := hiddenPushTitles[locale]
	if !ok {
		titles = hiddenPushTitles["en"]
	}
	if channel == ChannelMissedCalls {
		return titles[ChannelMissedCalls]
	}
	if title, ok := titles[kind]; ok {
		return title
	}
	return titles[""]
}

// chatUnreadSummaries say how many messages a chat row holds, after the
// title of an Android push that replaced the room's earlier ones.
var chatUnreadSummaries = map[string]string{
	"vi": "{{count}} tin nhắn mới",
	"en": "{{count}} new messages",
}

// chatUnreadSummary is that line in locale (en when unknown); "" for a
// single message.
func chatUnreadSummary(locale string, count int) string {
	if count < 2 {
		return ""
	}
	s, ok := chatUnreadSummaries[locale]
	if !ok {
		s = chatUnreadSummaries["en"]
	}
	return strings.ReplaceAll(s, "{{count}}", strconv.Itoa(count))
}

var (
	pushMarkdownLink  = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	pushMarkdownMarks = strings.NewReplacer("`", "", "*", "", "_", "", "~", "")
)

// pushBody is the plain-text preview a chat push shows under its title.
func pushBody(locale string, msg db.ChatMessage) string {
	labels, ok := pushBodyLabels[locale]
	if !ok {
		labels = pushBodyLabels["en"]
	}
	switch msg.Kind {
	case "voice_call_log":
		return ""
	case "voice":
		return labels["voice"]
	case "file":
		var meta struct {
			ContentType string `json:"content_type"`
		}
		_ = json.Unmarshal(msg.Metadata, &meta)
		if strings.HasPrefix(meta.ContentType, "image/") {
			return labels["image"]
		}
		return labels["file"]
	}
	body := service.ChatPreviewBody(msg.Body, msg.Kind)
	body = pushMarkdownMarks.Replace(pushMarkdownLink.ReplaceAllString(body, "$1"))
	if r := []rune(body); len(r) > 120 {
		body = string(r[:120]) + "…"
	}
	return body
}
