package service

import (
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

func priorityFromMetadata(meta chatMessageMetadata) string {
	return normalizeMessagePriority(meta.Priority)
}

func encodeMessagePriorityMetadata(raw []byte, priority string) ([]byte, error) {
	priority = normalizeMessagePriority(priority)
	var v any
	if priority != "" {
		v = priority
	}
	return patchMetadataKey(raw, "priority", v)
}
