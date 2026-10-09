package provider

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ErrBaseURLRefused: the endpoint is not https, embeds credentials, or
// resolves to an address the server must never call (SSRF guard).
var ErrBaseURLRefused = errors.New("provider: base url refused")

// ErrUnreachable: the vendor could not be reached or stopped answering in
// time (connect, headers, idle or total budget).
var ErrUnreachable = errors.New("provider: vendor unreachable")

// Resolver is the DNS seam; *net.Resolver satisfies it.
type Resolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

// BYOKClientOptions configures the proxy transport. Zero values are the
// production defaults from contract D3/D4.
type BYOKClientOptions struct {
	Resolver Resolver
	// Dial connects to an address the guard already approved (ip:port).
	// Tests point it at an httptest listener; the guard still runs first.
	Dial      func(ctx context.Context, network, addr string) (net.Conn, error)
	TLSConfig *tls.Config
	// ConnectTimeout bounds dial + TLS; HeaderTimeout bounds the wait for
	// response headers on streaming and list calls (a non-streaming
	// completion only answers once the model is done, so it gets the total
	// budget instead); IdleTimeout is the longest gap between body chunks.
	ConnectTimeout time.Duration
	HeaderTimeout  time.Duration
	IdleTimeout    time.Duration
	TotalTimeout   time.Duration
}

// BYOKClient is the one outbound HTTP path to a vendor chosen by a person's
// stored credential. Every connection it opens passes the address guard at
// dial time, so a DNS answer that changes between save and use (rebinding)
// is refused too. Redirects are never followed.
type BYOKClient struct {
	http     *http.Client
	resolver Resolver
	opts     BYOKClientOptions
}

func NewBYOKClient(opts BYOKClientOptions) *BYOKClient {
	if opts.Resolver == nil {
		opts.Resolver = net.DefaultResolver
	}
	if opts.ConnectTimeout <= 0 {
		opts.ConnectTimeout = 15 * time.Second
	}
	if opts.HeaderTimeout <= 0 {
		opts.HeaderTimeout = 15 * time.Second
	}
	if opts.IdleTimeout <= 0 {
		opts.IdleTimeout = 60 * time.Second
	}
	if opts.TotalTimeout <= 0 {
		opts.TotalTimeout = 10 * time.Minute
	}
	if opts.Dial == nil {
		d := &net.Dialer{Timeout: opts.ConnectTimeout}
		opts.Dial = d.DialContext
	}
	c := &BYOKClient{resolver: opts.Resolver, opts: opts}
	tr := &http.Transport{
		Proxy:               nil, // an environment proxy would dial in our place and skip the guard
		DialContext:         c.dial,
		TLSClientConfig:     opts.TLSConfig,
		TLSHandshakeTimeout: opts.ConnectTimeout,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        64,
		IdleConnTimeout:     90 * time.Second,
	}
	c.http = &http.Client{
		Transport:     tr,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return c
}

// BYOKRequest is one pass-through call. Path is the vendor path below the
// base URL ("/chat/completions", "/v1/messages", "/models/x:generateContent").
type BYOKRequest struct {
	Provider BYOKProvider
	BaseURL  string // the credential's own; "" uses the table default
	APIKey   string
	Method   string
	Path     string
	Query    url.Values
	Body     []byte
	Stream   bool
	// Header is the client's own request headers. Only the per-protocol
	// allowlist in ForwardedRequestHeaders reaches the vendor.
	Header http.Header
}

// BYOKResponse is the vendor's answer. Body must be closed; closing it
// releases the request's timers and context.
type BYOKResponse struct {
	Status int
	Header http.Header
	Body   io.ReadCloser
}

// Do sends the request with the key injected the way the protocol expects.
// Errors wrap ErrBaseURLRefused or ErrUnreachable and never carry the key.
func (c *BYOKClient) Do(ctx context.Context, in BYOKRequest) (*BYOKResponse, error) {
	base := in.BaseURL
	if base == "" {
		base = in.Provider.DefaultBaseURL
	}
	if base == "" {
		return nil, fmt.Errorf("%w: base url required", ErrBaseURLRefused)
	}
	u, err := endpointURL(base, in.Path, in.Query)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, c.opts.TotalTimeout)
	req, err := http.NewRequestWithContext(ctx, in.Method, u, bytes.NewReader(in.Body))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("%w: %v", ErrBaseURLRefused, err)
	}
	if in.Body == nil {
		req.Body = http.NoBody
	}
	req.Header.Set("Content-Type", "application/json")
	if in.Stream {
		req.Header.Set("Accept", "text/event-stream")
	} else {
		req.Header.Set("Accept", "application/json")
	}
	for k, v := range ForwardedRequestHeaders(in.Header, in.Provider) {
		req.Header.Set(k, v)
	}
	injectKey(req.Header, in.Provider.Protocol, in.APIKey) // last: nothing the client sent can override it

	// Response-header budget: streaming answers start at once; a blocking
	// completion legitimately takes as long as the generation.
	var headerTimer *time.Timer
	if in.Stream || in.Method == http.MethodGet {
		headerTimer = time.AfterFunc(c.opts.HeaderTimeout, cancel)
	}
	res, err := c.http.Do(req)
	if headerTimer != nil {
		headerTimer.Stop()
	}
	if err != nil {
		cancel()
		if errors.Is(err, ErrBaseURLRefused) {
			return nil, fmt.Errorf("%w: address not allowed", ErrBaseURLRefused)
		}
		return nil, fmt.Errorf("%w: %s", ErrUnreachable, transportReason(err))
	}
	return &BYOKResponse{Status: res.StatusCode, Header: res.Header, Body: newIdleBody(res.Body, c.opts.IdleTimeout, cancel)}, nil
}

