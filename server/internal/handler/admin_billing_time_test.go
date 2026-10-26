package handler

import (
	"testing"
	"time"
)

func TestParseAdminBillingTimeRange(t *testing.T) {
	from, _ := parseAdminBillingTimeRange("2026-10-12", "")
	wantFrom := time.Date(2026, 10, 11, 17, 0, 0, 0, time.UTC)
	if !from.Equal(wantFrom) {
		t.Fatalf("from = %v want %v", from, wantFrom)
	}
	_, to := parseAdminBillingTimeRange("", "2026-10-08")
	wantTo := time.Date(2026, 10, 8, 17, 0, 0, 0, time.UTC)
	if !to.Equal(wantTo) {
		t.Fatalf("to = %v want %v", to, wantTo)
	}
}
