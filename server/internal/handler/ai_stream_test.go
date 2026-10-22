package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
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
	names := eventsOf(frames)
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

func TestToAiMessageDTOBadStepsJSONIsEmpty(t *testing.T) {
	m := db.AiMessage{Steps: `[{"tool":"search"},{"tool":5}]`, Followups: `["a",5]`, Mentions: `[{"kind":"x"},{"kind":5}]`, Citations: "[]"}
	out := toAiMessageDTO(m)
	if out.Steps == nil || len(out.Steps) != 0 || out.Followups == nil || len(out.Followups) != 0 || out.Mentions == nil || len(out.Mentions) != 0 || out.Focus != nil {
		t.Fatalf("%+v", out)
	}
}
