// Package linkpreview reads the card of a page a chat message links to: its
// Open Graph title, description, site name and picture (ADR 0035).
//
// It is the one path on which the server opens a connection to an address a
// person typed, so every connection passes the address guard: http or https
// on port 80 or 443 only, every address the host resolves to must be public,
// the socket dials the checked address and checks it again at connect time
// (DNS rebinding), and each redirect is checked like the first URL. Nothing is
// read past its cap, no cookie is kept, and the whole fetch has one deadline.
package linkpreview

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

var (
	// ErrBlocked: the URL, or an address it resolves or redirects to, is one
	// the server must never call (scheme, port, credentials, a non-public
	// address). Nothing was sent to it.
	ErrBlocked = errors.New("linkpreview: address not allowed")
	// ErrFailed: the page could not be read in time, is not HTML, or has no
	// card to show.
	ErrFailed = errors.New("linkpreview: fetch failed")
)

const (
	// UserAgent is the one header that names us; no cookie or credential is sent.
	UserAgent = "UniWorkLinkPreview/1.0 (+https://uniwork.vn)"
	// MaxHTMLBytes: only this much of a page is read; the card lives in its head.
	MaxHTMLBytes = 1 << 20
	// MaxImageBytes: a larger picture is dropped, never truncated.
	MaxImageBytes  = 2 << 20
	maxRedirects   = 3
	defaultTimeout = 5 * time.Second

	maxTitleRunes       = 300
	maxDescriptionRunes = 500
	maxSiteNameRunes    = 100
)

// ImageTypes is the picture allowlist, judged from the bytes, never the header.
var ImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// Resolver is the DNS seam; *net.Resolver satisfies it.
type Resolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

// Options configures a Fetcher. Zero values are the production defaults.
type Options struct {
	Resolver Resolver
	// Dial connects to an address the guard already approved (ip:port).
	// Tests point it at an httptest listener; the guard still runs first.
	Dial func(ctx context.Context, network, addr string) (net.Conn, error)
	// Timeout bounds the whole fetch, page and picture together.
	Timeout time.Duration
}

// Preview is a page's card.
type Preview struct {
	Title       string
	Description string
	// SiteName is og:site_name, or the host without "www." when the page has none.
	SiteName string
	// Image is the card's picture; nil when the page names none or it failed a check.
	Image *Image
}

// Image is a picture that passed the size cap and the type allowlist.
type Image struct {
	Bytes       []byte
	ContentType string
}

// Fetcher fetches cards. It is safe for concurrent use.
type Fetcher struct {
	client   *http.Client
	resolver Resolver
	dial     func(ctx context.Context, network, addr string) (net.Conn, error)
	timeout  time.Duration
}

func New(opts Options) *Fetcher {
	f := &Fetcher{resolver: opts.Resolver, dial: opts.Dial, timeout: opts.Timeout}
	if f.resolver == nil {
		f.resolver = net.DefaultResolver
	}
	if f.timeout <= 0 {
		f.timeout = defaultTimeout
	}
	if f.dial == nil {
		d := &net.Dialer{Timeout: f.timeout, Control: control}
		f.dial = d.DialContext
	}
	f.client = &http.Client{
		// No Jar: no cookie is stored or sent.
		Transport: &http.Transport{
			Proxy:                  nil, // an environment proxy would dial in our place and skip the guard
			DialContext:            f.guardedDial,
			TLSHandshakeTimeout:    f.timeout,
			ResponseHeaderTimeout:  f.timeout,
			MaxResponseHeaderBytes: 64 << 10,
			DisableKeepAlives:      true,
			ForceAttemptHTTP2:      true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return fmt.Errorf("%w: too many redirects", ErrFailed)
			}
			return checkURL(req.URL)
		},
	}
	return f
}

