package service

import (
	"encoding/json"
	"sort"
	"strings"
)

const maxReactionEmojiLen = 16

type chatMessageMetadata struct {
	Reactions        map[string][]string  `json:"reactions"`
	Pinned           bool                 `json:"pinned,omitempty"`
	MentionedUserIDs []string             `json:"mentioned_user_ids,omitempty"`
	Poll             *ChatPollPayload     `json:"poll,omitempty"`
	Reminder         *ChatReminderPayload `json:"reminder,omitempty"`
	Note             *ChatNotePayload     `json:"note,omitempty"`
	Post             *ChatPostPayload     `json:"post,omitempty"`
	Priority         string               `json:"priority,omitempty"`
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
		return patchMetadataKey(raw, "reactions", nil)
	}
	return patchMetadataKey(raw, "reactions", meta.Reactions)
}

// patchMetadataKey rewrites one top-level key of a message's metadata and
// keeps every other key byte for byte. The typed struct above does not know
// the file, voice or call-log fields, so round-tripping through it would drop
// an attachment's object key the first time someone reacted to it. A nil
// value removes the key.
func patchMetadataKey(raw []byte, key string, value any) ([]byte, error) {
	fields := map[string]json.RawMessage{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
			fields = map[string]json.RawMessage{}
		}
	}
	if value == nil {
		delete(fields, key)
	} else {
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		fields[key] = encoded
	}
	if len(fields) == 0 {
		return []byte("{}"), nil
	}
	return json.Marshal(fields)
}

// myReactionsFromMetadata lists the emojis viewerID has reacted with, sorted,
// so a client can show its own reactions as pressed.
func myReactionsFromMetadata(raw []byte, viewerID string) []string {
	viewer := strings.ToUpper(strings.TrimSpace(viewerID))
	if viewer == "" {
		return nil
	}
	meta := decodeChatMessageMetadata(raw)
	var out []string
	for emoji, userIDs := range meta.Reactions {
		for _, id := range userIDs {
			if strings.ToUpper(strings.TrimSpace(id)) == viewer {
				out = append(out, emoji)
				break
			}
		}
	}
	sort.Strings(out)
	return out
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

func pinFromMetadata(raw []byte) bool {
	return decodeChatMessageMetadata(raw).Pinned
}

func togglePinInMetadata(raw []byte) ([]byte, bool, error) {
	pinned := !decodeChatMessageMetadata(raw).Pinned
	var value any
	if pinned {
		value = true
	}
	out, err := patchMetadataKey(raw, "pinned", value)
	if err != nil {
		return nil, false, err
	}
	return out, pinned, nil
}
