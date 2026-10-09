package handler

import (
	"testing"
	"time"
)

func TestParseAdminBillingTimeRange(t *testing.T) {
	from, to := parseAdminBillingTimeRange("2026-10-01", "2026-10-08")
	if !from.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("from = %v", from)
	}
	wantTo := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	if !to.Equal(wantTo) {
		t.Fatalf("to = %v want %v", to, wantTo)
	}
}
