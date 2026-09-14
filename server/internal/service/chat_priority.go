package service

import (
	"encoding/json"
	"strings"
)

const (
	chatMessagePriorityImportant = "important"
	chatMessagePriorityUrgent    = "urgent"
)

func normalizeMessagePriority(priority string) string {
	priority = strings.TrimSpace(strings.ToLower(priority))
	switch priority {
	case chatMessagePriorityImportant, chatMessagePriorityUrgent:
		return priority
	default:
		return ""
	}
}

func priorityFromMetadata(raw []byte) string {
	return normalizeMessagePriority(decodeChatMessageMetadata(raw).Priority)
}

func encodeMessagePriorityMetadata(raw []byte, priority string) ([]byte, error) {
	meta := decodeChatMessageMetadata(raw)
	meta.Priority = normalizeMessagePriority(priority)
	if meta.Priority == "" {
		meta.Priority = ""
	}
	if len(meta.Reactions) == 0 && !meta.Pinned && len(meta.MentionedUserIDs) == 0 &&
		meta.Poll == nil && meta.Reminder == nil && meta.Note == nil && meta.Post == nil && meta.Priority == "" {
		return []byte("{}"), nil
	}
	return json.Marshal(meta)
}
