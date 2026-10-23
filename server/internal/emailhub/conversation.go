package emailhub

import "strings"

// NormalizeSubject strips Re:/Fwd: prefixes for conversation grouping fallback.
func NormalizeSubject(subject string) string {
	s := strings.TrimSpace(subject)
	for {
		lower := strings.ToLower(s)
		switch {
		case strings.HasPrefix(lower, "re:"):
			s = strings.TrimSpace(s[3:])
		case strings.HasPrefix(lower, "fwd:"):
			s = strings.TrimSpace(s[4:])
		default:
			return strings.ToLower(s)
		}
	}
}

// NormalizeMessageID lowercases and ensures angle brackets for RFC 5322 headers.
func NormalizeMessageID(raw string) string {
	id := strings.TrimSpace(raw)
	if id == "" {
		return ""
	}
	if !strings.HasPrefix(id, "<") {
		id = "<" + strings.Trim(id, "<>") + ">"
	}
	return strings.ToLower(id)
}

// ConversationKey groups messages in one mailbox account into a conversation.
// The key is the root Message-ID: the first References entry, else In-Reply-To,
// else the message's own id; normalized subject per account is the fallback.
func ConversationKey(accountID, subject, messageID, inReplyTo, references string) string {
	if root := conversationRootMessageID(messageID, inReplyTo, references); root != "" {
		return "mid:" + root
	}
	subj := NormalizeSubject(subject)
	if subj != "" && accountID != "" {
		return "subj:" + accountID + ":" + subj
	}
	return ""
}

func conversationRootMessageID(messageID, inReplyTo, references string) string {
	// The first <...> of References is the root; ids may be unspaced ("<a><b>").
	if start := strings.IndexByte(references, '<'); start >= 0 {
		if end := strings.IndexByte(references[start:], '>'); end > 1 {
			return NormalizeMessageID(references[start : start+end+1])
		}
	}
	if parent := NormalizeMessageID(inReplyTo); parent != "" {
		return parent
	}
	return NormalizeMessageID(messageID)
}

// ReferencesHeader builds References for a reply (parent chain + parent id).
func ReferencesHeader(parentMessageID, existingReferences string) string {
	parent := NormalizeMessageID(parentMessageID)
	if parent == "" {
		return strings.TrimSpace(existingReferences)
	}
	parts := []string{}
	for _, p := range strings.Fields(existingReferences) {
		if n := NormalizeMessageID(p); n != "" {
			parts = append(parts, n)
		}
	}
	if len(parts) == 0 || parts[len(parts)-1] != parent {
		parts = append(parts, parent)
	}
	return strings.Join(parts, " ")
}
