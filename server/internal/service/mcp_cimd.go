package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

// ClientMetadataFetcher reads a Client ID Metadata Document. Tests replace it;
// production uses NewCIMDFetcher.
type ClientMetadataFetcher interface {
	Fetch(ctx context.Context, url string) ([]byte, error)
}

// errCIMDNotAllowed names no host or address: it can reach a log line and the
// document URL is attacker-chosen.
var errCIMDNotAllowed = errors.New("client metadata address not allowed")

// errCIMDRejected marks a definitive answer from the host (a withdrawn document,
// a redirect, a client error, a document over cimdMaxBytes). A transient failure (transport, timeout, 5xx,
// 408, 429) is a plain error so resolveCIMD may serve its cached row instead.
var errCIMDRejected = errors.New("client metadata rejected")

const cimdMaxBytes = 16 << 10

// cimdStatusError classifies a non-200 status. It names no host or URL.
func cimdStatusError(code int) error {
	if code >= 500 || code == http.StatusRequestTimeout || code == http.StatusTooManyRequests {
		return fmt.Errorf("client metadata: transient status %d", code)
	}
	return fmt.Errorf("%w: status %d", errCIMDRejected, code)
}

type cimdFetcher struct {
	client    *http.Client
	userAgent string
}

// NewCIMDFetcher fetches over https on port 443 only, judges every dialled IP
// with netguard (so DNS rebinding to a private address is still refused), and
// never follows a redirect. Its User-Agent names the product and, for the
// document's host to reach the operator, the public frontend origin; nothing
// secret.
func NewCIMDFetcher(frontendOrigin string) ClientMetadataFetcher {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		ap, err := netip.ParseAddrPort(address)
		if err != nil || ap.Port() != 443 || !netguard.AllowedIP(ap.Addr()) {
			return errCIMDNotAllowed
		}
		return nil
	}}
	transport := &http.Transport{
		Proxy:                  nil,
		DisableKeepAlives:      true, // fetches are rare and short-lived, so connection reuse buys nothing; an idle connection per attacker-chosen host would only leak fds
		DialContext:            dialer.DialContext,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  5 * time.Second,
		MaxResponseHeaderBytes: 16 << 10,
	}
	ua := "UniWork-MCP-CIMD/1"
	if origin := strings.TrimRight(frontendOrigin, "/"); origin != "" {
		ua += " (+" + origin + ")"
	}
	return &cimdFetcher{userAgent: ua, client: &http.Client{
		Transport:     transport,
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (f *cimdFetcher) Fetch(ctx context.Context, raw string) ([]byte, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || (u.Port() != "" && u.Port() != "443") {
		return nil, errCIMDNotAllowed
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", f.userAgent)
	res, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, errCIMDNotAllowed) {
			return nil, errCIMDNotAllowed
		}
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, cimdStatusError(res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, cimdMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > cimdMaxBytes {
		// The host's definitive answer, like a 4xx: a cached row must not
		// keep the client alive behind it.
		return nil, fmt.Errorf("%w: document too large", errCIMDRejected)
	}
	return body, nil
}
