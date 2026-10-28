package handler

// Handler-level tests for the writer route (plan 5) over the real router, the
// real stores and the isolation world's fake provider, which streams: the
// frame opens a run with one chat turn, then a writer call continues it and
// is answered as an SSE stream of chat.completion.chunk.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

func (tn *isoTenant) uniworkFrameWritePath() string {
	return "/api/v1/office-frame/documents/" + tn.ids["frameDocument"] + "/ai/uniwork/write"
}

// uniworkWriteDocsBody is a valid docs.write_document call.
var uniworkWriteDocsBody = map[string]any{
	"kind": "docs.write_document", "lang": "vi",
	"input": map[string]any{"plan": "Báo cáo quý: tổng quan, doanh thu"},
}

// uniworkFrameRun opens the conversation and run a writer call needs, with
// one chat turn on the frame route.
func uniworkFrameRun(t *testing.T, w *isoWorld, tn *isoTenant) (conv, run string) {
	t.Helper()
	status, conv, run, out := uniworkRunTurn(t, w, tn.uniworkFramePath(), tn.ids["frameToken"], "", "", uniworkQuestion("soạn giúp tôi"))
	if status != http.StatusOK || conv == "" || run == "" {
		t.Fatalf("the opening chat turn = %d %v (conv %q, run %q)", status, out, conv, run)
	}
	return conv, run
}

// uniworkWriteCall posts one writer call and answers the response and its body.
func uniworkWriteCall(t *testing.T, w *isoWorld, tn *isoTenant, conv, run string, body any) (*http.Response, string) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+tn.uniworkFrameWritePath(), strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tn.ids["frameToken"])
	if conv != "" {
		req.Header.Set(ai.UniworkConversationHeader, conv)
	}
	if run != "" {
		req.Header.Set(ai.UniworkRunHeader, run)
	}
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, string(raw)
}

// uniworkStreamText joins the delta contents of an SSE body and answers the
// chunks it read, [DONE] excluded.
func uniworkStreamText(t *testing.T, body string) (string, []map[string]any, bool) {
	t.Helper()
	var text strings.Builder
	var chunks []map[string]any
	done := false
	for _, line := range strings.Split(body, "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok {
			continue
		}
		if data == "[DONE]" {
			done = true
			continue
		}
		var c map[string]any
		if err := json.Unmarshal([]byte(data), &c); err != nil {
			t.Fatalf("chunk %q: %v", data, err)
		}
		chunks = append(chunks, c)
		if choices, _ := c["choices"].([]any); len(choices) > 0 {
			delta, _ := choices[0].(map[string]any)["delta"].(map[string]any)
			s, _ := delta["content"].(string)
			text.WriteString(s)
		}
	}
	return text.String(), chunks, done
}

func uniworkWriterUsageRows(t *testing.T, w *isoWorld, orgID string) (n int, status string, outputTokens int) {
	t.Helper()
	if err := w.pool.QueryRow(context.Background(),
		`SELECT count(*), COALESCE(max(status), ''), COALESCE(max(output_tokens), 0) FROM ai_usage_events
		 WHERE organization_id = $1 AND capability = $2`, orgID, string(ai.CapOfficeUniworkWriter)).Scan(&n, &status, &outputTokens); err != nil {
		t.Fatal(err)
	}
	return n, status, outputTokens
}

const uniworkWriterText = "Tổng quan quý ba: doanh thu tăng đều ở cả ba miền."

