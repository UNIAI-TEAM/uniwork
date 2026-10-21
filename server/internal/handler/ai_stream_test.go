package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
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
