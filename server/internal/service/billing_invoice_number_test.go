package service

import (
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func TestInvoiceNumberUniqueAndICTYear(t *testing.T) {
	at := time.Date(2026, 6, 1, 2, 0, 0, 0, time.UTC)
	seen := map[string]struct{}{}
	for i := 0; i < 1000; i++ {
		n := invoiceNumber(at, util.NewID())
		if _, ok := seen[n]; ok {
			t.Fatalf("duplicate invoice number %s", n)
		}
		seen[n] = struct{}{}
		if !strings.HasPrefix(n, "UW-2026-") || len(n) != len("UW-2026-")+16 {
			t.Fatalf("invoice number %q", n)
		}
	}
	ny := invoiceNumber(time.Date(2026, 12, 31, 22, 0, 0, 0, time.UTC), util.NewID())
	if !strings.HasPrefix(ny, "UW-2027-") {
		t.Fatalf("invoice number %q, want a 2027 prefix", ny)
	}
}