func TestAIUniworkWriteRouteStreamsSSE(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	w.uniworkProvider.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: uniworkWriterText, UsagePresent: true, InputTokens: 40, OutputTokens: 12, StopReason: "end_turn"}
	}
	w.uniworkProvider.StreamChunk = 8
	conv, run := uniworkFrameRun(t, w, tn)

	res, body := uniworkWriteCall(t, w, tn, conv, run, uniworkWriteDocsBody)
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("writer call = %d %s: %s", res.StatusCode, res.Header.Get("Content-Type"), body)
	}
	if res.Header.Get(ai.UniworkConversationHeader) != conv || res.Header.Get(ai.UniworkRunHeader) != run {
		t.Fatalf("answer headers = %q/%q, want %q/%q", res.Header.Get(ai.UniworkConversationHeader), res.Header.Get(ai.UniworkRunHeader), conv, run)
	}
	text, chunks, done := uniworkStreamText(t, body)
	if text != uniworkWriterText || !done {
		t.Fatalf("streamed text %q (done %v), want %q then [DONE]", text, done, uniworkWriterText)
	}
	if len(chunks) < 3 {
		t.Fatalf("chunks = %d, want the text in several deltas plus the finish", len(chunks))
	}
	last, _ := chunks[len(chunks)-1]["choices"].([]any)
	if finish, _ := last[0].(map[string]any)["finish_reason"].(string); finish != "stop" {
		t.Fatalf("last chunk finish_reason = %q, want stop", finish)
	}
}

func TestAIUniworkWriteErrorBeforeStreamIsJSON(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, _ := uniworkFrameRun(t, w, tn)
	calls := w.uniworkProvider.Calls

	res, body := uniworkWriteCall(t, w, tn, conv, "", uniworkWriteDocsBody)
	if res.StatusCode != http.StatusBadRequest || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("writer call without a run = %d %s: %s, want 400 JSON", res.StatusCode, res.Header.Get("Content-Type"), body)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("body %q: %v", body, err)
	}
	if code := uniworkErrorCode(t, out); code != "invalid_request" {
		t.Fatalf("code = %q, want invalid_request", code)
	}
	if w.uniworkProvider.Calls != calls {
		t.Fatal("a refused writer call reached the provider")
	}
}

// The vendor breaks after the first delta: the stream ends with the terminal
// chunk instead of a finish, and the usage row is written once, for what the
// vendor produced.
func TestAIUniworkWriteProviderFailureMidStream(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	w.uniworkProvider.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: uniworkWriterText, UsagePresent: true, InputTokens: 40, OutputTokens: 12, StopReason: "end_turn"}
	}
	w.uniworkProvider.Err = &provider.StatusError{Status: http.StatusBadGateway, Err: errors.New("upstream reset")}
	w.uniworkProvider.StreamChunk = len([]rune(uniworkWriterText))

	res, body := uniworkWriteCall(t, w, tn, conv, run, uniworkWriteDocsBody)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("writer call = %d: %s, want the 200 the first delta opened", res.StatusCode, body)
	}
	text, chunks, done := uniworkStreamText(t, body)
	if text != uniworkWriterText || !done {
		t.Fatalf("streamed %q (done %v), want the one delta then [DONE]", text, done)
	}
	end, _ := chunks[len(chunks)-1]["x_uniwork"].(map[string]any)
	terminal, _ := end["terminal"].(map[string]any)
	if terminal["code"] != "ai_provider_error" {
		t.Fatalf("last chunk = %v, want x_uniwork.terminal.code ai_provider_error", chunks[len(chunks)-1])
	}
	n, status, out := uniworkWriterUsageRows(t, w, tn.orgID)
	if n != 1 || status != "failed" || out <= 0 {
		t.Fatalf("writer usage rows = %d (status %q, output_tokens %d), want one failed row carrying the tokens produced", n, status, out)
	}
}

func TestAIUniworkWriteFieldOverCapIs413(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	calls := w.uniworkProvider.Calls

	body := map[string]any{
		"kind": "docs.write_document", "lang": "vi",
		"input": map[string]any{"plan": strings.Repeat("a", 6001)},
	}
	res, raw := uniworkWriteCall(t, w, tn, conv, run, body)
	var out map[string]any
	_ = json.Unmarshal([]byte(raw), &out)
	if res.StatusCode != http.StatusRequestEntityTooLarge || uniworkErrorCode(t, out) != "payload_too_large" {
		t.Fatalf("a plan over its cap = %d %s, want 413 payload_too_large", res.StatusCode, raw)
	}
	if w.uniworkProvider.Calls != calls {
		t.Fatal("a field over its cap reached the provider")
	}
}
