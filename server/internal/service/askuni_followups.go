package service

import (
	"regexp"
	"strings"
)

// copilot_answer@4 may end an answer with a block of follow-up questions
// (R6): "<followups>", one "- question" per line, "</followups>". The server
// splits it off the answer; the dock shows the questions as chips.

const (
	followupsTag     = "<followups"
	followupsClose   = "</followups>"
	followupsMax     = 3
	followupRunesMax = 120
)

var (
	followupBullet = regexp.MustCompile(`^\s*(?:[-*•]|\d+[.)])\s*`)
	mdLink         = regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`)
	followupNoise  = regexp.MustCompile(`<[^>]*>|https?://\S+`)
)

// splitFollowups is the answer without its follow-up block, and the block's
// questions: at most followupsMax, each one line of plain text within
// followupRunesMax runes. An answer without the block comes back verbatim; a
// block cut off before its closing tag (a stop) yields no question.
func splitFollowups(answer string) (body string, items []string) {
	i := strings.Index(answer, followupsTag)
	if i < 0 {
		return answer, nil
	}
	body = strings.TrimSpace(answer[:i])
	_, rest, ok := strings.Cut(answer[i:], ">")
	if !ok {
		return body, nil
	}
	inner, _, ok := strings.Cut(rest, followupsClose)
	if !ok {
		return body, nil
	}
	for _, line := range strings.Split(inner, "\n") {
		if q := followupText(line); q != "" && len(items) < followupsMax {
			items = append(items, q)
		}
	}
	return body, items
}

// followupText is one line of the block as a chip shows it: no bullet,
// Markdown, link or tag, whitespace collapsed, cut to followupRunesMax.
func followupText(line string) string {
	q := followupBullet.ReplaceAllString(line, "")
	q = quoteText(followupNoise.ReplaceAllString(mdLink.ReplaceAllString(q, "$1"), ""))
	if r := []rune(q); len(r) > followupRunesMax {
		q = strings.TrimSpace(string(r[:followupRunesMax]))
	}
	return q
}

// cutAtFollowups is streamed text up to the follow-up block, holding back a
// tail that may still grow into its tag.
func cutAtFollowups(s string) string {
	if i := strings.Index(s, followupsTag); i >= 0 {
		return s[:i]
	}
	for n := min(len(followupsTag)-1, len(s)); n > 0; n-- {
		if strings.HasSuffix(s, followupsTag[:n]) {
			return s[:len(s)-n]
		}
	}
	return s
}
