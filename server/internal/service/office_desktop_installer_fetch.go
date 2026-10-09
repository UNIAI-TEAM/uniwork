package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"syscall"
	"time"
)

// A GitHub release asset URL answers 302 to a signed URL on a GitHub objects
// host. That is the only redirect a bundle download follows: one hop, from
// https://github.com/<owner>/<repo>/releases/download/<tag>/<file>, to an
// HTTPS host listed in OFFICE_INSTALLER_REDIRECT_HOSTS that resolves to a
// public address. Plain (non-bundle) downloads never reach this code.
var githubReleaseAssetPath = regexp.MustCompile(`^/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/releases/download/[^/]+/[^/]+$`)

var errInstallerRedirectRefused = coded(http.StatusBadGateway, "installer_unavailable", "installer redirect is not allowed")

func (s *OfficeDesktopDownloadService) fetchInstaller(ctx context.Context, source *url.URL) (*http.Response, error) {
	first, err := getWithoutRedirects(ctx, s.installerTransport, source.String())
	if err != nil {
		return nil, coded(http.StatusBadGateway, "installer_unavailable", "installer download failed")
	}
	if !isRedirect(first.StatusCode) {
		return first, nil
	}
	_ = first.Body.Close()
	if !githubReleaseAsset(source) {
		return nil, errInstallerRedirectRefused
	}
	target, err := source.Parse(first.Header.Get("Location"))
	if err != nil || target.Scheme != "https" || target.User != nil || (target.Port() != "" && target.Port() != "443") || !s.redirectHostAllowed(target.Hostname()) {
		return nil, errInstallerRedirectRefused
	}
	transport := s.redirectTransport
	if transport == nil {
		transport = publicOnlyTransport()
	}
	second, err := getWithoutRedirects(ctx, transport, target.String())
	if err != nil {
		return nil, coded(http.StatusBadGateway, "installer_unavailable", "installer download failed")
	}
	if isRedirect(second.StatusCode) {
		_ = second.Body.Close()
		return nil, errInstallerRedirectRefused
	}
	return second, nil
}

func getWithoutRedirects(ctx context.Context, transport http.RoundTripper, rawURL string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	return client.Do(request)
}

func isRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	}
	return false
}

func githubReleaseAsset(u *url.URL) bool {
	return u.Scheme == "https" && strings.EqualFold(u.Hostname(), "github.com") && u.Port() == "" && githubReleaseAssetPath.MatchString(u.Path)
}

func (s *OfficeDesktopDownloadService) redirectHostAllowed(host string) bool {
	host = strings.ToLower(host)
	for _, allowed := range s.cfg.OfficeInstallerRedirectHosts {
		if host == allowed {
			return true
		}
	}
	return false
}

// publicOnlyTransport dials the redirect target directly (no proxy, so the
// address checked is the address connected to) and refuses loopback,
// private, link-local and other non-public IPs after DNS resolution, which
// also covers an allowlisted name that resolves somewhere internal.
func publicOnlyTransport() *http.Transport {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		if ip, err := netip.ParseAddr(host); err != nil || !publicAddr(ip) {
			return fmt.Errorf("installer redirect to a non-public address is refused")
		}
		return nil
	}}
	return &http.Transport{DialContext: dialer.DialContext, ForceAttemptHTTP2: true, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 30 * time.Second}
}

var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("64:ff9b::/96"),
}

func publicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range nonPublicPrefixes {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}
