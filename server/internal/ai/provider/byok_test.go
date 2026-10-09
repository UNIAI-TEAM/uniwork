package provider

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
	"net/netip"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The fork's providers.ts lists these; genspark (UniWork's pool), codex (a
// local CLI) and the opencode gateways (protocol per model id) are excluded
// on purpose (contract D4). A provider added to the fork shows up here as a
// decision to make, not silently.
func TestBYOKProviderTableMatchesFork(t *testing.T) {
	want := []string{
		"anthropic", "gemini", "openai", "deepseek", "kimi", "glm", "qwen", "doubao", "mimo",
		"hunyuan", "ling", "spark", "longcat", "minimax", "xai", "mistral", "openrouter",
		"requesty", "opper", "cheaperinference", "custom",
	}
	if got := BYOKProviderIDs(); !slices.Equal(got, want) {
		t.Fatalf("ids:\n got %v\nwant %v", got, want)
	}
	for _, id := range []string{"genspark", "codex", "opencode-zen", "opencode-go"} {
		if _, ok := LookupBYOKProvider(id); ok {
			t.Errorf("%s must not be proxied", id)
		}
	}
	for _, p := range BYOKProviders() {
		switch p.Protocol {
		case ProtocolOpenAICompatible, ProtocolAnthropic, ProtocolGemini:
		default:
			t.Errorf("%s: protocol %q", p.ID, p.Protocol)
		}
		if p.RequiresBaseURL != (p.ID == CustomProviderID) {
			t.Errorf("%s: requires_base_url %v", p.ID, p.RequiresBaseURL)
		}
		if !p.RequiresBaseURL && !strings.HasPrefix(p.DefaultBaseURL, "https://") {
			t.Errorf("%s: default base %q", p.ID, p.DefaultBaseURL)
		}
	}
	if p, _ := LookupBYOKProvider("anthropic"); p.Protocol != ProtocolAnthropic {
		t.Fatal("anthropic protocol")
	}
	if p, _ := LookupBYOKProvider("gemini"); p.Protocol != ProtocolGemini {
		t.Fatal("gemini protocol")
	}
}

func TestBYOKBlockedAddresses(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
		"0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
		"::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
		"64:ff9b::a00:1", "2002:a00:1::1",
	}
	for _, s := range blocked {
		if !blockedAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s must be blocked", s)
		}
	}
	for _, s := range []string{"93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"} {
		if blockedAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s must be allowed", s)
		}
	}
}

type fakeResolver struct {
	answers map[string][][]string // host → answer per call (last one repeats)
	calls   map[string]int
}

func (f *fakeResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	seq, ok := f.answers[host]
	if !ok {
		return nil, errors.New("nxdomain")
	}
	i := f.calls[host]
	if i >= len(seq) {
		i = len(seq) - 1
	}
	f.calls[host]++
	var out []net.IPAddr
	for _, s := range seq[i] {
		out = append(out, net.IPAddr{IP: net.ParseIP(s)})
	}
	return out, nil
}

func newResolver(m map[string][][]string) *fakeResolver {
	return &fakeResolver{answers: m, calls: map[string]int{}}
}

func TestBYOKBaseURLValidation(t *testing.T) {
	ctx := context.Background()
	c := NewBYOKClient(BYOKClientOptions{Resolver: newResolver(map[string][][]string{
		"public.example":   {{"93.184.216.34"}},
		"internal.example": {{"10.0.0.5"}},
		"mixed.example":    {{"93.184.216.34", "192.168.0.10"}},
		"v6local.example":  {{"fd00::5"}},
	})})
	if u, err := c.ValidateBYOKBaseURL(ctx, "https://public.example/v1#frag"); err != nil || u != "https://public.example/v1" {
		t.Fatalf("public: %q %v", u, err)
	}
	for _, raw := range []string{
		"http://public.example/v1",          // not https
		"https://user:pw@public.example/v1", // userinfo
		"https://internal.example/v1",       // private
		"https://mixed.example/v1",          // one private answer refuses the host
		"https://v6local.example/v1",        // ULA
		"https://127.0.0.1/v1",              // literal loopback
		"https://[::1]/v1",                  // literal v6 loopback
		"https://169.254.169.254/latest",    // metadata
		"ftp://public.example",              // scheme
		"",                                  // empty
	} {
		if _, err := c.ValidateBYOKBaseURL(ctx, raw); !errors.Is(err, ErrBaseURLRefused) {
			t.Errorf("%q: want refused, got %v", raw, err)
		}
	}
}

// vendorFixture is an httptest TLS server reached through the guard: the
// fake resolver answers a public address for example.com (in the test
// certificate) and the dial hook connects to the listener instead.
func vendorFixture(t *testing.T, h http.Handler, answers [][]string, opts BYOKClientOptions) (*BYOKClient, *httptest.Server) {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	opts.Resolver = newResolver(map[string][][]string{"example.com": answers})
	opts.TLSConfig = &tls.Config{RootCAs: pool}
	target := srv.Listener.Addr().String()
	opts.Dial = func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, target)
	}
	return NewBYOKClient(opts), srv
}

