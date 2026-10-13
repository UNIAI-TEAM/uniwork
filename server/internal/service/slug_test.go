package service

import "testing"

func TestValidateSlug(t *testing.T) {
	ok := []string{"ab", "acme", "doi-alpha-1", "a1b2"}
	for _, s := range ok {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("%q should be valid: %v", s, err)
		}
	}
	bad := []string{"", "a", "-abc", "abc-", "Ab", "a--b", "a b", "login", "api", "onboarding", "changelog",
		"thisslugiswaytoolongforthefortycharacterlimitxx"}
	for _, s := range bad {
		if err := ValidateSlug(s); err == nil {
			t.Errorf("%q should be invalid", s)
		}
	}
	if len(ReservedSlugs()) == 0 {
		t.Fatal("reserved slugs empty")
	}
}

// /mcp and /oauth/* are served by the API at the web host (deploy/edge), so an
// organization slugged either would be shadowed by the API (ruling 29).
func TestMcpConnectorPathsAreReservedSlugs(t *testing.T) {
	for _, s := range []string{"mcp", "oauth"} {
		if err := ValidateSlug(s); err == nil {
			t.Errorf("%q must be reserved: the edge sends /%s to the API", s, s)
		}
	}
}
