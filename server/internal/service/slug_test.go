package service

import "testing"

func TestValidateSlug(t *testing.T) {
	ok := []string{"ab", "acme", "doi-alpha-1", "a1b2"}
	for _, s := range ok {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("%q should be valid: %v", s, err)
		}
	}
	bad := []string{"", "a", "-abc", "abc-", "Ab", "a--b", "a b", "login", "api", "onboarding",
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
