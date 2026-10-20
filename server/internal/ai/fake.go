package ai

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

var sourceTag = regexp.MustCompile(`<untrusted source="(S\d+)">\n([^\n]+)`)

// FakeReply is the AI_PROVIDER=fake behaviour for development and E2E: a
// deterministic, well-formed answer for every prompt. For copilot_answer it
// cites every numbered source it was given, which is exactly what the
// cross-tenant E2E needs to observe; for meeting_summary it returns the
// smallest valid record.
func FakeReply(req provider.CompletionRequest) provider.CompletionResponse {
	last := ""
	if n := len(req.Messages); n > 0 {
		last = req.Messages[n-1].Content
	}
	var text string
	switch {
	case strings.Contains(req.System, "You are UNI") && len(req.Tools) > 0:
		return fakeAgentReply(req)
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
	case strings.Contains(req.System, "You catch a teammate up"):
		matches := sourceTag.FindAllStringSubmatch(last, -1)
		cu := CatchUp{Summary: "Không có tin mới để bắt kịp.", Highlights: []CatchUpHighlight{}, ActionItems: []CatchUpActionItem{}}
		if len(matches) > 0 {
			cu.Summary = "Có " + itoa(len(matches)) + " tin chưa đọc cần xem."
			for _, m := range matches {
				cu.Highlights = append(cu.Highlights, CatchUpHighlight{Text: strings.TrimSpace(m[2]), SourceID: m[1]})
			}
		}
		b, _ := json.Marshal(cu)
		text = string(b)
	case strings.Contains(req.System, "You summarize one email thread"):
		es := EmailThreadSummary{
			Summary:     "Bản tóm tắt email thử nghiệm.",
			KeyPoints:   []string{"Điểm chính thử nghiệm"},
			ActionItems: []ActionItem{{Title: "Theo dõi nội dung email", Owner: "", Due: ""}},
			NeedsReply:  false,
			ReplyHint:   "",
		}
		b, _ := json.Marshal(es)
		text = string(b)
	case strings.Contains(req.System, "You summarize a completed voice call"):
		cu := CatchUp{
			Summary:     "Cuộc gọi đã kết thúc.",
			Highlights:  []CatchUpHighlight{},
			ActionItems: []CatchUpActionItem{{Title: "Theo dõi việc đã thống nhất", Owner: "", Due: "", SourceID: ""}},
		}
		b, _ := json.Marshal(cu)
		text = string(b)
	case strings.Contains(req.System, "You analyze media files"):
		parts := 0
		if n := len(req.Messages); n > 0 {
			parts = len(req.Messages[n-1].Parts)
		}
		b, _ := json.Marshal(MediaAnalysis{Text: "Phân tích thử nghiệm của " + itoa(parts) + " tệp."})
		text = string(b)
	default:
		b, _ := json.Marshal(MeetingSummary{Summary: "Bản tóm tắt thử nghiệm.", Decisions: []string{}, ActionItems: []ActionItem{}})
		text = string(b)
	}
	// UsagePresent mirrors the scripted path in provider/fake.go: the fake knows
	// its own token counts, so a fake turn is known usage, not the unknown-usage
	// reconciliation branch (spec §8.2; G6-03b is the first reader).
	return provider.CompletionResponse{Text: text, Model: req.Model, UsagePresent: true, InputTokens: estimateTokens(req.System + last), OutputTokens: estimateTokens(text), StopReason: "end_turn"}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// fakeAgentReply is the copilot_answer@2 fake: search once with the question,
// then cite whatever sources the tool results carried.
func fakeAgentReply(req provider.CompletionRequest) provider.CompletionResponse {
	var tool, first string
	for _, m := range req.Messages {
		if m.Role == "tool" {
			tool += m.Content + "\n"
		} else if first == "" && m.Role == "user" {
			first = m.Content
		}
	}
	resp := provider.CompletionResponse{Model: req.Model, UsagePresent: true, InputTokens: estimateTokens(req.System + first + tool), StopReason: "end_turn"}
	if tool == "" {
		in, _ := json.Marshal(map[string]string{"query": fakeQuestion(first)})
		resp.ToolCalls = []provider.ToolCall{{ID: "fake-search-1", Name: "search", Input: in}}
		resp.StopReason = "tool_use"
	} else if matches := sourceTag.FindAllStringSubmatch(tool, -1); len(matches) == 0 {
		resp.Text = "Không tìm thấy dữ liệu nào bạn được xem về câu này."
	} else {
		var refs []string
		for _, m := range matches {
			refs = append(refs, "["+m[1]+"] "+strings.TrimSpace(m[2]))
		}
		resp.Text = "Tôi tìm thấy " + itoa(len(matches)) + " nguồn liên quan: " + strings.Join(refs, "; ")
	}
	resp.OutputTokens = estimateTokens(resp.Text)
	return resp
}

// fakeQuestion pulls the asker's question out of the rendered user message and
// undoes EscapeUntrusted's tag escaping.
func fakeQuestion(rendered string) string {
	const open = `<untrusted source="question">`
	i := strings.Index(rendered, open)
	if i < 0 {
		return rendered
	}
	q := rendered[i+len(open):]
	if j := strings.LastIndex(q, "</untrusted>"); j >= 0 {
		q = q[:j]
	}
	return strings.ReplaceAll(q, "&lt;", "<")
}
