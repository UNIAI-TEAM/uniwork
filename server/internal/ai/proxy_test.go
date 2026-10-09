package ai

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const testKey = "sk-live-SECRET-0123456789"

type publicResolver struct{}

func (publicResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
}

// vendor serves h over TLS as https://example.com, reached through the
// production guard (fake DNS answers a public address; the dial hook lands
// on the listener).
func vendor(t *testing.T, g *Gateway, h http.Handler) string {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	target := srv.Listener.Addr().String()
	g.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
		Resolver:  publicResolver{},
		TLSConfig: &tls.Config{RootCAs: pool},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, target)
		},
	}))
	return "https://example.com"
}

func byokReq(providerID, base string, op ProxyOp, body string) ProxyRequest {
	return ProxyRequest{
		Actor: audit.User("u1"), OrganizationID: "org1", Op: op, Body: []byte(body),
		Credential: BYOKCredential{Provider: providerID, BaseURL: base, APIKey: testKey},
	}
}

func TestProxyRefusesUnsupportedProviderOrRoute(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	for _, req := range []ProxyRequest{
		byokReq("genspark", "", ProxyChatCompletions, `{}`),
		byokReq("codex", "", ProxyModels, ``),
		byokReq("anthropic", "", ProxyChatCompletions, `{}`), // wrong route for the protocol
		byokReq("openai", "", ProxyMessages, `{}`),
		byokReq("openai", "", ProxyGenerate, `{}`),
	} {
		if _, err := g.Proxy(context.Background(), req); !errors.Is(err, ErrProviderNotSupported) {
			t.Errorf("%s/%s: %v", req.Credential.Provider, req.Op, err)
		}
	}
	if _, err := g.Proxy(context.Background(), byokReq("custom", "", ProxyModels, ``)); !errors.Is(err, ErrBaseURLRefused) {
		t.Errorf("custom without base url: %v", err)
	}
	if _, err := g.Proxy(context.Background(), byokReq("custom", "http://10.0.0.1/v1", ProxyModels, ``)); !errors.Is(err, ErrBaseURLRefused) {
		t.Errorf("custom private base url: %v", err)
	}
}

func TestProxyGenerateRejectsAPathModel(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	for _, body := range []string{
		`{"model":"../../v1/files","request":{}}`,
		`{"model":"gemini-3.8-flash"}`,
		`{"model":"gemini?x=1","request":{}}`,
		`[1]`,
	} {
		if _, err := g.Proxy(context.Background(), byokReq("gemini", "", ProxyGenerate, body)); !errors.Is(err, ErrProxyBadRequest) {
			t.Errorf("%s: %v", body, err)
		}
	}
}

