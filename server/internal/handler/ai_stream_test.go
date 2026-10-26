package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// sseFrame is one parsed frame; a comment frame (": ping") has no event.
type sseFrame struct {
	event, data, comment string
	at                   time.Time
}

// readSSE parses the body into frames as they arrive and closes the channel at EOF.
func readSSE(body io.Reader) <-chan sseFrame {
	out := make(chan sseFrame, 256)
	go func() {
		defer close(out)
		sc := bufio.NewScanner(body)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		var f sseFrame
		for sc.Scan() {
			line := sc.Text()
			switch {
			case line == "":
				if f.event != "" || f.comment != "" {
					f.at = time.Now()
					out <- f
				}
				f = sseFrame{}
			case strings.HasPrefix(line, ": "):
				f.comment = strings.TrimPrefix(line, ": ")
			case strings.HasPrefix(line, "event: "):
				f.event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				f.data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return out
}

func postStream(t *testing.T, srv *httptest.Server, wsID, token string, body any) *http.Response {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/workspaces/"+wsID+"/ai/ask/stream", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func collectFrames(ch <-chan sseFrame) []sseFrame {
	var all []sseFrame
	for f := range ch {
		all = append(all, f)
	}
	return all
}

func eventsOf(frames []sseFrame) []string {
	var names []string
	for _, f := range frames {
		if f.event != "" {
			names = append(names, f.event)
		}
	}
	return names
}

func TestAskUniStreamWritesEventsInOrder(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply, StreamChunk: 4})
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi"})
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("status %d type %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	if res.Header.Get("X-Accel-Buffering") != "no" || res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("headers %v", res.Header)
	}
	frames := collectFrames(readSSE(res.Body))
	// The first answer of a conversation is named: a title frame follows done.
	names := eventsOf(frames)
	if n := len(names); n > 0 && names[n-1] == "title" {
		names = names[:n-1]
	}
	if len(names) < 4 || names[0] != "run" || names[len(names)-1] != "done" || names[len(names)-2] != "citations" {
		t.Fatalf("events %v", names)
	}
	var run struct {
		ConversationID string `json:"conversation_id"`
	}
	var done struct {
		Message struct{ ID string }
		Usage   map[string]int
	}
	for _, f := range frames {
		switch f.event {
		case "run":
			_ = json.Unmarshal([]byte(f.data), &run)
		case "done":
			_ = json.Unmarshal([]byte(f.data), &done)
		}
	}
	if run.ConversationID == "" || done.Message.ID == "" {
		t.Fatalf("run %+v done %+v", run, done)
	}
	if _, ok := done.Usage["cache_write_tokens"]; !ok {
		t.Fatalf("usage %v", done.Usage)
	}
}

// The first frame must reach the client while the model is still writing.
func TestAskUniStreamFlushesBeforeTheRunEnds(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply, StreamChunk: 2, StreamDelay: 100 * time.Millisecond})
	start := time.Now()
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi"})
	ch := readSSE(res.Body)
	first := <-ch
	firstAt := time.Since(start)
	frames := append([]sseFrame{first}, collectFrames(ch)...)
	total := time.Since(start)
	if first.event != "run" {
		t.Fatalf("first frame %+v", first)
	}
	if total < 300*time.Millisecond || firstAt > total/2 {
		t.Fatalf("run frame at %v of %v: the stream was buffered (%d frames)", firstAt, total, len(frames))
	}
}

