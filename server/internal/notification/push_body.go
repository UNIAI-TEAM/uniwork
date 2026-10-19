package notification

import (
	"encoding/json"
	"regexp"
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
