package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// mcpRawPOST sends exactly the headers it is given: unlike mcpRPC it adds no
// MCP-Protocol-Version, because what a header-less request does is the point.
// The client gives up after five seconds, so a response the server holds open
// fails the test instead of hanging it.
func mcpRawPOST(t *testing.T, srv *httptest.Server, headers map[string]string, body string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := *srv.Client()
	client.Timeout = 5 * time.Second
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /mcp (%v): %v (a response the server never finishes?)", headers, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading the answer of POST /mcp (%v): %v (a stream held open?)", headers, err)
	}
	return res, raw
}

// lockedBuffer is a log sink the SDK's goroutines and the test may both touch.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func mcpToolCallCount(m *mcpRecordedMetrics) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.tools)
}

const mcpTwoCallBatch = `[{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_work","arguments":{}}},` +
	`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}]`

// One HTTP request must be one tool call. The SDK takes a JSON-RPC batch when
// no MCP-Protocol-Version header is sent (it assumes 2025-03-26) and runs
// every call of it on its own goroutine, so a 1 MiB body of tools/call entries
// (about ten thousand) would run ten thousand database-backed tools past a
// 120 a minute limiter, and drain the pool for every tenant. mcpServe refuses
// a batch before the SDK reads it.
func TestMcpRefusesBatchRequests(t *testing.T) {
	rec := &mcpRecordedMetrics{}
	srv, d := newMcpTestServerWith(t, func(d *Deps) { d.McpAuth.SetMetrics(rec) })
	pair, _ := mcpTestPair(t, srv, d, "mcp-batch@example.com", "mcp-batch")
	bearer := map[string]string{"Authorization": "Bearer " + pair.AccessToken}
	with := func(extra map[string]string) map[string]string {
		h := map[string]string{"Authorization": bearer["Authorization"]}
		for k, v := range extra {
			h[k] = v
		}
		return h
	}
	for name, c := range map[string]struct {
		headers map[string]string
		body    string
	}{
		"no protocol header":            {nil, mcpTwoCallBatch},
		"protocol header 2025-06-18":    {map[string]string{"MCP-Protocol-Version": "2025-06-18"}, mcpTwoCallBatch},
		"leading spaces":                {nil, "   " + mcpTwoCallBatch},
		"leading newline and tab":       {nil, "\n\t" + mcpTwoCallBatch},
		"leading CRLF":                  {nil, "\r\n\r\n" + mcpTwoCallBatch},
		"512 KiB of blanks first":       {nil, strings.Repeat(" ", 1<<19) + mcpTwoCallBatch},
		"one-call batch":                {nil, `[{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_work","arguments":{}}}]`},
		"batch of notifications":        {nil, `[{"jsonrpc":"2.0","method":"notifications/initialized"}]`},
		"empty batch":                   {nil, `[]`},
		"many calls in the 1 MiB limit": {nil, "[" + strings.Repeat(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_work","arguments":{}}},`, 5000) + `{"jsonrpc":"2.0","id":2,"method":"ping"}]`},
	} {
		res, raw := mcpRawPOST(t, srv, with(c.headers), c.body)
		var out struct {
			JSONRPC string         `json:"jsonrpc"`
			ID      any            `json:"id"`
			Error   map[string]any `json:"error"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Errorf("%s: status %d body %q is not JSON: %v", name, res.StatusCode, raw, err)
			continue
		}
		if res.StatusCode != http.StatusBadRequest || out.JSONRPC != "2.0" || out.ID != nil || out.Error["code"] != float64(-32600) || out.Error["message"] != "batch requests are not supported" {
			t.Errorf("%s: %d %s, want 400 with JSON-RPC error -32600 \"batch requests are not supported\" and id null", name, res.StatusCode, raw)
		}
		if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
			t.Errorf("%s: Content-Type %q", name, got)
		}
	}
	if n := mcpToolCallCount(rec); n != 0 {
		t.Fatalf("%d tool calls ran for refused batches, want 0 (%v)", n, rec.tools)
	}

	// A batch that names a revision outside the floor is refused as a batch.
	for _, version := range []string{"2025-03-26", "2024-11-05"} {
		res, raw := mcpRawPOST(t, srv, with(map[string]string{"MCP-Protocol-Version": version}), mcpTwoCallBatch)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("batch on %s: %d %s, want 400", version, res.StatusCode, raw)
		}
	}
	if n := mcpToolCallCount(rec); n != 0 {
		t.Fatalf("%d tool calls ran for batches on old revisions", n)
	}

	// Whatever a JSON parser might skip that the gate does not (a form feed, a
	// vertical tab, a byte order mark, a no-break space, a NUL): the SDK must
	// not be able to read these as a batch either. They are refused by one or
	// the other, and no tool runs.
	before := mcpToolCallCount(rec)
	for name, prefix := range map[string]string{"form feed": "\f", "vertical tab": "\v", "BOM": "\ufeff", "no-break space": "\u00a0", "NUL": "\x00", "comment": "/**/"} {
		res, raw := mcpRawPOST(t, srv, with(nil), prefix+mcpTwoCallBatch)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s before a batch: %d %.200s, want 400", name, res.StatusCode, raw)
		}
	}
	if n := mcpToolCallCount(rec); n != before {
		t.Fatalf("%d tool calls ran for batches behind odd prefixes", n-before)
	}

	// The refusal sits behind the token check, so nobody anonymous makes the
	// server look at a body.
	if res, _ := mcpRawPOST(t, srv, nil, mcpTwoCallBatch); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("batch without a token: %d, want 401", res.StatusCode)
	}

	// A single request is not a batch, with or without the header and with
	// whitespace in front: header-less clients keep working.
	for name, body := range map[string]string{
		"object":                     `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_work","arguments":{}}}`,
		"object with leading blanks": " \n\t" + `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_work","arguments":{}}}`,
	} {
		res, raw := mcpRawPOST(t, srv, with(map[string]string{"MCP-Protocol-Version": "2025-06-18"}), body)
		if res.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"result"`) {
			t.Errorf("%s: %d %s", name, res.StatusCode, raw)
		}
	}
	if n := mcpToolCallCount(rec); n != 2 {
		t.Errorf("%d tool calls after two single requests, want 2", n)
	}
}

// A body that is not one JSON-RPC message gets a 400 from the guard, and the
// ones around it are not harmed. (More than 1 MiB of blanks in front is a 413.)
func TestMcpMalformedBodiesAreRefusedAndHarmless(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-intact@example.com", "mcp-intact")
	auth := map[string]string{"Authorization": "Bearer " + pair.AccessToken, "MCP-Protocol-Version": "2025-06-18"}
	for name, body := range map[string]string{
		"empty": "", "blanks only": " \n ", "truncated": `{"jsonrpc":"2.0","id":1,"meth`, "not json": `nope`,
		"scalar": `5`, "string": `"tools/list"`, "null": `null`, "no method (a response)": `{"jsonrpc":"2.0","id":1,"result":{}}`,
		"method is not a string":    `{"jsonrpc":"2.0","id":1,"method":5}`,
		"method is null":            `{"jsonrpc":"2.0","id":1,"method":null}`,
		"two messages":              `{"jsonrpc":"2.0","id":1,"method":"ping"} {"jsonrpc":"2.0","id":2,"method":"subscriptions/listen"}`,
		"data after the message":    `{"jsonrpc":"2.0","id":1,"method":"ping"}x`,
		"method twice":              `{"jsonrpc":"2.0","id":1,"method":"tools/list","method":"subscriptions/listen"}`,
		"method twice, other order": `{"jsonrpc":"2.0","id":1,"method":"subscriptions/listen","method":"tools/list"}`,
		"method in another case":    `{"jsonrpc":"2.0","id":1,"Method":"subscriptions/listen","method":"tools/list"}`,
		"method only in capitals":   `{"jsonrpc":"2.0","id":1,"METHOD":"tools/list"}`,
		"id twice":                  `{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}`,
		"id in another case":        `{"jsonrpc":"2.0","ID":1,"method":"ping"}`,
	} {
		started := time.Now()
		res, raw := mcpRawPOST(t, srv, auth, body)
		var out struct {
			ID    any            `json:"id"`
			Error map[string]any `json:"error"`
		}
		_ = json.Unmarshal(raw, &out)
		if res.StatusCode != http.StatusBadRequest || out.Error["code"] != float64(-32600) || out.ID != nil || time.Since(started) > 2*time.Second {
			t.Errorf("%s: %d %.200s, want a quick 400 with JSON-RPC error -32600 and id null", name, res.StatusCode, raw)
		}
	}
	// More than the cap of blanks in front of the message is refused as too
	// large, before anything of it is judged.
	res, raw := mcpRawPOST(t, srv, auth, strings.Repeat(" ", 1<<20+16)+`{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("more than 1 MiB of blanks: %d %.200s, want 413", res.StatusCode, raw)
	}
	res, raw = mcpRawPOST(t, srv, auth, `{"jsonrpc":"2.0","id":9,"method":"ping"}`)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"id":9`) {
		t.Errorf("ping after the malformed ones: %d %s", res.StatusCode, raw)
	}
}

// Protocol versions (spec §7.1 floor): only 2025-06-18 and 2025-11-25. The
// older ones allow JSON-RPC batching; 2026-07-28 makes subscriptions/listen a
// server-sent stream that stays open until the client cancels, and with no
// write timeout and HTTP_MAX_IN_FLIGHT slots, one token would fill them all
// and every tenant on the replica would get 503.
func TestMcpProtocolVersionFloor(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-versions@example.com", "mcp-versions")
	auth := "Bearer " + pair.AccessToken

	// The shape of a 2026-07-28 request: the version in the header and in
	// _meta, and the capabilities the SDK requires there.
	const meta2026 = `{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"probe","version":"1"}}`
	listen := `{"jsonrpc":"2.0","id":1,"method":"subscriptions/listen","params":{"_meta":` + meta2026 + `,"notifications":{"toolsListChanged":true}}}`
	started := time.Now()
	res, raw := mcpRawPOST(t, srv, map[string]string{"Authorization": auth, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "subscriptions/listen"}, listen)
	if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") || !strings.Contains(string(raw), `"error"`) {
		t.Errorf("subscriptions/listen on 2026-07-28: %d %q %s, want a JSON error that is not a stream", res.StatusCode, res.Header.Get("Content-Type"), raw)
	}
	if took := time.Since(started); took > 2*time.Second {
		t.Errorf("subscriptions/listen took %s to be refused", took)
	}
	// Any other 2026-07-28 call is refused the same way, not served.
	res, raw = mcpRawPOST(t, srv, map[string]string{"Authorization": auth, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list"},
		`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":`+meta2026+`}}`)
	if res.StatusCode < 400 || res.StatusCode >= 500 {
		t.Errorf("tools/list on 2026-07-28: %d %s, want a 4xx", res.StatusCode, raw)
	}

	for _, version := range []string{"2025-03-26", "2024-11-05"} {
		res, raw = mcpRawPOST(t, srv, map[string]string{"Authorization": auth, "MCP-Protocol-Version": version}, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("explicit %s: %d %s, want 400", version, res.StatusCode, raw)
		}
	}
	for _, version := range []string{"2025-06-18", "2025-11-25"} {
		res, raw = mcpRawPOST(t, srv, map[string]string{"Authorization": auth, "MCP-Protocol-Version": version}, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
		if res.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"tools"`) {
			t.Errorf("explicit %s: %d %s, want 200", version, res.StatusCode, raw)
		}
	}
}

// The compatibility proof for the floor: the flow a real client runs still
// works. initialize carries no MCP-Protocol-Version header (the version is not
// agreed yet) and offers 2025-06-18 in its params; every later request carries
// the negotiated version in the header.
func TestMcpRealClientFlowStillWorksOnTheFloor(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, wsID := mcpTestPair(t, srv, d, "mcp-flow@example.com", "mcp-flow")
	auth := "Bearer " + pair.AccessToken
	initialize := func(offered string) (int, map[string]any) {
		t.Helper()
		res, raw := mcpRawPOST(t, srv, map[string]string{"Authorization": auth},
			`{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"`+offered+`","capabilities":{},"clientInfo":{"name":"claude-test","version":"1"}}}`)
		out := map[string]any{}
		_ = json.Unmarshal(raw, &out)
		t.Logf("initialize offering %s, no header: %d %s", offered, res.StatusCode, raw)
		return res.StatusCode, out
	}

	status, out := initialize("2025-06-18")
	result, _ := out["result"].(map[string]any)
	if status != http.StatusOK || result["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize 2025-06-18 without a header: %d %v", status, out)
	}
	// The server advertises tools and nothing it cannot deliver: no list-changed
	// notification (a stateless server has no stream for one), no logging.
	if caps, _ := json.Marshal(result["capabilities"]); string(caps) != `{"tools":{}}` {
		t.Errorf("capabilities = %s, want {\"tools\":{}}", caps)
	}
	negotiated, _ := result["protocolVersion"].(string)
	header := map[string]string{"Authorization": auth, "MCP-Protocol-Version": negotiated}

	res, raw := mcpRawPOST(t, srv, header, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if res.StatusCode != http.StatusAccepted {
		t.Errorf("notifications/initialized: %d %s", res.StatusCode, raw)
	}
	res, raw = mcpRawPOST(t, srv, header, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.StatusCode != http.StatusOK || strings.Count(string(raw), `"readOnlyHint":true`) != 5 {
		t.Errorf("tools/list: %d %s", res.StatusCode, raw)
	}
	res, raw = mcpRawPOST(t, srv, header, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_task","arguments":{"workspace_id":"`+wsID+`","task_id":"01NOPE0000000000000000000"}}}`)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(raw), "not found or not accessible") {
		t.Errorf("tools/call: %d %s", res.StatusCode, raw)
	}

	// A client on the newest version of the handshake era negotiates it.
	status, out = initialize("2025-11-25")
	result, _ = out["result"].(map[string]any)
	if status != http.StatusOK || result["protocolVersion"] != "2025-11-25" {
		t.Errorf("initialize 2025-11-25: %d %v", status, out)
	}
	// Clients older or newer than the floor are answered with a version the
	// server does, and left to disconnect (initialize never fails in the SDK).
	for _, offered := range []string{"2025-03-26", "2024-11-05", "2026-07-28"} {
		status, out = initialize(offered)
		result, _ = out["result"].(map[string]any)
		if v, _ := result["protocolVersion"].(string); status != http.StatusOK || (v != "2025-06-18" && v != "2025-11-25") {
			t.Errorf("initialize offering %s: %d %v, want a version of the floor", offered, status, out)
		}
	}
}

// The SDK sets Cache-Control: no-cache, no-transform on its own 200 answers;
// a body that carries a person's tasks must be no-store, as every other
// answer of this route.
func TestMcpAnswersAreNoStore(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-nostore@example.com", "mcp-nostore")
	headers := map[string]string{"Authorization": "Bearer " + pair.AccessToken, "MCP-Protocol-Version": "2025-06-18"}
	for name, body := range map[string]string{
		"tools/call": `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}`,
		"tools/list": `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
		"ping":       `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
		"accepted":   `{"jsonrpc":"2.0","method":"notifications/initialized"}`,
	} {
		res, _ := mcpRawPOST(t, srv, headers, body)
		if got := res.Header.Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s (%d): Cache-Control = %q, want no-store", name, res.StatusCode, got)
		}
		if got := res.Header.Get("Pragma"); got != "no-cache" {
			t.Errorf("%s (%d): Pragma = %q, want no-cache", name, res.StatusCode, got)
		}
	}
	// And the ones that never reach the SDK.
	res, _ := mcpRawPOST(t, srv, nil, `{}`)
	if res.StatusCode != http.StatusUnauthorized || res.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("401: %d %q", res.StatusCode, res.Header.Get("Cache-Control"))
	}
}

// A client that goes away, or a shutdown, cancels the tool's context. That is
// not a failure of ours: it is counted as "cancelled" and is not an error line.
func TestMcpToolResultCancelledIsNotAnError(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	for name, err := range map[string]error{"bare": context.Canceled, "wrapped": errors.New("pgx: " + context.Canceled.Error())} {
		outcome, res := mcpToolResult(cancelled, nil, err)
		if outcome != "cancelled" || !res.IsError {
			t.Errorf("%s: outcome %q isError %v, want cancelled", name, outcome, res.IsError)
		}
	}
	// A live context with a failure is still an error: only the context's own
	// end changes the label.
	if outcome, _ := mcpToolResult(context.Background(), nil, context.Canceled); outcome != "error" {
		t.Errorf("a failure under a live context: outcome %q, want error", outcome)
	}
	// And a model's mistake stays a mistake even when the client has gone.
	if outcome, _ := mcpToolResult(cancelled, nil, service.McpInvalidArgs{Msg: "x"}); outcome != "invalid" {
		t.Errorf("invalid arguments under a cancelled context: outcome %q, want invalid", outcome)
	}
}

func TestMcpHandlerCountsACancelledCallWithoutAnErrorLine(t *testing.T) {
	started := make(chan struct{})
	registry := ai.Registry{{Name: "slow", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(ctx context.Context, _ ai.ToolContext, _ json.RawMessage) (json.RawMessage, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}}}
	var logs lockedBuffer
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(registry, counts, nil, slog.New(slog.NewTextHandler(&logs, nil))), service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1"})

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow","arguments":{}}}`)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-06-18")
	done := make(chan struct{})
	go func() { h.ServeHTTP(httptest.NewRecorder(), req); close(done) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("the tool never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the handler did not return after its request was cancelled")
	}
	deadline := time.Now().Add(5 * time.Second)
	for counts.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := counts.joined(); got != "slow/cancelled" {
		t.Errorf("metrics = %q, want slow/cancelled", got)
	}
	if strings.Contains(logs.String(), "level=ERROR") {
		t.Errorf("a client that went away produced an error line: %s", logs.String())
	}
}

