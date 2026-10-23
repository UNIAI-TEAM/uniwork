package netguard

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"testing"
)

func TestAllowedIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		// IPv4 public, including the neighbours of blocked ranges.
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"142.250.4.108", true},
		{"100.63.255.255", true},
		{"100.128.0.0", true},
		{"172.15.255.255", true},
		{"172.32.0.0", true},
		{"198.17.255.255", true},
		{"198.20.0.0", true},
		{"223.255.255.255", true},
		// Every blocked IPv4 range.
		{"0.0.0.0", false},
		{"0.255.255.255", false},
		{"10.0.0.1", false},
		{"10.255.255.255", false},
		{"100.64.0.0", false},
		{"100.127.255.255", false},
		{"127.0.0.1", false},
		{"127.255.255.254", false},
		{"169.254.0.1", false},
		{"169.254.169.254", false},
		{"172.16.0.1", false},
		{"172.31.255.255", false},
		{"192.0.0.8", false},
		{"192.0.2.1", false},
		{"192.168.0.1", false},
		{"192.168.255.255", false},
		{"198.18.0.1", false},
		{"198.19.255.255", false},
		{"198.51.100.7", false},
		{"203.0.113.9", false},
		{"224.0.0.1", false},
		{"239.255.255.255", false},
		{"240.0.0.1", false},
		{"255.255.255.255", false},
		// IPv4-mapped ::ffff:0:0/96 is judged as IPv4.
		{"::ffff:8.8.8.8", true},
		{"::ffff:127.0.0.1", false},
		{"::ffff:10.0.0.1", false},
		{"::ffff:169.254.169.254", false},
		// Unspecified, loopback and IPv4-compatible ::/96.
		{"::", false},
		{"::1", false},
		{"::8.8.8.8", false},
		{"::127.0.0.1", false},
		// NAT64 well-known 64:ff9b::/96.
		{"64:ff9b::808:808", true},
		{"64:ff9b::7f00:1", false},
		{"64:ff9b::a00:1", false},
		{"64:ff9b::a9fe:a9fe", false},
		// NAT64 local-use 64:ff9b:1::/48, /96 form only.
		{"64:ff9b:1::808:808", true},
		{"64:ff9b:1::7f00:1", false},
		{"64:ff9b:1::c0a8:1", false},
		{"64:ff9b:1:808:8::", false},
		// 6to4, Teredo and documentation inside 2000::/3.
		{"2002:808:808::1", false},
		{"2002:7f00:1::1", false},
		{"2001::1", false},
		{"2001:0:4136:e378:8000:63bf:3fff:fdd2", false},
		{"2001:db8::1", false},
		// Public 2000::/3.
		{"2607:f8b0:4023:c06::6c", true},
		{"2a00:1450:400c:c0a::6d", true},
		{"2001:4860:4860::8888", true},
		{"3fff:ffff::1", true},
		// Everything outside 2000::/3.
		{"100::1", false},
		{"fc00::1", false},
		{"fd12:3456::1", false},
		{"fe80::1", false},
		{"fe80::1%en0", false},
		{"fec0::1", false},
		{"ff02::1", false},
		{"4000::1", false},
		{"1fff:ffff::1", false},
	}
	for _, tc := range cases {
		t.Run(tc.ip, func(t *testing.T) {
			if got := AllowedIP(netip.MustParseAddr(tc.ip)); got != tc.want {
				t.Fatalf("AllowedIP(%s) = %v, want %v", tc.ip, got, tc.want)
			}
		})
	}
	if AllowedIP(netip.Addr{}) {
		t.Fatal("the zero Addr must not be allowed")
	}
}

func TestAllowedPort(t *testing.T) {
	for _, p := range []int{25, 143, 465, 587, 993} {
		if !AllowedPort(p) {
			t.Errorf("AllowedPort(%d) = false, want true", p)
		}
	}
	for _, p := range []int{0, 22, 80, 110, 443, 995, 2525, 5432, 6379, 8080, 65535} {
		if AllowedPort(p) {
			t.Errorf("AllowedPort(%d) = true, want false", p)
		}
	}
}

// assertRefused checks the error is exactly ErrHostNotAllowed and names
// neither the host nor any address it resolved to.
func assertRefused(t *testing.T, err error, leaks ...string) {
	t.Helper()
	if !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("err = %v, want ErrHostNotAllowed", err)
	}
	if err.Error() != ErrHostNotAllowed.Error() {
		t.Fatalf("err %q carries more than ErrHostNotAllowed", err)
	}
	for _, s := range leaks {
		if strings.Contains(err.Error(), s) {
			t.Fatalf("err %q leaks %q", err, s)
		}
	}
}

func TestDialRefusesBlockedIPLiteral(t *testing.T) {
	conn, err := Dial(context.Background(), "tcp", "127.0.0.1:993")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "127.0.0.1", "993")
}

func TestDialRefusesHostnameResolvingToBlockedIP(t *testing.T) {
	var seen []netip.Addr
	prev := guard
	guard = func(ip netip.Addr, port int) bool {
		seen = append(seen, ip)
		return prev(ip, port)
	}
	t.Cleanup(func() { guard = prev })

	conn, err := Dial(context.Background(), "tcp", "localhost:993")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "localhost", "127.0.0.1", "::1")
	if len(seen) == 0 {
		t.Fatal("guard never saw a resolved IP")
	}
	for _, ip := range seen {
		if !ip.Unmap().IsLoopback() {
			t.Fatalf("guard saw %s, want the resolved loopback IP", ip)
		}
	}
}

func TestDialRefusesPortOutsideSet(t *testing.T) {
	// The guard runs before connect(), so nothing is sent to 8.8.8.8.
	conn, err := Dial(context.Background(), "tcp", "8.8.8.8:80")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "8.8.8.8", "80")
}

func TestDialConnectsWhenGuardAllows(t *testing.T) {
	prev := guard
	guard = func(netip.Addr, int) bool { return true }
	t.Cleanup(func() { guard = prev })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		if c, err := ln.Accept(); err == nil {
			_ = c.Close()
		}
	}()

	conn, err := Dial(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	_ = conn.Close()
}

func TestDialPassesOtherErrorsThrough(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Dial(ctx, "tcp", "8.8.8.8:993")
	if errors.Is(err, ErrHostNotAllowed) || !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
