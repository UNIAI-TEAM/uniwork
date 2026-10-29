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
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

// uniworkWriterBill is the writer's usage rows and what the ai.tokens meter
// recorded against them.
type uniworkWriterBill struct {
	rows         int
	status       string
	outputTokens int
	costMicros   int64
	meterEvents  int
	charged      int64
}

func uniworkWriterBilling(t *testing.T, w *isoWorld, orgID string) uniworkWriterBill {
	t.Helper()
	ctx := context.Background()
	var b uniworkWriterBill
	if err := w.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(max(status), ''), COALESCE(max(output_tokens), 0), COALESCE(sum(cost_micros), 0)::bigint
		 FROM ai_usage_events WHERE organization_id = $1 AND capability = $2`,
		orgID, string(ai.CapOfficeUniworkWriter)).Scan(&b.rows, &b.status, &b.outputTokens, &b.costMicros); err != nil {
		t.Fatal(err)
	}
	if err := w.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(sum(delta), 0)::bigint FROM usage_events
		 WHERE organization_id = $1 AND ref_id IN (SELECT id FROM ai_usage_events WHERE organization_id = $1 AND capability = $2)`,
		orgID, string(ai.CapOfficeUniworkWriter)).Scan(&b.meterEvents, &b.charged); err != nil {
		t.Fatal(err)
	}
	return b
}

func uniworkRunCredits(t *testing.T, w *isoWorld, runID string) int64 {
	t.Helper()
	var credits int64
	if err := w.pool.QueryRow(context.Background(),
		`SELECT credits FROM ai_uniwork_runs WHERE id = $1`, runID).Scan(&credits); err != nil {
		t.Fatal(err)
	}
	return credits
}

// uniworkWriterTerminal is the code of the stream's last chunk, "" when it
// carries none.
func uniworkWriterTerminal(chunks []map[string]any) string {
	if len(chunks) == 0 {
		return ""
	}
	end, _ := chunks[len(chunks)-1]["x_uniwork"].(map[string]any)
	terminal, _ := end["terminal"].(map[string]any)
	code, _ := terminal["code"].(string)
	return code
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
// vendor produced. A vendor failure stays unbilled, as on every streamed
// route (ruling R4): cost 0, no meter charge, the run's credits untouched.
func TestAIUniworkWriteProviderFailureMidStream(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	credits := uniworkRunCredits(t, w, run)
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
	if code := uniworkWriterTerminal(chunks); code != "ai_provider_error" {
		t.Fatalf("last chunk = %v, want x_uniwork.terminal.code ai_provider_error", chunks[len(chunks)-1])
	}
	bill := uniworkWriterBilling(t, w, tn.orgID)
	if bill.rows != 1 || bill.status != "failed" || bill.outputTokens <= 0 {
		t.Fatalf("writer usage = %+v, want one failed row carrying the tokens produced", bill)
	}
	if bill.costMicros != 0 || bill.meterEvents != 0 {
		t.Fatalf("writer usage = %+v, want a vendor failure unpriced and uncharged", bill)
	}
	if got := uniworkRunCredits(t, w, run); got != credits {
		t.Fatalf("run credits %d -> %d, want a vendor failure to add nothing", credits, got)
	}
}

// The call runs out of time after text went out (ruling R5): the stream ends
// with the terminal chunk, the Gateway prices and charges the partial once,
// and the run's credits grow by exactly what the meter charged.
func TestAIUniworkWriteTimeoutAfterDeltasChargesTheRunOnce(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	credits := uniworkRunCredits(t, w, run)
	w.uniworkProvider.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: uniworkWriterText, UsagePresent: true, InputTokens: 40, OutputTokens: 12, StopReason: "end_turn"}
	}
	w.uniworkProvider.Err = context.DeadlineExceeded
	w.uniworkProvider.StreamChunk = 8

	res, body := uniworkWriteCall(t, w, tn, conv, run, uniworkWriteDocsBody)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("writer call = %d: %s, want the 200 the first delta opened", res.StatusCode, body)
	}
	text, chunks, done := uniworkStreamText(t, body)
	if text != uniworkWriterText || !done {
		t.Fatalf("streamed %q (done %v), want the deltas then [DONE]", text, done)
	}
	if code := uniworkWriterTerminal(chunks); code != "ai_provider_timeout" {
		t.Fatalf("last chunk = %v, want x_uniwork.terminal.code ai_provider_timeout", chunks[len(chunks)-1])
	}
	bill := uniworkWriterBilling(t, w, tn.orgID)
	if bill.rows != 1 || bill.status != "cancelled" || bill.meterEvents != 1 || bill.charged != 52 {
		t.Fatalf("writer usage = %+v, want one cancelled row charged once for 40+12 tokens", bill)
	}
	if got := uniworkRunCredits(t, w, run); got-credits != bill.charged {
		t.Fatalf("run credits %d -> %d, want +%d (what the meter charged)", credits, got, bill.charged)
	}
}

