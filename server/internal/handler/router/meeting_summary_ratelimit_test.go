package router

import (
	"net/http"
	"testing"
)

// POST /meetings/{id}/summary pays the model for a whole meeting, so it has
// its own budget (UNI-1853 M9): 6 a minute per signed-in person on the
// ai-meeting-summary bucket, one budget across every meeting id, refused with
// the default rate_limited and Retry-After: 60. Another person behind the
// same address keeps a whole budget, and the routes beside it (reading the
// summary, turning it into tasks) never draw on it.
func TestMeetingSummaryUsesOwnLimiterBucket(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.51"
	alice := caller{ip: office, bearer: mustMint(t, minter, "user-a")}

	alice.spend(t, h, http.MethodPost, "/api/v1/meetings/m1/summary", 3)
	alice.spend(t, h, http.MethodPost, "/api/v1/meetings/m2/summary", 3)
	refused := alice.sendRec(h, http.MethodPost, "/api/v1/meetings/m3/summary")
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("the 7th summary in a minute: status %d, want 429 (one ai-meeting-summary budget across every meeting)", refused.Code)
	}
	if code := refusalCode(t, refused); code != "rate_limited" {
		t.Fatalf("refusal code = %q, want rate_limited", code)
	}
	if retry := refused.Header().Get("Retry-After"); retry != "60" {
		t.Fatalf("Retry-After = %q, want 60", retry)
	}

	caller{ip: office, bearer: mustMint(t, minter, "user-b")}.spend(t, h, http.MethodPost, "/api/v1/meetings/m1/summary", 6)

	alice.spend(t, h, http.MethodGet, "/api/v1/meetings/m1/summary", 10)
	alice.spend(t, h, http.MethodPost, "/api/v1/meetings/m1/summary/tasks", 10)
}
