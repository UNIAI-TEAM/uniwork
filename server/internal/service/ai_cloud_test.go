package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// For an entitled organization: enabled is "some cloud tool or chat can run";
// spent credits read as reason credits_exhausted with enabled kept true, so
// the client shows the credits-exhausted state, and chat stays whatever the
// configuration and flags say (the turn itself answers 402).
func TestCloudStateCreditsExhaustedKeepsChat(t *testing.T) {
	zero, some := int64(0), int64(10)
	cases := []struct {
		name        string
		tools       ai.CloudAvailability
		chat        bool
		credits     CloudCredits
		wantEnabled bool
		wantReason  string
	}{
		{"nothing configured", ai.CloudAvailability{}, false, CloudCredits{}, false, "cloud_unavailable"},
		{"chat only", ai.CloudAvailability{}, true, CloudCredits{Remaining: &some}, true, ""},
		{"tools, credits left", ai.CloudAvailability{WebSearch: true}, false, CloudCredits{Remaining: &some}, true, ""},
		{"unlimited plan", ai.CloudAvailability{WebSearch: true}, true, CloudCredits{}, true, ""},
		{"credits spent, chat on", ai.CloudAvailability{}, true, CloudCredits{Remaining: &zero}, true, "credits_exhausted"},
		{"credits spent, tools on", ai.CloudAvailability{WebSearch: true}, false, CloudCredits{Remaining: &zero}, true, "credits_exhausted"},
		{"credits spent, nothing configured", ai.CloudAvailability{}, false, CloudCredits{Remaining: &zero}, false, "cloud_unavailable"},
	}
	for _, c := range cases {
		enabled, reason := cloudState(c.tools, c.chat, c.credits)
		if enabled != c.wantEnabled || reason != c.wantReason {
			t.Errorf("%s: cloudState = %v %q, want %v %q", c.name, enabled, reason, c.wantEnabled, c.wantReason)
		}
	}
}