func TestAskUniStreamRefusesBeforeStreaming(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply})
	outsider, _ := signUp(t, srv, "askstream-outsider@example.com", "Outsider")
	body := map[string]any{"question": "task nào quá hạn?"}

	legacy, legacyOut := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", outsider, body)
	res := postStream(t, srv, wsID, outsider, body)
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != legacy.StatusCode || errorCodeOf(out) != errorCodeOf(legacyOut) || strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("outsider stream %d %v, legacy %d %v", res.StatusCode, out, legacy.StatusCode, legacyOut)
	}

	if _, err := testPool.Exec(context.Background(), `UPDATE subscriptions SET overrides = '{"ai.tokens": 0}'::jsonb WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'askmodels')`); err != nil {
		t.Fatal(err)
	}
	legacy, legacyOut = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, body)
	res = postStream(t, srv, wsID, owner, body)
	out = nil
	_ = json.NewDecoder(res.Body).Decode(&out)
	if legacy.StatusCode < 400 || res.StatusCode != legacy.StatusCode || errorCodeOf(out) != errorCodeOf(legacyOut) {
		t.Fatalf("quota exhausted: stream %d %v, legacy %d %v", res.StatusCode, out, legacy.StatusCode, legacyOut)
	}
	if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatal("a refusal must be JSON")
	}
}

// gateProvider holds every call until open is closed, counting the calls in.
type gateProvider struct {
	open    chan struct{}
	entered atomic.Int32
}

func (g *gateProvider) Name() string { return "fake" }
func (g *gateProvider) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	g.entered.Add(1)
	select {
	case <-g.open:
	case <-ctx.Done():
		return provider.CompletionResponse{}, ctx.Err()
	}
	return provider.CompletionResponse{Text: "xong", Model: req.Model, UsagePresent: true, StopReason: "end_turn"}, nil
}
func (g *gateProvider) Embed(context.Context, provider.EmbedRequest) (provider.EmbedResponse, error) {
	return provider.EmbedResponse{}, provider.ErrUnsupported
}

func TestAskUniStreamBusyAnswersJSONWithRetryAfter(t *testing.T) {
	gate := &gateProvider{open: make(chan struct{})}
	srv, owner, _, wsID := askWorldWith(t, gate)
	var wg sync.WaitGroup
	const held = 8 // the per-organization run cap
	for i := 0; i < held; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?"})
			collectFrames(readSSE(res.Body))
		}()
	}
	deadline := time.Now().Add(10 * time.Second)
	for gate.entered.Load() < held && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?"})
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	close(gate.open)
	wg.Wait()
	wantError(t, "busy", res, out, http.StatusTooManyRequests, "ai_rate_limited")
	if res.Header.Get("Retry-After") == "" || strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("headers %v", res.Header)
	}
}

func TestAskUniStreamErrorAfterStartIsAnEvent(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Err: errors.New("vendor down")})
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?"})
	frames := collectFrames(readSSE(res.Body))
	names := eventsOf(frames)
	if res.StatusCode != 200 || len(names) < 2 || names[0] != "run" || names[len(names)-1] != "error" {
		t.Fatalf("status %d events %v", res.StatusCode, names)
	}
	if got := frames[len(frames)-1].data; got != `{"code":"ai_provider_error"}` {
		t.Fatalf("error data %q", got)
	}
}

func TestAskUniStreamSendsHeartbeats(t *testing.T) {
	old := sseHeartbeat
	sseHeartbeat = 20 * time.Millisecond
	t.Cleanup(func() { sseHeartbeat = old })
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply, StreamChunk: 2, StreamDelay: 100 * time.Millisecond})
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?"})
	pings := 0
	for _, f := range collectFrames(readSSE(res.Body)) {
		if f.comment == "ping" {
			pings++
		}
	}
	if pings == 0 {
		t.Fatal("no ping frame while the model was silent")
	}
}

// failWriter is a ResponseWriter whose writes fail after the header.
type failWriter struct {
	hdr       http.Header
	flushErr  error
	writeErr  error
	wroteHead bool
}

func (f *failWriter) Header() http.Header { return f.hdr }
func (f *failWriter) WriteHeader(int)     { f.wroteHead = true }
func (f *failWriter) Write(p []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	return len(p), nil
}
func (f *failWriter) FlushError() error { return f.flushErr }