// writerDeadClient takes the first write and fails every later one, the way a
// connection does once the client stopped reading, while the request's own
// context stays alive.
type writerDeadClient struct {
	header http.Header
	writes int
}

func (s *writerDeadClient) Header() http.Header { return s.header }
func (s *writerDeadClient) WriteHeader(int)     {}
func (s *writerDeadClient) Write(p []byte) (int, error) {
	s.writes++
	if s.writes > 1 {
		return 0, errors.New("client stopped reading")
	}
	return len(p), nil
}

// A failed write stops the model (minor 1): the writer slot is not held while
// the vendor keeps generating for nobody. The Gateway settles the call as
// cancelled and the run carries what the meter charged.
func TestAIUniworkWriteStopsWhenTheClientStopsReading(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	credits := uniworkRunCredits(t, w, run)
	w.uniworkProvider.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: strings.Repeat(uniworkWriterText, 4), UsagePresent: true, InputTokens: 40, OutputTokens: 48, StopReason: "end_turn"}
	}
	w.uniworkProvider.StreamChunk = 8
	w.uniworkProvider.StreamDelay = 10 * time.Millisecond

	payload, _ := json.Marshal(uniworkWriteDocsBody)
	req := httptest.NewRequest(http.MethodPost, tn.uniworkFrameWritePath(), strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tn.ids["frameToken"])
	req.Header.Set(ai.UniworkConversationHeader, conv)
	req.Header.Set(ai.UniworkRunHeader, run)
	w.srv.Config.Handler.ServeHTTP(&writerDeadClient{header: http.Header{}}, req)

	bill := uniworkWriterBilling(t, w, tn.orgID)
	if bill.rows != 1 || bill.status != "cancelled" || bill.meterEvents != 1 {
		t.Fatalf("writer usage = %+v, want one cancelled row charged once (the model stopped)", bill)
	}
	if got := uniworkRunCredits(t, w, run); got-credits != bill.charged {
		t.Fatalf("run credits %d -> %d, want +%d (what the meter charged)", credits, got, bill.charged)
	}
}

// A writer call refused at the run's cap is an answer of that run: the 409
// run_limit_reached JSON names the run and the conversation, so the frame
// knows which run ended (A12).
func TestAIUniworkWriteRunLimitNamesTheRun(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	conv, run := uniworkFrameRun(t, w, tn)
	if _, err := w.pool.Exec(context.Background(), `UPDATE ai_uniwork_runs SET model_calls = 9 WHERE id = $1`, run); err != nil {
		t.Fatal(err)
	}
	calls := w.uniworkProvider.Calls

	res, raw := uniworkWriteCall(t, w, tn, conv, run, uniworkWriteDocsBody)
	var out map[string]any
	_ = json.Unmarshal([]byte(raw), &out)
	if res.StatusCode != http.StatusConflict || uniworkErrorCode(t, out) != "run_limit_reached" {
		t.Fatalf("a writer call at nine model calls = %d %s, want 409 run_limit_reached", res.StatusCode, raw)
	}
	if res.Header.Get(ai.UniworkRunHeader) != run || res.Header.Get(ai.UniworkConversationHeader) != conv {
		t.Fatalf("answer headers = %q/%q, want the refused run %q/%q", res.Header.Get(ai.UniworkRunHeader), res.Header.Get(ai.UniworkConversationHeader), run, conv)
	}
	if w.uniworkProvider.Calls != calls {
		t.Fatal("a writer call at the cap reached the provider")
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