// Fetch reads the card of the page at rawURL and, when it names one, its
// picture. A picture that fails a check is dropped; the card keeps its text.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (Preview, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return Preview{}, fmt.Errorf("%w: url", ErrFailed)
	}
	if err := checkURL(u); err != nil {
		return Preview{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, f.timeout)
	defer cancel()
	resp, err := f.get(ctx, u.String(), "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
	if err != nil {
		return Preview{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	contentType := resp.Header.Get("Content-Type")
	if mt, _, _ := mime.ParseMediaType(contentType); mt != "text/html" && mt != "application/xhtml+xml" {
		return Preview{}, fmt.Errorf("%w: not html", ErrFailed)
	}
	body, err := charset.NewReader(io.LimitReader(resp.Body, MaxHTMLBytes), contentType)
	if err != nil {
		return Preview{}, fmt.Errorf("%w: charset", ErrFailed)
	}
	c := parseCard(body)
	p := Preview{
		Title:       clip(c.first("og:title", "twitter:title", "<title>"), maxTitleRunes),
		Description: clip(c.first("og:description", "twitter:description", "description"), maxDescriptionRunes),
		SiteName:    clip(c.first("og:site_name"), maxSiteNameRunes),
	}
	if p.Title == "" && p.Description == "" {
		return Preview{}, fmt.Errorf("%w: no card", ErrFailed)
	}
	if p.SiteName == "" {
		p.SiteName = strings.TrimPrefix(u.Hostname(), "www.")
	}
	if ref := c.first("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"); ref != "" {
		// Relative to the page it came from, after any redirect.
		if img, err := resp.Request.URL.Parse(strings.TrimSpace(ref)); err == nil {
			p.Image = f.image(ctx, img)
		}
	}
	return p, nil
}

func (f *Fetcher) image(ctx context.Context, u *url.URL) *Image {
	if checkURL(u) != nil {
		return nil
	}
	resp, err := f.get(ctx, u.String(), "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1")
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.ContentLength > MaxImageBytes {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxImageBytes+1))
	if err != nil || len(raw) > MaxImageBytes {
		return nil
	}
	ct := http.DetectContentType(raw)
	if _, ok := ImageTypes[ct]; !ok {
		return nil
	}
	return &Image{Bytes: raw, ContentType: ct}
}

func (f *Fetcher) get(ctx context.Context, rawURL, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: request", ErrFailed)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "vi,en;q=0.8")
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrBlocked) {
			return nil, ErrBlocked
		}
		return nil, fmt.Errorf("%w: %w", ErrFailed, err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: status %d", ErrFailed, resp.StatusCode)
	}
	return resp, nil
}

// checkURL is the guard on every URL before a request goes out, the first
// one and each redirect: http(s), the default ports, no credentials.
func checkURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrBlocked
	}
	if u.User != nil || u.Hostname() == "" {
		return ErrBlocked
	}
	switch u.Port() {
	case "", "80", "443":
		return nil
	}
	return ErrBlocked
}

func (f *Fetcher) guardedDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, ErrBlocked
	}
	if port != "80" && port != "443" {
		return nil, ErrBlocked
	}
	ips, err := f.resolve(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := f.dial(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// resolve returns the host's addresses only when every one is public: one
// private answer among public ones refuses the whole host, so a DNS server
// cannot smuggle an internal address into a round-robin set.
func (f *Fetcher) resolve(ctx context.Context, host string) ([]netip.Addr, error) {
	var ips []netip.Addr
	if ip, err := netip.ParseAddr(host); err == nil {
		ips = []netip.Addr{ip}
	} else {
		addrs, err := f.resolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("%w: dns", ErrFailed)
		}
		for _, a := range addrs {
			if ip, ok := netip.AddrFromSlice(a.IP); ok {
				ips = append(ips, ip.Unmap())
			}
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%w: no address", ErrFailed)
	}
	for _, ip := range ips {
		if !netguard.AllowedIP(ip) {
			return nil, ErrBlocked
		}
	}
	return ips, nil
}

// control re-checks the address the socket actually connects to.
func control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil || !netguard.AllowedIP(ap.Addr()) {
		return ErrBlocked
	}
	return nil
}

// card is a page's meta tags by lowercased property or name (the first of
// each wins), plus its <title> under the key "<title>".
type card map[string]string

func (c card) first(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(c[k]); v != "" {
			return v
		}
	}
	return ""
}

func parseCard(r io.Reader) card {
	c := card{}
	z := html.NewTokenizer(r)
	inTitle := false
	for {
		switch z.Next() {
		case html.ErrorToken:
			return c
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "title":
				inTitle = c["<title>"] == ""
			case "meta":
				var property, nameAttr, content string
				for hasAttr {
					var k, v []byte
					k, v, hasAttr = z.TagAttr()
					switch string(k) {
					case "property":
						property = string(v)
					case "name":
						nameAttr = string(v)
					case "content":
						content = string(v)
					}
				}
				key := strings.ToLower(strings.TrimSpace(property))
				if key == "" {
					key = strings.ToLower(strings.TrimSpace(nameAttr))
				}
				if _, seen := c[key]; key != "" && !seen {
					c[key] = content
				}
			}
		case html.TextToken:
			if inTitle {
				c["<title>"] += string(z.Text())
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); string(name) == "title" {
				inTitle = false
			}
		}
	}
}

// clip folds whitespace and cuts s to max runes, ending a cut with "…".
func clip(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return strings.TrimSpace(string(r[:max-1])) + "…"
}
