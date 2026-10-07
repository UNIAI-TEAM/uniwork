package service

import "testing"

func TestValidateCheckoutPath(t *testing.T) {
	for _, bad := range []string{"", "https://evil.com", "/ok//bad", "relative"} {
		if err := ValidateCheckoutPath(bad); err == nil {
			t.Fatalf("want error for %q", bad)
		}
	}
	if err := ValidateCheckoutPath("/acme/ws/settings?tab=billing"); err != nil {
		t.Fatal(err)
	}
}
