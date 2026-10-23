package handler

// W-C's handler-level tests for G6-03b: the run id on the wire (A3/A12), the
// step/limit of x_uniwork at step 0 (BE3A-11) and the Retry-After of a busy
// refusal (BE3A-20). The wire test builds one tenant on the isolation server
// and therefore skips without TEST_DATABASE_URL, like the rest of the suite;
// the other three touch no database.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// uniworkRunTurn posts one turn with the run header the client sends on every
// later turn, and answers the status plus the conversation and the run the
// answer named (both empty when the answer named none).
func uniworkRunTurn(t *testing.T, w *isoWorld, path, token, conversationID, runID string, body any) (int, string, string, map[string]any) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+path, strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if conversationID != "" {
		req.Header.Set(ai.UniworkConversationHeader, conversationID)
	}
	if runID != "" {
		req.Header.Set(ai.UniworkRunHeader, runID)
	}
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, res.Header.Get(ai.UniworkConversationHeader), res.Header.Get(ai.UniworkRunHeader), out
}

// Every answer of a run names the run (A3, G6-03b §2), and the conversation
// with it (A12); a refusal that precedes the run names none, so a client
// never reads an empty header as "the run ended" (Q6).
func TestAIUniworkRunHeaderNamesTheRun(t *testing.T) {
	for _, tc := range []struct {
		name     string
		turn     service.UniworkTurn
		wantConv string
		wantRun  string
	}{
		{"a live turn", service.UniworkTurn{ConversationID: "conv-1", RunID: "run-1"}, "conv-1", "run-1"},
		{"a refusal after the conversation exists", service.UniworkTurn{ConversationID: "conv-1"}, "conv-1", ""},
		{"a refusal before either exists", service.UniworkTurn{}, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			uniworkAnswerHeaders(rec, tc.turn)
			if got := rec.Header().Get(ai.UniworkConversationHeader); got != tc.wantConv {
				t.Fatalf("conversation header = %q, want %q", got, tc.wantConv)
			}
			if got := rec.Header().Get(ai.UniworkRunHeader); got != tc.wantRun {
				t.Fatalf("run header = %q, want %q", got, tc.wantRun)
			}
		})
	}
}

// The run header's wire name is A12: the CORS list and the frame client both
// spell it from this constant, so a rename has to be a deliberate one.
func TestAIUniworkRunHeaderWireName(t *testing.T) {
	if ai.UniworkRunHeader != "X-UniWork-AI-Run" {
		t.Fatalf("run header = %q, want X-UniWork-AI-Run (A12)", ai.UniworkRunHeader)
	}
	if ai.UniworkConversationHeader == ai.UniworkRunHeader {
		t.Fatal("the run header must not be the conversation header")
	}
}

// BE3A-11: x_uniwork carries step and limit on every answer, JSON and SSE
// alike, and step 0 — the question turn of a run — is a value like any other,
// not an omitted field.
func TestAIUniworkStepLimitInJSONAndSSE(t *testing.T) {
	resp := ai.Response{Text: "trả lời", Model: "fake-1"}

	body := ai.NewUniworkChatCompletion(resp, ai.UniworkResponseMeta{
		ConversationID: "conv-1", Model: "fake-1", Step: 0, Limit: 8, Now: time.Now(),
	})
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	assertUniworkStepLimit(t, raw, 0, 8, "the JSON body")

	rec := httptest.NewRecorder()
	if err := ai.WriteUniworkSSE(rec, resp, ai.UniworkResponseMeta{
		ConversationID: "conv-1", Model: "fake-1", Step: 3, Limit: 8, Now: time.Now(),
	}); err != nil {
		t.Fatalf("write the SSE answer: %v", err)
	}
	chunk := ""
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		if after, ok := strings.CutPrefix(line, "data: "); ok && after != "[DONE]" {
			chunk = after
		}
	}
	if chunk == "" {
		t.Fatalf("the SSE answer carries no chunk:\n%s", rec.Body.String())
	}
	assertUniworkStepLimit(t, []byte(chunk), 3, 8, "the SSE chunk")

	// The first turn of a run over SSE: step 0 is emitted there too.
	rec = httptest.NewRecorder()
	if err := ai.WriteUniworkSSE(rec, resp, ai.UniworkResponseMeta{
		ConversationID: "conv-1", Model: "fake-1", Step: 0, Limit: 8, Now: time.Now(),
	}); err != nil {
		t.Fatalf("write the first SSE answer: %v", err)
	}
	if !strings.Contains(rec.Body.String(), `"step":0`) {
		t.Fatalf("the SSE answer of the question turn omits step 0:\n%s", rec.Body.String())
	}
}