// What a tool panics with can carry the tool's data (a row, a field of the
// arguments). The log gets the type and the stack; a runtime error's message
// is the runtime's own and carries nothing of ours.
func TestMcpPanicLogCarriesTheTypeNotTheValue(t *testing.T) {
	for name, c := range map[string]struct {
		value   func()
		want    []string
		wantNot []string
	}{
		"string value": {func() { panic("row for hunter2@example.com") }, []string{"panic=string", "mcp tool panic", "stack="}, []string{"hunter2"}},
		"error value":  {func() { panic(errors.New("password hunter2 rejected")) }, []string{"panic=*errors.errorString"}, []string{"hunter2"}},
		"runtime error": {func() {
			var rows []int
			_ = rows[len(os.Args)+3] // index out of range, from a value the compiler cannot see
		}, []string{"index out of range"}, nil},
	} {
		t.Run(name, func(t *testing.T) {
			registry := ai.Registry{{Name: "panics", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
				c.value()
				return nil, nil
			}}}
			var logs bytes.Buffer
			h := mcpServeAs(newMcpHandler(registry, &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(&logs, nil))), service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1"})
			out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"panics","arguments":{}}}`)
			if result, _ := out["result"].(map[string]any); result["isError"] != true {
				t.Fatalf("result = %v", out)
			}
			for _, want := range c.want {
				if !strings.Contains(logs.String(), want) {
					t.Errorf("log lacks %q: %.400s", want, logs.String())
				}
			}
			for _, bad := range c.wantNot {
				if strings.Contains(logs.String(), bad) {
					t.Errorf("log carries %q", bad)
				}
			}
		})
	}
}

// The same over a real connection: net/http cancels a request's context when
// the client closes the connection, and the tool must see it (the SDK itself
// does not pass that on for the revisions served).
func TestMcpClientDisconnectStopsTheTool(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan error, 1)
	registry := ai.Registry{{Name: "slow", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(ctx context.Context, _ ai.ToolContext, _ json.RawMessage) (json.RawMessage, error) {
		close(started)
		select {
		case <-ctx.Done():
			stopped <- ctx.Err()
		case <-time.After(5 * time.Second):
			stopped <- nil
		}
		return nil, ctx.Err()
	}}}
	counts := &mcpToolCounts{}
	srv := httptest.NewServer(mcpServeAs(newMcpHandler(registry, counts, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), service.McpPrincipal{UserID: "u1", OrganizationID: "o1"}))
	t.Cleanup(srv.Close)

	ctx, hangUp := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, srv.URL, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow","arguments":{}}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-06-18")
	go func() {
		if res, err := http.DefaultClient.Do(req); err == nil {
			res.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("the tool never started")
	}
	hangUp()
	select {
	case err := <-stopped:
		if err == nil {
			t.Fatal("the tool was still running 5 s after its client hung up")
		}
	case <-time.After(6 * time.Second):
		t.Fatal("no answer from the tool")
	}
	deadline := time.Now().Add(5 * time.Second)
	for counts.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := counts.joined(); got != "slow/cancelled" {
		t.Errorf("metrics = %q, want slow/cancelled", got)
	}
}

// subscriptions/listen is a stream the SDK holds open until the client cancels,
// on every revision (it forces SSE even with JSONResponse), and a held stream
// per request is how one token fills HTTP_MAX_IN_FLIGHT for every tenant. It
// is not a method this server serves.
func TestMcpSubscriptionsListenNeverOpensAStream(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-listen@example.com", "mcp-listen")
	listen := `{"jsonrpc":"2.0","id":1,"method":"subscriptions/listen","params":{"notifications":{"toolsListChanged":true}}}`
	for name, version := range map[string]string{"2025-06-18": "2025-06-18", "2025-11-25": "2025-11-25", "no header": ""} {
		headers := map[string]string{"Authorization": "Bearer " + pair.AccessToken}
		if version != "" {
			headers["MCP-Protocol-Version"] = version
		}
		started := time.Now()
		res, raw := mcpRawPOST(t, srv, headers, listen)
		var out struct {
			ID    any            `json:"id"`
			Error map[string]any `json:"error"`
		}
		_ = json.Unmarshal(raw, &out)
		if took := time.Since(started); took > 2*time.Second {
			t.Errorf("%s: answered after %s", name, took)
		}
		if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
			t.Errorf("%s: answered as a stream: %.200s", name, raw)
		}
		if res.StatusCode != http.StatusOK || out.ID != float64(1) || out.Error["code"] != float64(-32601) {
			t.Errorf("%s: %d %.200s, want a JSON-RPC error -32601 for id 1", name, res.StatusCode, raw)
		}
	}
}

// The SDK registers every method of the protocol; the guard lets through the
// five this server serves and nothing else, so a method a later release adds
// (a new kind of subscription, a streaming call) cannot reopen what is closed.
func TestMcpOnlyServesItsAllowListedMethods(t *testing.T) {
	rec := &mcpRecordedMetrics{}
	srv, d := newMcpTestServerWith(t, func(d *Deps) { d.McpAuth.SetMetrics(rec) })
	pair, _ := mcpTestPair(t, srv, d, "mcp-allow@example.com", "mcp-allow")
	headers := map[string]string{"Authorization": "Bearer " + pair.AccessToken, "MCP-Protocol-Version": "2025-06-18"}

	for _, method := range []string{
		"resources/list", "resources/templates/list", "resources/read", "resources/subscribe", "resources/unsubscribe",
		"prompts/list", "prompts/get", "completion/complete", "logging/setLevel", "server/discover",
		"subscriptions/listen", "sampling/createMessage", "roots/list", "elicitation/create", "tasks/list", "no/such/method", "",
	} {
		// The id comes back as the client sent it, number or string.
		for _, id := range []string{`7`, `"abc"`} {
			res, raw := mcpRawPOST(t, srv, headers, `{"jsonrpc":"2.0","id":`+id+`,"method":"`+method+`","params":{}}`)
			var out struct {
				JSONRPC string          `json:"jsonrpc"`
				ID      json.RawMessage `json:"id"`
				Error   map[string]any  `json:"error"`
				Result  any             `json:"result"`
			}
			if err := json.Unmarshal(raw, &out); err != nil || res.StatusCode != http.StatusOK || out.JSONRPC != "2.0" || string(out.ID) != id ||
				out.Error["code"] != float64(-32601) || out.Error["message"] != "method not found" || out.Result != nil {
				t.Errorf("%q id %s: %d %.200s, want 200 with JSON-RPC error -32601 \"method not found\" for the same id", method, id, res.StatusCode, raw)
			}
		}
	}
	// Notifications have no reply: 202, nothing forwarded.
	for _, method := range []string{"notifications/cancelled", "notifications/roots/list_changed", "notifications/progress", "notifications/unknown"} {
		res, raw := mcpRawPOST(t, srv, headers, `{"jsonrpc":"2.0","method":"`+method+`","params":{}}`)
		if res.StatusCode != http.StatusAccepted || len(raw) != 0 {
			t.Errorf("%s: %d %q, want 202 and no body", method, res.StatusCode, raw)
		}
	}
	// A key spelled with an escape is the same key.
	res, raw := mcpRawPOST(t, srv, headers, `{"jsonrpc":"2.0","id":1,"met\u0068od":"subscriptions/listen","params":{}}`)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(raw), "-32601") {
		t.Errorf("escaped method key: %d %.200s, want -32601", res.StatusCode, raw)
	}
	if n := mcpToolCallCount(rec); n != 0 {
		t.Fatalf("%d tool calls for refused methods", n)
	}

	// The five that are served.
	for name, body := range map[string]string{
		"ping":       `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
		"tools/list": `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
		"tools/call": `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}`,
		"initialize": `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`,
	} {
		res, raw := mcpRawPOST(t, srv, headers, body)
		if res.StatusCode != http.StatusOK || strings.Contains(string(raw), `"error"`) {
			t.Errorf("%s: %d %.200s", name, res.StatusCode, raw)
		}
	}
	res, raw = mcpRawPOST(t, srv, headers, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if res.StatusCode != http.StatusAccepted {
		t.Errorf("notifications/initialized: %d %q", res.StatusCode, raw)
	}
	if n := mcpToolCallCount(rec); n != 1 {
		t.Errorf("%d tool calls after one tools/call", n)
	}
}
