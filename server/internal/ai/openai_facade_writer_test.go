package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// writerDataLines is every "data: " payload of an SSE body, in order.
func writerDataLines(t *testing.T, body string) []string {
	t.Helper()
	var out []string
	for _, line := range strings.Split(body, "\n") {
		if after, ok := strings.CutPrefix(line, "data: "); ok {
			out = append(out, after)
		}
	}
	return out
}

// writerChunk is the part of a chunk these tests read.
type writerChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage    *UniworkUsage `json:"usage"`
	XUniwork *struct {
		Terminal *UniworkTerminal `json:"terminal"`
	} `json:"x_uniwork"`
}

func decodeWriterChunk(t *testing.T, raw string) writerChunk {
	t.Helper()
	var c writerChunk
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatalf("chunk %q: %v", raw, err)
	}
	return c
}

// The writer route streams for real (plan 5): every delta is one
// chat.completion.chunk as it arrives, the last chunk carries finish_reason
// and usage, and [DONE] closes the stream. The 200 goes out with the first
// delta, never before.
func TestUniworkDeltaStreamWritesOpenAIChunks(t *testing.T) {
	rec := httptest.NewRecorder()
	s := NewUniworkDeltaStream(rec, UniworkResponseMeta{Model: "fake-1", Now: time.Unix(1_791_800_000, 0)})
	if s.Started() {
		t.Fatal("a stream with no delta reports started")
	}
	if err := s.Delta("Xin "); err != nil {
		t.Fatal(err)
	}
	if !s.Started() || rec.Code != http.StatusOK {
		t.Fatalf("after the first delta: started %v, status %d; want true, 200", s.Started(), rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	if err := s.Delta("chào"); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(Response{Text: "Xin chào", Model: "fake-1", InputTokens: 3, OutputTokens: 2, StopReason: "end_turn"}); err != nil {
		t.Fatal(err)
	}

	lines := writerDataLines(t, rec.Body.String())
	if len(lines) != 4 || lines[3] != "[DONE]" {
		t.Fatalf("data lines = %q, want three chunks then [DONE]", lines)
	}
	first, second, last := decodeWriterChunk(t, lines[0]), decodeWriterChunk(t, lines[1]), decodeWriterChunk(t, lines[2])
	for i, c := range []writerChunk{first, second, last} {
		if c.Object != "chat.completion.chunk" || c.ID == "" || c.ID != first.ID {
			t.Fatalf("chunk %d: object %q id %q; want chat.completion.chunk under one id", i, c.Object, c.ID)
		}
	}
	if first.Choices[0].Delta.Content != "Xin " || second.Choices[0].Delta.Content != "chào" {
		t.Fatalf("delta contents = %q, %q; want the text as it arrived", first.Choices[0].Delta.Content, second.Choices[0].Delta.Content)
	}
	if first.Choices[0].FinishReason != "" || first.Usage != nil {
		t.Fatalf("a delta chunk carries finish_reason %q / usage %v", first.Choices[0].FinishReason, first.Usage)
	}
	if last.Choices[0].FinishReason != "stop" || last.Usage == nil || last.Usage.TotalTokens != 5 {
		t.Fatalf("last chunk: finish_reason %q usage %+v; want stop and 5 tokens", last.Choices[0].FinishReason, last.Usage)
	}

	// A model cut at its ceiling ends with length, so the client knows the
	// text is not whole.
	rec = httptest.NewRecorder()
	s = NewUniworkDeltaStream(rec, UniworkResponseMeta{Model: "fake-1"})
	if err := s.Finish(Response{Text: "", StopReason: "max_tokens"}); err != nil {
		t.Fatal(err)
	}
	lines = writerDataLines(t, rec.Body.String())
	if len(lines) != 2 || decodeWriterChunk(t, lines[0]).Choices[0].FinishReason != "length" {
		t.Fatalf("a max_tokens finish = %q, want one chunk with finish_reason length then [DONE]", lines)
	}
}

// A failure after text went out cannot become an HTTP status any more: the
// stream ends with x_uniwork.terminal naming the code the JSON answer would
// have carried, then [DONE], so the client treats the text as partial.
func TestUniworkDeltaStreamFailAfterDeltasSendsTerminal(t *testing.T) {
	rec := httptest.NewRecorder()
	s := NewUniworkDeltaStream(rec, UniworkResponseMeta{Model: "fake-1"})
	if err := s.Delta("một phần"); err != nil {
		t.Fatal(err)
	}
	if err := s.Fail("ai_provider_error"); err != nil {
		t.Fatal(err)
	}
	lines := writerDataLines(t, rec.Body.String())
	if len(lines) != 3 || lines[2] != "[DONE]" {
		t.Fatalf("data lines = %q, want a delta, the terminal chunk, [DONE]", lines)
	}
	end := decodeWriterChunk(t, lines[1])
	if end.XUniwork == nil || end.XUniwork.Terminal == nil || end.XUniwork.Terminal.Code != "ai_provider_error" {
		t.Fatalf("terminal chunk = %s, want x_uniwork.terminal.code ai_provider_error", lines[1])
	}
	if strings.Contains(lines[1], `"finish_reason"`) {
		t.Fatalf("the terminal chunk claims a finish: %s", lines[1])
	}
}