// maxForwardedHeaderValue bounds one forwarded header value.
const maxForwardedHeaderValue = 512

// ForwardedRequestHeaders picks the client request headers that may reach the
// vendor: an explicit allowlist per protocol (and per provider for the
// attribution headers OpenRouter reads). Anything else, above all
// authorization, x-api-key, x-goog-api-key and cookie, is dropped. Keys are
// canonical (textproto) names. A value with a control character is dropped.
func ForwardedRequestHeaders(in http.Header, p BYOKProvider) map[string]string {
	var allowed []string
	switch p.Protocol {
	case ProtocolAnthropic:
		allowed = []string{"Anthropic-Beta"}
	case ProtocolOpenAICompatible:
		allowed = []string{"Openai-Organization", "Openai-Project"}
		if p.ID == "openrouter" {
			allowed = append(allowed, "Http-Referer", "X-Title")
		}
	}
	out := map[string]string{}
	for _, name := range allowed {
		v := strings.TrimSpace(in.Get(name))
		if v == "" || len(v) > maxForwardedHeaderValue || strings.ContainsFunc(v, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
			continue
		}
		out[name] = v
	}
	return out
}

// injectKey is the whole difference between protocols on the way out.
func injectKey(h http.Header, p BYOKProtocol, key string) {
	if key == "" {
		return
	}
	switch p {
	case ProtocolAnthropic:
		h.Set("x-api-key", key)
		h.Set("anthropic-version", "2023-06-01")
	case ProtocolGemini:
		h.Set("x-goog-api-key", key)
	default:
		h.Set("Authorization", "Bearer "+key)
	}
}

// transportReason names the failure class without the URL or any header.
func transportReason(err error) string {
	var ne net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return "timeout"
	case errors.As(err, &ne) && ne.Timeout():
		return "timeout"
	default:
		return "connection failed"
	}
}

// endpointURL joins a base URL and a vendor path, keeping the base's query
// (Azure-style ?api-version=) and dropping any fragment.
func endpointURL(base, path string, query url.Values) (string, error) {
	u, err := parseBaseURL(base)
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawPath = ""
	if len(query) > 0 {
		vals := u.Query()
		for k, vs := range query {
			for _, v := range vs {
				vals.Add(k, v)
			}
		}
		u.RawQuery = vals.Encode()
	}
	return u.String(), nil
}

func parseBaseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return nil, fmt.Errorf("%w: empty or too long", ErrBaseURLRefused)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: not a url", ErrBaseURLRefused)
	}
	if u.Scheme != "https" {
		return nil, fmt.Errorf("%w: https only", ErrBaseURLRefused)
	}
	if u.User != nil {
		return nil, fmt.Errorf("%w: credentials in url", ErrBaseURLRefused)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("%w: no host", ErrBaseURLRefused)
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && blockedAddr(ip) {
		return nil, fmt.Errorf("%w: address not allowed", ErrBaseURLRefused)
	}
	u.Fragment = ""
	return u, nil
}