// The model list needs no usage row, so it runs without a database: the
// vendor path per protocol, the key header, the 401 → 424 mapping and the
// redacted pass-through of other vendor errors.
func TestProxyModelsPassThroughAndErrors(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	status := http.StatusOK
	base := vendor(t, g, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		okPath := map[string]bool{"/v1/models": r.Header.Get("x-api-key") == testKey, "/v1beta/models": r.Header.Get("x-goog-api-key") == testKey}
		if !okPath[r.URL.Path] {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "vendor=1")
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"data":[],"echo":"`+testKey+`"}`)
	}))
	s, err := g.Proxy(context.Background(), byokReq("anthropic", base, ProxyModels, ``))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(s.Body)
	_ = s.Body.Close()
	if s.Status != 200 || !strings.Contains(string(body), `"data":[]`) {
		t.Fatalf("%d %s", s.Status, body)
	}
	if s.Header.Get("Set-Cookie") != "" || s.Header.Get("Content-Type") != "application/json" || s.Header.Get("Retry-After") != "7" {
		t.Fatalf("header allowlist: %v", s.Header)
	}

	status = http.StatusTooManyRequests
	s, err = g.Proxy(context.Background(), byokReq("gemini", base+"/v1beta", ProxyModels, ``))
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(s.Body)
	if s.Status != 429 || strings.Contains(string(body), testKey) || !strings.Contains(string(body), "[redacted]") {
		t.Fatalf("429 passthrough: %d %s", s.Status, body)
	}

	for _, st := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		status = st
		_, err = g.Proxy(context.Background(), byokReq("anthropic", base, ProxyModels, ``))
		var e *Error
		if !errors.As(err, &e) || e.Status != 424 || e.Code != "provider_auth_failed" {
			t.Fatalf("%d: %v", st, err)
		}
		if strings.Contains(err.Error(), testKey) {
			t.Fatal("error carries the key")
		}
	}
}

func TestProxyUnreachableIs502(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	g.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
		Resolver: publicResolver{},
		Dial: func(context.Context, string, string) (net.Conn, error) {
			return nil, errors.New("connection refused")
		},
	}))
	_, err := g.Proxy(context.Background(), byokReq("openai", "", ProxyModels, ``))
	var e *Error
	if !errors.As(err, &e) || e.Status != 502 || e.Code != "provider_unreachable" {
		t.Fatalf("%v", err)
	}
}

func TestUsageTapReadsEachProtocol(t *testing.T) {
	cases := []struct {
		name     string
		protocol provider.BYOKProtocol
		stream   bool
		body     string
		in, out  int
	}{
		{"openai json", provider.ProtocolOpenAICompatible, false,
			"{\n  \"choices\": [],\n  \"usage\": {\"prompt_tokens\": 11, \"completion_tokens\": 7}\n}", 11, 7},
		{"openai sse", provider.ProtocolOpenAICompatible, true,
			"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n", 5, 3},
		{"anthropic json", provider.ProtocolAnthropic, false,
			`{"content":[],"usage":{"input_tokens":20,"output_tokens":9}}`, 20, 9},
		{"anthropic sse", provider.ProtocolAnthropic, true,
			"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":30,\"output_tokens\":1}}}\n\n" +
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"x\"}}\n\n" +
				"event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":12}}\n\n", 30, 12},
		{"gemini json", provider.ProtocolGemini, false,
			`{"candidates":[],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4,"thoughtsTokenCount":2}}`, 8, 6},
		{"gemini sse", provider.ProtocolGemini, true,
			"data: {\"usageMetadata\":{\"promptTokenCount\":8,\"candidatesTokenCount\":1}}\r\n\r\ndata: {\"usageMetadata\":{\"promptTokenCount\":8,\"candidatesTokenCount\":5}}", 8, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var eof bool
			tap := &usageTap{rc: io.NopCloser(strings.NewReader(tc.body)), protocol: tc.protocol, stream: tc.stream}
			tap.onClose = func(e bool) { eof = e }
			// Small reads split lines across chunks.
			buf := make([]byte, 7)
			var got strings.Builder
			for {
				n, err := tap.Read(buf)
				got.Write(buf[:n])
				if err != nil {
					break
				}
			}
			_ = tap.Close()
			if got.String() != tc.body {
				t.Fatal("body altered")
			}
			if !eof || tap.in != tc.in || tap.out != tc.out {
				t.Fatalf("eof=%v in=%d out=%d", eof, tap.in, tap.out)
			}
		})
	}
}

func TestRedactKey(t *testing.T) {
	got := string(RedactKey([]byte(`{"error":"bad key `+testKey+` / `+testKey+`"}`), testKey))
	if strings.Contains(got, testKey) || strings.Count(got, "[redacted]") != 2 {
		t.Fatal(got)
	}
	if string(RedactKey([]byte("x"), "")) != "x" {
		t.Fatal("empty key")
	}
	// A vendor that JSON-escapes "/" echoes it as "/".
	if got := string(RedactKey([]byte(`{"e":"sk-ab/cd"}`), "sk-ab/cd")); strings.Contains(got, "ab") {
		t.Fatal(got)
	}
}

// m3: only JSON, SSE and plain text keep their Content-Type; an HTML page
// from a custom endpoint is handed back as opaque bytes.
func TestProxyContentTypeAllowlist(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	ct := ""
	base := vendor(t, g, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		_, _ = io.WriteString(w, "<html></html>")
	}))
	for in, want := range map[string]string{
		"application/json":                "application/json",
		"application/json; charset=utf-8": "application/json; charset=utf-8",
		"text/event-stream":               "text/event-stream",
		"text/plain; charset=utf-8":       "text/plain; charset=utf-8",
		"text/html":                       "application/octet-stream",
		"text/html; charset=utf-8":        "application/octet-stream",
		"image/svg+xml":                   "application/octet-stream",
		"application/jsonx":               "application/octet-stream",
		"garbage;;":                       "application/octet-stream",
	} {
		ct = in
		s, err := g.Proxy(context.Background(), byokReq("anthropic", base, ProxyModels, ""))
		if err != nil {
			t.Fatal(err)
		}
		_ = s.Body.Close()
		if got := s.Header.Get("Content-Type"); got != want {
			t.Errorf("vendor %q -> %q, want %q", in, got, want)
		}
	}
}

// m6: the client's anthropic-beta reaches the vendor; its credentials and
// cookies do not, and the stored key is the one the vendor sees.
func TestProxyForwardsAllowlistedRequestHeaders(t *testing.T) {
	g := NewGateway(nil, nil, nil, nil, Options{})
	var seen http.Header
	base := vendor(t, g, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, "{}")
	}))
	req := byokReq("anthropic", base, ProxyModels, "")
	req.Header = http.Header{
		"Anthropic-Beta": {"tools-2026-01-01"}, "X-Api-Key": {"attacker"}, "Authorization": {"Bearer attacker"}, "Cookie": {"s=1"},
	}
	s, err := g.Proxy(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Body.Close()
	if seen.Get("Anthropic-Beta") != "tools-2026-01-01" || seen.Get("X-Api-Key") != testKey || seen.Get("Authorization") != "" || seen.Get("Cookie") != "" {
		t.Fatalf("vendor saw %v", seen)
	}
}

// DB-backed (runs where TEST_DATABASE_URL is set): a streamed chat call
// reaches the client chunk by chunk, carries the key only to the vendor,
// and settles one office.byok usage row with the parsed tokens, credits 0.
func TestGatewayProxyStreamsAndMetersBYOK(t *testing.T) {
	g, q := gatewayFixture(t, nil, nil)
	release := make(chan struct{})
	base := vendor(t, g, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer "+testKey {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-release
		_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":13,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n")
	}))
	s, err := g.Proxy(context.Background(), byokReq("openai", base+"/v1", ProxyChatCompletions, `{"model":"gpt-5.6-terra","stream":true,"messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if !s.Stream || s.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream %v %v", s.Stream, s.Header)
	}
	br := bufio.NewReader(s.Body)
	if line, err := br.ReadString('\n'); err != nil || !strings.Contains(line, `"a"`) {
		t.Fatalf("first chunk %q %v", line, err)
	}
	close(release)
	rest, _ := io.ReadAll(br)
	if !strings.Contains(string(rest), "[DONE]") || strings.Contains(string(rest), testKey) {
		t.Fatalf("rest %q", rest)
	}
	_ = s.Body.Close()

	rows, err := q.AiUsageByDay(context.Background(), db.AiUsageByDayParams{OrganizationID: "org1", FromAt: pgTime(time.Now().Add(-time.Hour))})
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows %v %v", rows, err)
	}
	if r := rows[0]; r.Capability != string(CapOfficeBYOK) || r.InputTokens != 13 || r.OutputTokens != 4 || r.CostMicros != 0 {
		t.Fatalf("usage %+v", r)
	}
}

// DB-backed: a vendor 401 settles the row as failed provider_auth_failed.
func TestGatewayProxyAuthFailureSettlesRow(t *testing.T) {
	g, q := gatewayFixture(t, nil, nil)
	base := vendor(t, g, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"invalid key `+testKey+`"}`)
	}))
	_, err := g.Proxy(context.Background(), byokReq("anthropic", base, ProxyMessages, `{"model":"claude-sonnet-5","messages":[]}`))
	if !errors.Is(err, ErrProviderAuthFailed) {
		t.Fatal(err)
	}
	rows, err := q.AiUsageByDay(context.Background(), db.AiUsageByDayParams{OrganizationID: "org1", FromAt: pgTime(time.Now().Add(-time.Hour))})
	if err != nil || len(rows) != 1 || rows[0].Calls != 1 || rows[0].InputTokens != 0 {
		t.Fatalf("rows %v %v", rows, err)
	}
}

func pgTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
