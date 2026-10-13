package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The offline lease counters (G5-08s, G5-D1 row 17): NewRegistry registers
// every family the lease service emits, and the labels are the closed
// operation and reason sets, never a tenant, person or document.
func TestOfficeLeaseMetricsAreRegistered(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	l := registry.OfficeLeases

	l.ObserveOfficeLease("grant")
	l.ObserveOfficeLease("renew")
	l.ObserveOfficeLeaseBlocked("epoch")
	l.ObserveOfficeLeasesRevoked("share_revoked", 3)
	l.ObserveOfficeLeaseSweep(5)

	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{
		`uniwork_office_offline_lease_grants_total{op="grant"} 1`,
		`uniwork_office_offline_lease_grants_total{op="renew"} 1`,
		`uniwork_office_offline_lease_blocked_total{reason="epoch"} 1`,
		`uniwork_office_offline_leases_revoked_total{reason="share_revoked"} 3`,
		"uniwork_office_offline_lease_sweep_deleted_total 5",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
}