func TestBYOKClientStreamsEachProtocolWithItsKeyHeader(t *testing.T) {
	const key = "sk-secret-123456"
	cases := []struct {
		protocol BYOKProtocol
		path     string
		query    string
		check    func(r *http.Request) bool
	}{
		{ProtocolOpenAICompatible, "/v1/chat/completions", "", func(r *http.Request) bool {
			return r.Header.Get("Authorization") == "Bearer "+key
		}},
		{ProtocolAnthropic, "/v1/messages", "", func(r *http.Request) bool {
			return r.Header.Get("x-api-key") == key && r.Header.Get("anthropic-version") == "2023-06-01" && r.Header.Get("Authorization") == ""
		}},
		{ProtocolGemini, "/v1beta/models/gemini-3.8-flash:streamGenerateContent", "alt=sse", func(r *http.Request) bool {
			return r.Header.Get("x-goog-api-key") == key && r.Header.Get("Authorization") == ""
		}},
	}
	for _, tc := range cases {
		t.Run(string(tc.protocol), func(t *testing.T) {
			release := make(chan struct{})
			h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path || r.URL.RawQuery != tc.query || !tc.check(r) {
					w.WriteHeader(http.StatusTeapot)
					return
				}
				body, _ := io.ReadAll(r.Body)
				if string(body) != `{"model":"m","stream":true}` {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"n\":1}\n\n")
				w.(http.Flusher).Flush()
				<-release // the second chunk waits until the first was read
				_, _ = io.WriteString(w, "data: {\"n\":2}\n\n")
			})
			c, _ := vendorFixture(t, h, [][]string{{"93.184.216.34"}}, BYOKClientOptions{})
			base := "https://example.com/v1"
			path := strings.TrimPrefix(tc.path, "/v1")
			if tc.protocol == ProtocolAnthropic {
				base, path = "https://example.com", tc.path
			}
			if tc.protocol == ProtocolGemini {
				base, path = "https://example.com/v1beta", strings.TrimPrefix(tc.path, "/v1beta")
			}
			req := BYOKRequest{
				Provider: BYOKProvider{ID: "x", Protocol: tc.protocol}, BaseURL: base, APIKey: key,
				Method: http.MethodPost, Path: path, Body: []byte(`{"model":"m","stream":true}`), Stream: true,
			}
			if tc.query != "" {
				req.Query = map[string][]string{"alt": {"sse"}}
			}
			res, err := c.Do(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.Status != 200 {
				close(release)
				t.Fatalf("status %d", res.Status)
			}
			br := bufio.NewReader(res.Body)
			line, err := br.ReadString('\n')
			if err != nil || line != "data: {\"n\":1}\n" {
				t.Fatalf("first chunk %q %v", line, err)
			}
			close(release)
			rest, _ := io.ReadAll(br)
			if string(rest) != "\ndata: {\"n\":2}\n\n" {
				t.Fatalf("rest %q", rest)
			}
		})
	}
}

func TestBYOKClientRefusesRebindingAtDial(t *testing.T) {
	var hit atomic.Int32
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hit.Add(1) })
	// First answer (save-time validation) is public, the next (dial) private.
	c, _ := vendorFixture(t, h, [][]string{{"93.184.216.34"}, {"127.0.0.1"}}, BYOKClientOptions{})
	if _, err := c.ValidateBYOKBaseURL(context.Background(), "https://example.com/v1"); err != nil {
		t.Fatal(err)
	}
	_, err := c.Do(context.Background(), BYOKRequest{
		Provider: BYOKProvider{Protocol: ProtocolOpenAICompatible}, BaseURL: "https://example.com/v1",
		APIKey: "k", Method: http.MethodGet, Path: "/models",
	})
	if !errors.Is(err, ErrBaseURLRefused) {
		t.Fatalf("want refused at dial, got %v", err)
	}
	if strings.Contains(err.Error(), "example.com") {
		t.Fatalf("error leaks the url: %v", err)
	}
	if hit.Load() != 0 {
		t.Fatal("request reached the server")
	}
}

func TestBYOKClientDoesNotFollowRedirects(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			http.Redirect(w, r, "https://example.com/elsewhere", http.StatusFound)
			return
		}
		t.Error("redirect followed")
	})
	c, _ := vendorFixture(t, h, [][]string{{"93.184.216.34"}}, BYOKClientOptions{})
	res, err := c.Do(context.Background(), BYOKRequest{
		Provider: BYOKProvider{Protocol: ProtocolOpenAICompatible}, BaseURL: "https://example.com/v1",
		APIKey: "k", Method: http.MethodGet, Path: "/models",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.Status != http.StatusFound {
		t.Fatalf("status %d", res.Status)
	}
}

func TestBYOKClientIdleAndHeaderTimeouts(t *testing.T) {
	stop := make(chan struct{})
	defer close(stop) // before the server's Close cleanup, which waits for these handlers
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/slow-headers" {
			select {
			case <-stop:
			case <-r.Context().Done():
			}
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {}\n\n")
		w.(http.Flusher).Flush()
		select { // then goes quiet
		case <-stop:
		case <-r.Context().Done():
		}
	})
	c, _ := vendorFixture(t, h, [][]string{{"93.184.216.34"}}, BYOKClientOptions{
		HeaderTimeout: 150 * time.Millisecond, IdleTimeout: 150 * time.Millisecond,
	})
	req := BYOKRequest{
		Provider: BYOKProvider{Protocol: ProtocolOpenAICompatible}, BaseURL: "https://example.com/v1",
		APIKey: "k", Method: http.MethodPost, Path: "/slow-headers", Body: []byte(`{}`), Stream: true,
	}
	if _, err := c.Do(context.Background(), req); !errors.Is(err, ErrUnreachable) {
		t.Fatalf("header timeout: %v", err)
	}
	req.Path = "/quiet"
	res, err := c.Do(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	started := time.Now()
	_, err = io.ReadAll(res.Body)
	if !errors.Is(err, ErrUnreachable) {
		t.Fatalf("idle timeout: %v", err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("idle timeout did not fire")
	}
}
