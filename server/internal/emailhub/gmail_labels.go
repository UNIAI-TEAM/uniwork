package emailhub

import "strings"

var gmailSystemLabels = map[string]struct{}{
	"inbox": {}, "sent": {}, "draft": {}, "drafts": {}, "trash": {}, "spam": {},
	"starred": {}, "important": {}, "chat": {}, "scheduled": {}, "unread": {},
	"opened": {}, "category_personal": {}, "category_social": {}, "category_promotions": {},
	"category_updates": {}, "category_forums": {}, "category_purchases": {},
}

// UserVisibleImapLabels drops Gmail system/category labels for UI chips and filters.
func UserVisibleImapLabels(labels []string) []string {
	if len(labels) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(labels))
	seen := make(map[string]struct{}, len(labels))
	for _, raw := range labels {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		key := strings.ToLower(strings.TrimPrefix(name, "\\"))
		if _, system := gmailSystemLabels[key]; system {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}
