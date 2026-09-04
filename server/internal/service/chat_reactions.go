package service

import (
	"encoding/json"
	"strings"
)

const maxReactionEmojiLen = 16

type chatMessageMetadata struct {
	Reactions map[string][]string `json:"reactions"`
}

func reactionCountsFromMetadata(raw []byte) map[string]int {
	meta := decodeChatMessageMetadata(raw)
	if len(meta.Reactions) == 0 {
		return nil
	}
	out := make(map[string]int, len(meta.Reactions))
	for emoji, userIDs := range meta.Reactions {
		if len(userIDs) == 0 {
			continue
		}
		out[emoji] = len(userIDs)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func toggleReactionInMetadata(raw []byte, userID, emoji string) ([]byte, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len(emoji) > maxReactionEmojiLen {
		return nil, Invalid("emoji không hợp lệ")
	}
	userID = strings.ToUpper(strings.TrimSpace(userID))
	meta := decodeChatMessageMetadata(raw)
	if meta.Reactions == nil {
		meta.Reactions = map[string][]string{}
	}
	ids := meta.Reactions[emoji]
	found := false
	next := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if id == userID {
			found = true
			continue
		}
		next = append(next, id)
	}
	if !found {
		next = append(next, userID)
	}
	if len(next) == 0 {
		delete(meta.Reactions, emoji)
	} else {
		meta.Reactions[emoji] = next
	}
	if len(meta.Reactions) == 0 {
		return []byte("{}"), nil
	}
	return json.Marshal(meta)
}

func decodeChatMessageMetadata(raw []byte) chatMessageMetadata {
	if len(raw) == 0 {
		return chatMessageMetadata{}
	}
	var meta chatMessageMetadata
	if err := json.Unmarshal(raw, &meta); err != nil {
		return chatMessageMetadata{}
	}
	if meta.Reactions == nil {
		meta.Reactions = map[string][]string{}
	}
	return meta
}
