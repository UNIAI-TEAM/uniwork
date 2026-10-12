// Package netguard dials the IMAP/SMTP servers an email hub account names,
// refusing private, loopback, link-local, documentation and one-to-many
// group addresses so a user-supplied host cannot reach the internal network.
package netguard

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"syscall"
	"time"
)

// ErrHostNotAllowed deliberately names no host or IP: it reaches the client,
// and the connect form must not become a probe of internal DNS names.
var ErrHostNotAllowed = errors.New("email server address not allowed")

const dialTimeout = 15 * time.Second

// guard judges every connection attempt on the IP actually being dialled, so
// a name that rebinds to a private address after validation is still refused.
// Only this package's tests replace it; there is no switch to turn it off.
var guard = func(ip netip.Addr, port int) bool { return AllowedIP(ip) && AllowedPort(port) }

var blockedV4 = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"), // includes 255.255.255.255
}

var (
	globalUnicastV6 = netip.MustParsePrefix("2000::/3")
	blockedV6       = []netip.Prefix{
		netip.MustParsePrefix("2001::/32"),     // Teredo
		netip.MustParsePrefix("2001:db8::/32"), // documentation
		netip.MustParsePrefix("2002::/16"),     // 6to4
	}
	nat64WellKnown = netip.MustParsePrefix("64:ff9b::/96")
	nat64LocalUse  = netip.MustParsePrefix("64:ff9b:1::/48")
)

// NewDialer returns a TCP dialer that enforces the email-server address
// policy on every resolved IP. Callers choose the TCP connection timeout;
// protocol clients remain responsible for their handshake deadlines.
func NewDialer(timeout time.Duration) *net.Dialer {
	return &net.Dialer{Timeout: timeout, Control: control}
}

// Dial opens a TCP connection like net.Dialer.DialContext, refusing any
// resolved address or port the guard rejects.
func Dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d := NewDialer(dialTimeout)
	conn, err := d.DialContext(ctx, network, addr)
	if errors.Is(err, ErrHostNotAllowed) {
		// The *net.OpError around it prints the address; drop the wrapper.
		return nil, ErrHostNotAllowed
	}
	return conn, err
}

// control runs after DNS resolution, once per attempted IP, before connect.
func control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil || !guard(ap.Addr(), int(ap.Port())) {
		return ErrHostNotAllowed
	}
	return nil
}

// AllowedPort reports whether port is one of the standard IMAP/SMTP ports.
func AllowedPort(port int) bool {
	switch port {
	case 25, 143, 465, 587, 993:
		return true
	}
	return false
}

// AllowedIP reports whether ip is a public unicast address an email server
// may live on. IPv6 is an allowlist (2000::/3); NAT64 addresses are judged by
// the IPv4 address they embed.
func AllowedIP(ip netip.Addr) bool {
	ip = ip.WithZone("").Unmap()
	switch {
	case ip.Is4():
		return allowedV4(ip)
	case nat64WellKnown.Contains(ip):
		return allowedV4(embeddedV4(ip))
	case nat64LocalUse.Contains(ip):
		// shortcut: only the /96 form of the local-use NAT64 prefix is understood
		// and other RFC 6052 embeddings are refused; widen if a deployment needs them.
		b := ip.As16()
		for _, x := range b[6:12] {
			if x != 0 {
				return false
			}
		}
		return allowedV4(embeddedV4(ip))
	case !globalUnicastV6.Contains(ip):
		return false
	}
	for _, p := range blockedV6 {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func allowedV4(ip netip.Addr) bool {
	for _, p := range blockedV4 {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func embeddedV4(ip netip.Addr) netip.Addr {
	b := ip.As16()
	return netip.AddrFrom4([4]byte(b[12:16]))
}
