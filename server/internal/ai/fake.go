package ai

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

var sourceTag = regexp.MustCompile(`\[(S\d+)\] ([^\n(]+)`)

// fakeReply is the AI_PROVIDER=fake behaviour for development and E2E: a
// deterministic, well-formed answer for every prompt. For copilot_answer it
// cites every numbered source it was given, which is exactly what the
// cross-tenant E2E needs to observe; for meeting_summary it returns the
// smallest valid record.
func fakeReply(req provider.CompletionRequest) provider.CompletionResponse {
	last := ""
	if n := len(req.Messages); n > 0 {
		last = req.Messages[n-1].Content
	}
	var text string
	switch {
	case strings.Contains(req.System, "You are UNI"):
		matches := sourceTag.FindAllStringSubmatch(last, -1)
		ans := Answer{Citations: []Citation{}}
		if len(matches) == 0 {
			ans.Answer = NoSourcesAnswer
		} else {
			var refs []string
			for _, m := range matches {
				refs = append(refs, "["+m[1]+"] "+strings.TrimSpace(m[2]))
				ans.Citations = append(ans.Citations, Citation{SourceID: m[1], Quote: strings.TrimSpace(m[2])})
			}
			ans.Answer = "Tôi tìm thấy " + itoa(len(matches)) + " nguồn liên quan: " + strings.Join(refs, "; ") + "."
		}
		b, _ := json.Marshal(ans)
		text = string(b)
	default:
		b, _ := json.Marshal(MeetingSummary{Summary: "Bản tóm tắt thử nghiệm.", Decisions: []string{}, ActionItems: []ActionItem{}})
		text = string(b)
	}
	return provider.CompletionResponse{Text: text, Model: req.Model, InputTokens: estimateTokens(req.System + last), OutputTokens: estimateTokens(text), StopReason: "end_turn"}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