// ValidateBYOKBaseURL is the save-time check for a person's base URL:
// https, no userinfo, and every address the host resolves to is public.
// The dial-time check still runs on every request.
func (c *BYOKClient) ValidateBYOKBaseURL(ctx context.Context, raw string) (string, error) {
	u, err := parseBaseURL(raw)
	if err != nil {
		return "", err
	}
	if _, err := c.resolvePublic(ctx, u.Hostname()); err != nil {
		return "", err
	}
	return u.String(), nil
}

func (c *BYOKClient) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := c.resolvePublic(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := c.opts.Dial(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// resolvePublic returns the host's addresses only when every one is public:
// one private answer among public ones refuses the whole host, so a DNS
// server cannot smuggle an internal address into a round-robin set.
func (c *BYOKClient) resolvePublic(ctx context.Context, host string) ([]netip.Addr, error) {
	var ips []netip.Addr
	if ip, err := netip.ParseAddr(host); err == nil {
		ips = []netip.Addr{ip}
	} else {
		addrs, err := c.resolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("%w: dns", ErrUnreachable)
		}
		for _, a := range addrs {
			if ip, ok := netip.AddrFromSlice(a.IP); ok {
				ips = append(ips, ip.Unmap())
			}
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%w: no address", ErrUnreachable)
	}
	for _, ip := range ips {
		if blockedAddr(ip) {
			return nil, fmt.Errorf("%w: address not allowed", ErrBaseURLRefused)
		}
	}
	return ips, nil
}

var blockedPrefixes = func() []netip.Prefix {
	var out []netip.Prefix
	for _, s := range []string{
		"0.0.0.0/8",          // "this" network
		"100.64.0.0/10",      // CGNAT
		"192.0.0.0/24",       // IETF protocol assignments
		"198.18.0.0/15",      // benchmarking
		"240.0.0.0/4",        // reserved, incl. broadcast
		"224.0.0.0/4",        // group addresses (v4)
		"ff00::/8",           // group addresses (v6), incl. link- and interface-local scopes
		"64:ff9b::/96",       // NAT64: embeds an IPv4 address
		"64:ff9b:1::/48",     // local-use NAT64
		"2002::/16",          // 6to4: embeds an IPv4 address
		"2001::/32",          // Teredo
		"100::/64",           // discard-only
		"fec0::/10",          // deprecated site-local
		"169.254.169.254/32", // cloud metadata (also link-local; explicit for readers)
		"192.0.2.0/24",       // documentation (TEST-NET-1)
		"198.51.100.0/24",    // documentation (TEST-NET-2)
		"203.0.113.0/24",     // documentation (TEST-NET-3)
		"2001:db8::/32",      // documentation
		"::/96",              // IPv4-compatible (deprecated): embeds an IPv4 address
	} {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}()

// blockedAddr: loopback, private, link-local, CGNAT, group addresses,
// unspecified and the reserved ranges above, v4 and v6 (v4-mapped v6 is
// judged as the v4 it carries).
func blockedAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() {
		return true
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// idleBody cancels the request when the vendor goes quiet for longer than
// the idle budget between chunks, and releases the request on Close.
type idleBody struct {
	rc     io.ReadCloser
	timer  *time.Timer
	idle   time.Duration
	cancel context.CancelFunc
	once   sync.Once
}

func newIdleBody(rc io.ReadCloser, idle time.Duration, cancel context.CancelFunc) *idleBody {
	return &idleBody{rc: rc, timer: time.AfterFunc(idle, cancel), idle: idle, cancel: cancel}
}

func (b *idleBody) Read(p []byte) (int, error) {
	n, err := b.rc.Read(p)
	if n > 0 {
		b.timer.Reset(b.idle)
	}
	if err != nil && err != io.EOF {
		err = fmt.Errorf("%w: %s", ErrUnreachable, transportReason(err))
	}
	return n, err
}

func (b *idleBody) Close() error {
	var err error
	b.once.Do(func() {
		b.timer.Stop()
		err = b.rc.Close()
		b.cancel()
	})
	return err
}
