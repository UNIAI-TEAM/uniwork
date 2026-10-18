package linkpreview

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// stubResolver answers from a table; an unknown host is a DNS failure.
type stubResolver map[string][]string

func (s stubResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	ips, ok := s[host]
	if !ok {
		return nil, errors.New("no such host")
	}
	out := make([]net.IPAddr, 0, len(ips))
	for _, ip := range ips {
		out = append(out, net.IPAddr{IP: net.ParseIP(ip)})
	}
	return out, nil
}

// harness serves one httptest handler behind any approved address and
// records what was dialled and requested.
type harness struct {
	t      *testing.T
	srv    *httptest.Server
	mu     sync.Mutex
	dialed []string
	reqs   []*http.Request
}

func newHarness(t *testing.T, h http.HandlerFunc) *harness {
	t.Helper()
	hs := &harness{t: t}
	hs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hs.mu.Lock()
		hs.reqs = append(hs.reqs, r.Clone(context.Background()))
		hs.mu.Unlock()
		h(w, r)
	}))
	t.Cleanup(hs.srv.Close)
	return hs
}

func (hs *harness) fetcher(resolver stubResolver) *Fetcher {
	return New(Options{
		Resolver: resolver,
		Timeout:  2 * time.Second,
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			hs.mu.Lock()
			hs.dialed = append(hs.dialed, addr)
			hs.mu.Unlock()
			var d net.Dialer
			return d.DialContext(ctx, network, hs.srv.Listener.Addr().String())
		},
	})
}

var public = stubResolver{
	"news.test":     {"93.184.216.34"},
	"www.news.test": {"93.184.216.34"},
	"cdn.test":      {"151.101.1.69"},
	"internal.test": {"10.0.0.7"},
	"mixed.test":    {"93.184.216.34", "127.0.0.1"},
	"meta.test":     {"169.254.169.254"},
	"ula.test":      {"fd12:3456::1"},
	"cgnat.test":    {"100.64.0.9"},
}

// pngBytes sniffs as image/png.
var pngBytes = append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), bytes.Repeat([]byte{0}, 64)...)

func html200(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(body))
	}
}

func TestFetchReadsOpenGraphAndResolvesARelativeImage(t *testing.T) {
	hs := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/blog/ra-mat-q4":
			html200(`<!doctype html><html><head>
<title>Fallback title</title>
<meta property="og:title" content="UniWork Q4: làm việc cùng AI cho đội nhóm Việt">
<meta property="og:description" content="Việc, cuộc họp, tài liệu   và quy trình &amp; một nơi.">
<meta property="og:site_name" content="UniWork">
<meta property="og:image" content="../img/q4.png">
</head><body></body></html>`)(w, r)
		case "/img/q4.png":
			w.Header().Set("Content-Type", "application/octet-stream") // the bytes decide, not the header
			_, _ = w.Write(pngBytes)
		default:
			http.NotFound(w, r)
		}
	})
	p, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/blog/ra-mat-q4")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if p.Title != "UniWork Q4: làm việc cùng AI cho đội nhóm Việt" {
		t.Errorf("title = %q", p.Title)
	}
	if p.Description != "Việc, cuộc họp, tài liệu và quy trình & một nơi." {
		t.Errorf("description = %q", p.Description)
	}
	if p.SiteName != "UniWork" {
		t.Errorf("site name = %q", p.SiteName)
	}
	if p.Image == nil || p.Image.ContentType != "image/png" || !bytes.Equal(p.Image.Bytes, pngBytes) {
		t.Fatalf("image = %+v", p.Image)
	}
	if len(hs.reqs) != 2 || hs.reqs[1].URL.Path != "/img/q4.png" {
		t.Fatalf("requests = %v", paths(hs.reqs))
	}
	for _, r := range hs.reqs {
		if r.Header.Get("User-Agent") != UserAgent || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Errorf("request headers = %v", r.Header)
		}
	}
	for _, addr := range hs.dialed {
		if addr != "93.184.216.34:80" {
			t.Errorf("dialled %s, want the checked address", addr)
		}
	}
}

func TestFetchFallsBackToTitleDescriptionAndHost(t *testing.T) {
	hs := newHarness(t, html200(`<html><head><title> Trang  chủ </title>
<meta name="description" content="Mô tả ngắn"></head></html>`))
	p, err := hs.fetcher(public).Fetch(context.Background(), "http://www.news.test/")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if p.Title != "Trang chủ" || p.Description != "Mô tả ngắn" || p.SiteName != "news.test" || p.Image != nil {
		t.Fatalf("preview = %+v", p)
	}
}

func TestFetchDecodesTheDeclaredCharset(t *testing.T) {
	hs := newHarness(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=windows-1252")
		_, _ = w.Write([]byte("<title>Caf\xe9 S\xe0i G\xf2n</title>"))
	})
	p, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if p.Title != "Café Sài Gòn" {
		t.Fatalf("title = %q", p.Title)
	}
}