// A write or flush failure marks the writer dead and signals the run to
// stop; an unflushable writer alone does not.
func TestSSEWriterDeadWriterCancelsTheRun(t *testing.T) {
	for name, tc := range map[string]struct {
		w    *failWriter
		dead bool
	}{
		"write error": {&failWriter{hdr: http.Header{}, writeErr: errors.New("broken pipe")}, true},
		"flush error": {&failWriter{hdr: http.Header{}, flushErr: errors.New("broken pipe")}, true},
		"no flusher":  {&failWriter{hdr: http.Header{}, flushErr: http.ErrNotSupported}, false},
	} {
		t.Run(name, func(t *testing.T) {
			sw := newSSEWriter(tc.w)
			called := 0
			sw.onDead = func() { called++ }
			sw.event("delta", map[string]string{"text": "x"})
			sw.event("delta", map[string]string{"text": "y"})
			sw.close()
			if (called == 1) != tc.dead || called > 1 {
				t.Fatalf("onDead called %d times, dead want %v", called, tc.dead)
			}
		})
	}
}

// A client that leaves mid-stream ends the run as a stop: the turn is stored
// with notice stopped. The test waits on a frame, then on the store.
func TestAskUniStreamClientLeavingStoresAStoppedTurn(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply, StreamChunk: 2, StreamDelay: 200 * time.Millisecond})
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi"})
	ch := readSSE(res.Body)
	for f := range ch {
		if f.event == "delta" {
			break
		}
	}
	res.Body.Close()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var n int
		if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM ai_messages WHERE notice = 'stopped'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the turn was not stored as stopped after the client left")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// The stream's error code is the one mapServiceError answers with.
