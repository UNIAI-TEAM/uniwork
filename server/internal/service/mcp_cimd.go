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

const cimdMaxBytes = 16 << 10

type cimdFetcher struct{ client *http.Client }

// NewCIMDFetcher fetches over https on port 443 only, judges every dialled IP
// with netguard (so DNS rebinding to a private address is still refused), and
// never follows a redirect.
func NewCIMDFetcher() ClientMetadataFetcher {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		ap, err := netip.ParseAddrPort(address)
		if err != nil || ap.Port() != 443 || !netguard.AllowedIP(ap.Addr()) {
			return errCIMDNotAllowed
		}
		return nil
	}}
	transport := &http.Transport{
		Proxy:                  nil,
		DialContext:            dialer.DialContext,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  5 * time.Second,
		MaxResponseHeaderBytes: 16 << 10,
	}
	return &cimdFetcher{client: &http.Client{
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
	res, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, errCIMDNotAllowed) {
			return nil, errCIMDNotAllowed
		}
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("client metadata: status %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, cimdMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > cimdMaxBytes {
		return nil, errors.New("client metadata: document too large")
	}
	return body, nil
}