func TestFetchRefusesBlockedAddressesWithoutDialling(t *testing.T) {
	for _, raw := range []string{
		"http://127.0.0.1:18959/",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://10.1.2.3/",
		"http://internal.test/",
		"http://mixed.test/",
		"http://meta.test/",
		"http://ula.test/",
		"http://cgnat.test/",
		"http://news.test:8080/",
		"https://news.test:22/",
		"ftp://news.test/",
		"file:///etc/passwd",
		"http://user:pass@news.test/",
	} {
		t.Run(raw, func(t *testing.T) {
			hs := newHarness(t, html200("<title>x</title>"))
			_, err := hs.fetcher(public).Fetch(context.Background(), raw)
			if !errors.Is(err, ErrBlocked) {
				t.Fatalf("err = %v, want ErrBlocked", err)
			}
			if len(hs.dialed) != 0 || len(hs.reqs) != 0 {
				t.Fatalf("dialled %v, requested %v", hs.dialed, paths(hs.reqs))
			}
		})
	}
}

func TestFetchRechecksEveryRedirect(t *testing.T) {
	for _, target := range []string{"http://internal.test/admin", "http://127.0.0.1/", "http://news.test:6379/", "gopher://news.test/"} {
		t.Run(target, func(t *testing.T) {
			hs := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, target, http.StatusFound)
			})
			_, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/go")
			if !errors.Is(err, ErrBlocked) {
				t.Fatalf("err = %v, want ErrBlocked", err)
			}
			if len(hs.reqs) != 1 {
				t.Fatalf("requests = %v, want only the first", paths(hs.reqs))
			}
		})
	}
}

func TestFetchFollowsAtMostThreeRedirects(t *testing.T) {
	hs := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.URL.Path+"/r", http.StatusFound)
	})
	// Three hops land: /a → /b → /c → /d.
	ok := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/a":
			http.Redirect(w, r, "/b", http.StatusFound)
		case "/b":
			http.Redirect(w, r, "/c", http.StatusMovedPermanently)
		case "/c":
			http.Redirect(w, r, "/d", http.StatusTemporaryRedirect)
		default:
			html200("<title>đích</title>")(w, r)
		}
	})
	if p, err := ok.fetcher(public).Fetch(context.Background(), "http://news.test/a"); err != nil || p.Title != "đích" {
		t.Fatalf("three redirects: %+v, %v", p, err)
	}
	// A fourth is refused, and not as a blocked address.
	_, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/r")
	if !errors.Is(err, ErrFailed) || errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrFailed", err)
	}
	if len(hs.reqs) != 4 {
		t.Fatalf("requests = %v, want 4", paths(hs.reqs))
	}
}

func TestFetchRefusesWhatIsNotACard(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"json": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"title":"x"}`))
		},
		"image": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes)
		},
		"404":      func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) },
		"no card":  html200("<html><body><p>chỉ có chữ</p></body></html>"),
		"past cap": html200(strings.Repeat(" ", MaxHTMLBytes) + "<title>quá xa</title>"),
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			hs := newHarness(t, h)
			_, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/")
			if !errors.Is(err, ErrFailed) || errors.Is(err, ErrBlocked) {
				t.Fatalf("err = %v, want ErrFailed", err)
			}
		})
	}
}

func TestFetchDropsAnImageThatFailsACheck(t *testing.T) {
	cases := map[string]struct {
		ref   string
		image http.HandlerFunc
	}{
		"oversize": {"/big.png", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(append(pngBytes, make([]byte, MaxImageBytes)...))
		}},
		"svg": {"/x.svg", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
		}},
		"private host": {"http://internal.test/x.png", nil},
		"bad port":     {"http://cdn.test:8443/x.png", nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			hs := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/" {
					html200(`<meta property="og:title" content="Có ảnh"><meta property="og:image" content="`+tc.ref+`">`)(w, r)
					return
				}
				tc.image(w, r)
			})
			p, err := hs.fetcher(public).Fetch(context.Background(), "http://news.test/")
			if err != nil {
				t.Fatalf("Fetch: %v", err)
			}
			if p.Title != "Có ảnh" || p.Image != nil {
				t.Fatalf("preview = %+v, want the text without the image", p)
			}
		})
	}
}

func TestFetchGivesUpAtTheDeadline(t *testing.T) {
	release := make(chan struct{})
	hs := newHarness(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	defer close(release)
	f := hs.fetcher(public)
	f.timeout = 100 * time.Millisecond
	start := time.Now()
	_, err := f.Fetch(context.Background(), "http://news.test/slow")
	if !errors.Is(err, ErrFailed) {
		t.Fatalf("err = %v, want ErrFailed", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %v", time.Since(start))
	}
}

func TestControlRefusesNonPublicAddresses(t *testing.T) {
	for addr, want := range map[string]error{
		"127.0.0.1:80":       ErrBlocked,
		"169.254.169.254:80": ErrBlocked,
		"[fd00::1]:443":      ErrBlocked,
		"93.184.216.34:443":  nil,
	} {
		if err := control("tcp", addr, nil); !errors.Is(err, want) || (want == nil && err != nil) {
			t.Errorf("control(%s) = %v, want %v", addr, err, want)
		}
	}
}

func TestClipFoldsAndCuts(t *testing.T) {
	if got := clip("  a \n\t b  ", 10); got != "a b" {
		t.Errorf("clip = %q", got)
	}
	if got := clip(strings.Repeat("ệ", 12), 10); got != strings.Repeat("ệ", 9)+"…" {
		t.Errorf("clip = %q", got)
	}
}

func paths(reqs []*http.Request) []string {
	out := make([]string, 0, len(reqs))
	for _, r := range reqs {
		out = append(out, r.URL.Path)
	}
	return out
}