// assertUniworkStepLimit reads x_uniwork out of a completion body and pins
// both numbers to what the handler handed the façade.
func assertUniworkStepLimit(t *testing.T, raw []byte, step, limit int, what string) {
	t.Helper()
	var out struct {
		XUniwork struct {
			Step  *int `json:"step"`
			Limit *int `json:"limit"`
		} `json:"x_uniwork"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if out.XUniwork.Step == nil || *out.XUniwork.Step != step {
		t.Fatalf("%s: x_uniwork.step = %v, want %d", what, out.XUniwork.Step, step)
	}
	if out.XUniwork.Limit == nil || *out.XUniwork.Limit != limit {
		t.Fatalf("%s: x_uniwork.limit = %v, want %d", what, out.XUniwork.Limit, limit)
	}
}

// BE3A-20: the concurrency refusal reaches the client as 429 ai_uniwork_busy
// with Retry-After: 5, set by the handler from the field the service puts on
// the refusal (A11) — so the code and the header can never disagree.
func TestAIUniworkBusySetsRetryAfter(t *testing.T) {
	h := &handlers{}
	rec := httptest.NewRecorder()
	h.uniworkError(rec, context.Background(), service.CodedError{
		Code: "ai_uniwork_busy", Status: http.StatusTooManyRequests,
		Msg:    "UniWork AI đang xử lý quá nhiều lượt",
		Fields: map[string]any{"retry_after": service.UniworkBusyRetryAfter},
	})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if retry := rec.Header().Get("Retry-After"); retry != "5" {
		t.Fatalf("Retry-After = %q, want 5 (A11)", retry)
	}
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Error.Code != "ai_uniwork_busy" {
		t.Fatalf("code = %q, want ai_uniwork_busy", body.Error.Code)
	}
}

// The run id is the server's: an id that is not this conversation's — unknown,
// another conversation's, another tenant's, or swept — is refused 409
// run_expired, never accepted as a new run and never answered with someone
// else's transcript (G6-03b §2.2 rule 3, A3). The service half of this test
// is TestAIUniworkRunRejectsForeignRunID there.
func TestAIUniworkRunRejectsForeignRunID(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	path := tn.uniworkOrgPath()

	status, conv, run, out := uniworkRunTurn(t, w, path, tn.token, "", "", uniworkQuestion("một"))
	if status != http.StatusOK || conv == "" || run == "" {
		t.Fatalf("first turn: %d conv=%q run=%q %v; want 200 with both ids", status, conv, run, out)
	}

	status, _, _, out = uniworkRunTurn(t, w, path, tn.token, conv, "01J8X4WS0N1P2Q3R4S5T6U7V8", uniworkQuestion("hai"))
	if status != http.StatusConflict || uniworkErrorCode(t, out) != "run_expired" {
		t.Fatalf("an unknown run id on a live conversation: %d %v; want 409 run_expired", status, out)
	}

	// The same run id on another conversation is refused too, and the refusal
	// leaks nothing: it is the same code.
	status, otherConv, _, out := uniworkRunTurn(t, w, path, tn.token, "", "", uniworkQuestion("ba"))
	if status != http.StatusOK || otherConv == "" {
		t.Fatalf("second conversation: %d %v; want 200", status, out)
	}
	status, _, _, out = uniworkRunTurn(t, w, path, tn.token, otherConv, run, uniworkQuestion("bốn"))
	if status != http.StatusConflict || uniworkErrorCode(t, out) != "run_expired" {
		t.Fatalf("another conversation's run id: %d %v; want 409 run_expired", status, out)
	}
}

// The G7-12 official session's 409 (2026-10-16), reproduced end to end: a
// model that answers with a tool call on every turn spends the eight tool
// rounds of A3, and the ninth tool round — the run's tenth model call — is
// refused 409 run_limit_reached with fields.limit = tool_rounds. The run is
// still there, so the refusal answers as that run: it names the conversation
// and the run (A12, design §2.1), and the turn that was refused spent
// nothing — the next question opens a new run in the same conversation
// (design §4.3), which is what the session's runner did 20 ms later.
func TestAIUniworkRunToolRoundCapRefusesTheNinthRound(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	// The same call on every turn, so its answer can be handed back: the
	// session's runner (holdout-run.mjs) walks exactly this way.
	w.uniworkProvider.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "", ToolCalls: []provider.ToolCall{
			{ID: "call_cap_1", Name: "read_cells", Input: json.RawMessage(`{"range":"A1"}`)},
		}}
	}
	readCells := []any{map[string]any{
		"type":     "function",
		"function": map[string]any{"name": "read_cells", "description": "read_cells", "parameters": map[string]any{"type": "object"}},
	}}
	// A tool-result turn still offers the module's tool (the runner sends its
	// tools on every call), so the call the model answers with is kept and the
	// next turn can answer that one.
	toolTurn := func(content string) map[string]any {
		body := uniworkToolResult("sheets", "call_cap_1", content)
		body["tools"] = readCells
		return body
	}

	path := tn.uniworkOrgPath()
	status, conv, run, out := uniworkRunTurn(t, w, path, tn.token, "", "",
		uniworkModuleQuestion("đọc ô A1", "sheets", "read_cells"))
	if status != http.StatusOK || conv == "" || run == "" {
		t.Fatalf("question turn: %d conv=%q run=%q %v; want 200 with both ids", status, conv, run, out)
	}
	for round := 1; round <= ai.UniworkRunToolRoundMax; round++ {
		status, _, named, out := uniworkRunTurn(t, w, path, tn.token, conv, run, toolTurn("42"))
		if status != http.StatusOK {
			t.Fatalf("tool round %d: %d %v; want 200", round, status, out)
		}
		if named != run {
			t.Fatalf("tool round %d named run %q, want %q", round, named, run)
		}
	}

	status, namedConv, namedRun, out := uniworkRunTurn(t, w, path, tn.token, conv, run, toolTurn("42"))
	if status != http.StatusConflict || uniworkErrorCode(t, out) != "run_limit_reached" {
		t.Fatalf("the ninth tool round: %d %v; want 409 run_limit_reached (A3)", status, out)
	}
	if fields, _ := out["error"].(map[string]any)["fields"].(map[string]any); fields["limit"] != ai.UniworkRunLimitToolRounds {
		t.Fatalf("fields.limit = %v; want %q (D-3, §2.3)", fields["limit"], ai.UniworkRunLimitToolRounds)
	}
	if namedConv != conv || namedRun != run {
		t.Fatalf("the refusal named conv=%q run=%q; want the live conversation %q and the refused run %q (A12)",
			namedConv, namedRun, conv, run)
	}

	status, sameConv, nextRun, out := uniworkRunTurn(t, w, path, tn.token, conv, "", uniworkModuleQuestion("đọc ô B2", "sheets", "read_cells"))
	if status != http.StatusOK || sameConv != conv || nextRun == "" || nextRun == run {
		t.Fatalf("the next question: %d conv=%q run=%q %v; want a new run in %q (design §4.3)", status, sameConv, nextRun, out, conv)
	}
}