func TestAskUniStreamErrorCodeMatchesMapServiceError(t *testing.T) {
	h := &handlers{Deps: Deps{Log: slog.Default()}}
	for _, err := range []error{
		ai.ErrProviderError, ai.ErrQuotaExceeded, service.ErrRateLimited, service.ErrForbidden,
		service.ErrNotFound, service.ErrConflict, service.Invalid("x"), errors.New("boom"),
	} {
		rec := httptest.NewRecorder()
		h.mapServiceError(rec, err)
		var body struct {
			Error struct{ Code string } `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if got := h.askErrorCode(err); got != body.Error.Code {
			t.Errorf("%v: stream code %q, JSON code %q", err, got, body.Error.Code)
		}
	}
}

// A cancelled run (Stop, shutdown) keeps its code but logs no unexpected error.
func TestAskUniStreamCancelledRunLogsNothing(t *testing.T) {
	var buf bytes.Buffer
	h := &handlers{Deps: Deps{Log: slog.New(slog.NewTextHandler(&buf, nil))}}
	h.askErrorCode(context.Canceled)
	if buf.Len() != 0 {
		t.Fatalf("logged %q for a cancelled run", buf.String())
	}
	h.askErrorCode(errors.New("boom"))
	if buf.Len() == 0 {
		t.Fatal("a real failure must still log")
	}
}

func TestAskUniStreamWritesSourcesAndStepLabel(t *testing.T) {
	fake := &provider.Fake{}
	n := 0
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if n++; n <= 2 { // a search that finds nothing, then the members
			call := provider.ToolCall{ID: "c1", Name: "search", Input: json.RawMessage(`{"query":"owner"}`)}
			if n == 2 {
				call = provider.ToolCall{ID: "c2", Name: "list_members", Input: json.RawMessage(`{"query":""}`)}
			}
			return provider.CompletionResponse{UsagePresent: true, InputTokens: 5, StopReason: "tool_use", ToolCalls: []provider.ToolCall{call}}
		}
		return provider.CompletionResponse{Text: "Xong", UsagePresent: true, InputTokens: 5, StopReason: "end_turn"}
	}
	srv, owner, _, wsID := askWorld(t, fake)
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "ai trong nhóm?", "locale": "vi"})
	frames := collectFrames(readSSE(res.Body))
	var step, sources, done string
	stepAt, sourcesAt := -1, -1
	for i, f := range frames {
		switch f.event {
		case "step":
			if step == "" {
				step = f.data
			}
			stepAt = i
		case "sources":
			sources, sourcesAt = f.data, i
		case "done":
			done = f.data
		}
	}
	if !strings.Contains(step, `"label":"owner"`) {
		t.Fatalf("step %s", step)
	}
	if stepAt < 0 || sourcesAt < stepAt || !strings.Contains(sources, `"object_id"`) {
		t.Fatalf("events %v\nsources %s", eventsOf(frames), sources)
	}
	if !strings.Contains(done, `"steps":[{"tool":"search","label":"owner"`) {
		t.Fatalf("done %s", done)
	}
}

// A reasoning delta is its own frame, and a step names the model's note.
func TestWriteAskEventSendsReasoningAndTheStepNote(t *testing.T) {
	rec := httptest.NewRecorder()
	sw := newSSEWriter(rec)
	writeAskEvent(sw, service.AskEvent{Name: "reasoning", Delta: "Cần xem."})
	writeAskEvent(sw, service.AskEvent{Name: "step", Step: &service.AskStepEvent{Round: 1, Phase: "tool", Tool: "search", Note: "Mình tìm."}})
	sw.close()
	body := rec.Body.String()
	if !strings.Contains(body, "event: reasoning\ndata: {\"text\":\"Cần xem.\"}\n\n") || !strings.Contains(body, `"note":"Mình tìm."`) {
		t.Fatalf("frames:\n%s", body)
	}
}

// A stored step keeps the model's note, its thought and its kind.
func TestToAiMessageDTOStepsKeepNoteThoughtAndKind(t *testing.T) {
	out := toAiMessageDTO(db.AiMessage{Citations: "[]", Steps: `[{"tool":"search","label":"x","counts":{},"note":"Mình tìm.","thought":"Cần xem."},{"tool":"","label":"","counts":{},"kind":"think","thought":"Đủ rồi."}]`})
	want := []sdo.AiStepDTO{
		{Tool: "search", Label: "x", Counts: map[string]int{}, Note: "Mình tìm.", Thought: "Cần xem."},
		{Counts: map[string]int{}, Kind: "think", Thought: "Đủ rồi."},
	}
	if !reflect.DeepEqual(out.Steps, want) {
		t.Fatalf("steps %+v, want %+v", out.Steps, want)
	}
}

func TestToAiMessageDTOBadStepsJSONIsEmpty(t *testing.T) {
	m := db.AiMessage{Steps: `[{"tool":"search"},{"tool":5}]`, Followups: `["a",5]`, Mentions: `[{"kind":"x"},{"kind":5}]`, Citations: "[]", FileNotes: `[{"name":5}]`}
	out := toAiMessageDTO(m)
	if out.Steps == nil || len(out.Steps) != 0 || out.Followups == nil || len(out.Followups) != 0 || out.Mentions == nil || len(out.Mentions) != 0 || out.Focus != nil ||
		out.FileNotes == nil || len(out.FileNotes) != 0 {
		t.Fatalf("%+v", out)
	}
}

// An answer's file notes reach the API as stored; a message without any (or a
// row from before the column) lists none.
func TestToAiMessageDTOFileNotes(t *testing.T) {
	out := toAiMessageDTO(db.AiMessage{Citations: "[]", FileNotes: `[{"name":"bao-cao.pdf","unit":"page","read":15,"total":80}]`})
	if want := []sdo.AiFileNoteDTO{{Name: "bao-cao.pdf", Unit: "page", Read: 15, Total: 80}}; !slices.Equal(out.FileNotes, want) {
		t.Fatalf("file notes %+v, want %+v", out.FileNotes, want)
	}
	if out := toAiMessageDTO(db.AiMessage{Citations: "[]"}); out.FileNotes == nil || len(out.FileNotes) != 0 {
		t.Fatalf("no notes: %+v, want []", out.FileNotes)
	}
}

// memory_ids reach the API as stored; a row from before the column lists none.
func TestMemoryIDsInTheMessageDTOAndTheStream(t *testing.T) {
	if out := toAiMessageDTO(db.AiMessage{Citations: "[]", MemoryIds: `["e1","e2"]`}); !slices.Equal(out.MemoryIDs, []string{"e1", "e2"}) {
		t.Fatalf("memory ids %v", out.MemoryIDs)
	}
	if out := toAiMessageDTO(db.AiMessage{Citations: "[]"}); out.MemoryIDs == nil || len(out.MemoryIDs) != 0 {
		t.Fatalf("no ids: %v, want []", out.MemoryIDs)
	}
	rec := httptest.NewRecorder()
	sw := newSSEWriter(rec)
	writeAskEvent(sw, service.AskEvent{Name: "memory_used", MemoryIDs: []string{"e1"}})
	sw.close()
	if !strings.Contains(rec.Body.String(), "event: memory_used\ndata: {\"memory_ids\":[\"e1\"]}\n\n") {
		t.Fatalf("frames:\n%s", rec.Body.String())
	}
}

// memory_proposals is always a list in the message DTO, and the frame carries
// each row in the DTO's shape.
func TestMemoryProposalsInTheMessageDTOAndTheStream(t *testing.T) {
	if out := toAiMessageDTO(db.AiMessage{Citations: "[]"}); out.MemoryProposals == nil || len(out.MemoryProposals) != 0 {
		t.Fatalf("memory proposals %v, want []", out.MemoryProposals)
	}
	rec := httptest.NewRecorder()
	sw := newSSEWriter(rec)
	writeAskEvent(sw, service.AskEvent{Name: "memory_proposals", MemoryProposals: []service.AskMemoryProposal{{
		ID: "p1", MessageID: "m1", Position: 1, Action: "remember", Kind: "fact", Text: "Tôi ở Hà Nội", Status: "pending",
		ExpiresAt: time.Date(2026, 10, 26, 8, 0, 0, 0, time.UTC),
	}}})
	sw.close()
	want := `event: memory_proposals` + "\n" + `data: {"memory_proposals":[{"id":"p1","message_id":"m1","position":1,"action":"remember","memory_id":"","kind":"fact","text":"Tôi ở Hà Nội","before_kind":"","before_text":"","status":"pending","expires_at":"2026-10-26T08:00:00Z"}]}` + "\n\n"
	if !strings.Contains(rec.Body.String(), want) {
		t.Fatalf("frames:\n%s", rec.Body.String())
	}
}

// The stream route asks as the dock: the answer's follow-up block becomes a
// followups frame right before done. The JSON route never does.
func TestAskUniStreamWritesFollowupsBeforeDone(t *testing.T) {
	answer := "Xong.\n<followups>\n- Việc nào trễ?\n</followups>"
	fake := &provider.Fake{StreamChunk: 4, Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: answer, UsagePresent: true, InputTokens: 5, StopReason: "end_turn"}
	}}
	srv, owner, _, wsID := askWorld(t, fake)
	frames := collectFrames(readSSE(postStream(t, srv, wsID, owner, map[string]any{"question": "việc nào trễ?", "locale": "vi"}).Body))
	names := eventsOf(frames)
	at := slices.Index(names, "followups")
	if at < 0 || at != len(names)-3 || names[len(names)-2] != "done" || names[len(names)-1] != "title" {
		t.Fatalf("events %v", names)
	}
	var deltas strings.Builder
	for _, f := range frames {
		switch f.event {
		case "followups":
			if f.data != `{"followups":["Việc nào trễ?"]}` {
				t.Fatalf("followups %s", f.data)
			}
		case "delta":
			deltas.WriteString(f.data)
		case "done":
			if !strings.Contains(f.data, `"content":"Xong."`) || !strings.Contains(f.data, `"followups":["Việc nào trễ?"]`) {
				t.Fatalf("done %s", f.data)
			}
		}
	}
	if strings.Contains(deltas.String(), "follo") {
		t.Fatalf("the block streamed: %s", deltas.String())
	}
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, map[string]any{"question": "việc nào trễ?", "locale": "vi"})
	msg, _ := out["message"].(map[string]any)
	if res.StatusCode != http.StatusOK || msg["content"] != answer {
		t.Fatalf("JSON route: %d %v", res.StatusCode, out)
	}
}

// A regenerate that names no live last answer is a JSON 400 before any stream
// (the question is sent, so the id is what is refused); on the JSON route,
// which is not the dock, it is the dock-only 400.
func TestAskUniStreamRegenerateRefusals(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply})
	_, first := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, map[string]any{"question": "hỏi"})
	conv := first["conversation_id"].(string)
	body := map[string]any{"question": "hỏi lại", "conversation_id": conv, "regenerate_message_id": "01NOSUCHMESSAGE0000000000000"}
	res := postStream(t, srv, wsID, owner, body)
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != 400 || strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") || !strings.Contains(fmt.Sprint(out), "regenerate: not the last answer") {
		t.Fatalf("stream: %d %v", res.StatusCode, out)
	}
	body["regenerate_message_id"] = first["message"].(map[string]any)["id"]
	r, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, body)
	if r.StatusCode != 400 || !strings.Contains(fmt.Sprint(out), "regenerate: dock only") {
		t.Fatalf("json route: %d %v", r.StatusCode, out)
	}
}

// A regenerate through the stream route answers in place: a done frame, and
// the conversation still lists one question and one answer, the answer new.
func TestAskUniStreamRegenerateReplacesTheAnswer(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply})
	first := collectFrames(readSSE(postStream(t, srv, wsID, owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi"}).Body))
	var run struct {
		ConversationID string `json:"conversation_id"`
	}
	var done struct{ Message struct{ ID string } }
	for _, f := range first {
		switch f.event {
		case "run":
			_ = json.Unmarshal([]byte(f.data), &run)
		case "done":
			_ = json.Unmarshal([]byte(f.data), &done)
		}
	}
	res := postStream(t, srv, wsID, owner, map[string]any{"question": "x", "locale": "vi", "conversation_id": run.ConversationID, "regenerate_message_id": done.Message.ID})
	frames := collectFrames(readSSE(res.Body))
	var again struct{ Message struct{ ID string } }
	for _, f := range frames {
		if f.event == "done" {
			_ = json.Unmarshal([]byte(f.data), &again)
		}
	}
	if res.StatusCode != 200 || again.Message.ID == "" || again.Message.ID == done.Message.ID {
		t.Fatalf("status %d events %v done %+v", res.StatusCode, eventsOf(frames), again)
	}
	_, list := doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+run.ConversationID+"/messages", owner, nil)
	msgs, _ := list["messages"].([]any)
	if len(msgs) != 2 || msgs[1].(map[string]any)["id"] != again.Message.ID {
		t.Fatalf("messages %v", list)
	}
}

// The first answer of a conversation names it: a title frame follows done.
func TestAskUniStreamWritesTitleAfterDone(t *testing.T) {
	fake := &provider.Fake{StreamChunk: 4, Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		if strings.Contains(req.System, "Name this conversation") {
			return provider.CompletionResponse{Text: "\"Việc trễ.\"", UsagePresent: true, InputTokens: 3, StopReason: "end_turn"}
		}
		return provider.CompletionResponse{Text: "Xong.", UsagePresent: true, InputTokens: 5, StopReason: "end_turn"}
	}}
	srv, owner, _, wsID := askWorld(t, fake)
	frames := collectFrames(readSSE(postStream(t, srv, wsID, owner, map[string]any{"question": "việc nào trễ?", "locale": "vi"}).Body))
	names := eventsOf(frames)
	if len(names) < 2 || names[len(names)-2] != "done" || names[len(names)-1] != "title" {
		t.Fatalf("events %v", names)
	}
	var run struct {
		ConversationID string `json:"conversation_id"`
	}
	var title struct {
		ConversationID string `json:"conversation_id"`
		Title          string `json:"title"`
	}
	for _, f := range frames {
		switch f.event {
		case "run":
			_ = json.Unmarshal([]byte(f.data), &run)
		case "title":
			_ = json.Unmarshal([]byte(f.data), &title)
		}
	}
	if title.Title != "Việc trễ" || title.ConversationID == "" || title.ConversationID != run.ConversationID {
		t.Fatalf("title %+v run %+v", title, run)
	}
}

func TestAskInputFromSDIMapsTransientAndTranscript(t *testing.T) {
	in := sdi.AskUniSDI{
		Question:  "Tóm tắt tài liệu",
		Transient: true,
		Focus:     &sdi.AskUniFocusSDI{Kind: "drive_file", ID: "01DRIVEFILE000000000000001"},
		Transcript: []sdi.AskUniTranscriptTurnSDI{
			{Role: "user", Text: "Câu 1"},
			{Role: "assistant", Text: "Trả lời 1"},
		},
	}
	got := askInputFromSDI(in)
	if !got.Transient || got.Focus == nil || got.Focus.Kind != "drive_file" || len(got.Transcript) != 2 ||
		got.Transcript[0].Role != "user" || got.Transcript[0].Text != "Câu 1" ||
		got.Transcript[1].Role != "assistant" || got.Transcript[1].Text != "Trả lời 1" {
		t.Fatalf("askInputFromSDI = %+v", got)
	}
}

func TestAskUniStreamTransientRefusalsAndRunFrame(t *testing.T) {
	srv, owner, _, wsID := askWorld(t, &provider.Fake{Reply: ai.FakeReply, StreamChunk: 2, StreamDelay: 150 * time.Millisecond})
	badBodies := map[string]map[string]any{
		"drive_file without transient": {
			"question": "Tóm tắt",
			"focus":    map[string]any{"kind": "drive_file", "id": "01DRIVEFILE000000000000001"},
		},
		"transient with conversation_id": {
			"question":        "Tóm tắt",
			"transient":       true,
			"conversation_id": "01CONV00000000000000000001",
		},
		"transient with regenerate_message_id": {
			"question":              "Tóm tắt",
			"transient":             true,
			"regenerate_message_id": "01MSG000000000000000000001",
		},
	}
	for name, body := range badBodies {
		r1, out1 := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, body)
		r2 := postStream(t, srv, wsID, owner, body)
		var out2 map[string]any
		_ = json.NewDecoder(r2.Body).Decode(&out2)
		if r1.StatusCode != 400 || r2.StatusCode != 400 || errorCodeOf(out1) != "invalid_request" || errorCodeOf(out2) != "invalid_request" {
			t.Fatalf("%s: ask=%d %v, stream=%d %v", name, r1.StatusCode, out1, r2.StatusCode, out2)
		}
	}

	res := postStream(t, srv, wsID, owner, map[string]any{
		"question":  "Tóm tắt",
		"locale":    "vi",
		"transient": true,
		"focus":     map[string]any{"kind": "drive_file", "id": "01DRIVEFILE000000000000001"},
	})
	ch := readSSE(res.Body)
	var run sdo.AskStreamRunDTO
	sawRun := false
	for f := range ch {
		if f.event == "run" {
			sawRun = true
			_ = json.Unmarshal([]byte(f.data), &run)
		}
		if f.event == "delta" {
			break
		}
	}
	res.Body.Close()
	if !sawRun || run.ConversationID != "" {
		t.Fatalf("transient stream run frame = %+v (sawRun=%v), want empty conversation_id", run, sawRun)
	}
}
