package service

import (
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestOfficeLaunchTicketIssuerAndHash(t *testing.T) {
	a, err := randomLaunchTicket()
	if err != nil {
		t.Fatal(err)
	}
	b, err := randomLaunchTicket()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || !strings.HasPrefix(a, "ticket_") || len(a) < 39 {
		t.Fatalf("tickets must be opaque ticket_ values: %q %q", a, b)
	}
	if hashLaunchTicket(a) == a || hashLaunchTicket(a) == hashLaunchTicket(b) {
		t.Fatal("ticket hash must be deterministic and distinct from the raw value")
	}
}

func TestOfficeLaunchConfigDefaultsAndAllowlist(t *testing.T) {
	s := NewOfficeLaunchService(nil, config.Config{})
	if !s.allowed("uniwork-office", "default") || s.allowed("other-client", "default") || s.allowed("uniwork-office", "other") {
		t.Fatal("default client/deployment allowlist is not enforced")
	}
	s.SetClock(func() time.Time { return time.Unix(100, 0) })
	if got := s.now(); !got.Equal(time.Unix(100, 0)) {
		t.Fatalf("clock injection failed: %v", got)
	}
}

func TestOfficeLaunchAllowsEveryConfiguredDesktopClient(t *testing.T) {
	s := NewOfficeLaunchService(nil, config.Config{
		DesktopAuthClients: []config.DesktopAuthClient{
			{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}},
			{ID: "uniwork-office-dev", RedirectURIs: []string{"uniwork-office-dev://auth/callback"}},
		},
		DesktopAuthDeploymentIDs: []string{"default"},
	})
	if !s.allowed("uniwork-office", "default") || !s.allowed("uniwork-office-dev", "default") || s.allowed("uniwork-office-beta", "default") {
		t.Fatal("launch allowlist does not follow DESKTOP_AUTH_CLIENTS")
	}
}
