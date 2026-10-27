package auth

import (
	"encoding/base64"
	"strings"
	"testing"
)

// A blob the server hands a client is good for the one purpose it was sealed
// for (ADR 0047): a sign-in ticket never opens as a step-up token, an OAuth
// state cookie never as a link token, and neither opens through the at-rest
// Seal/Open key or the other way round.
func TestSealedBlobsDoNotCrossPurposes(t *testing.T) {
	s, err := NewSecretSealer([]byte("jwt-secret"))
	if err != nil {
		t.Fatal(err)
	}
	purposes := []string{
		PurposeSignInTicket, PurposeMFAPendingLink, PurposeLinkToken, PurposeOAuthStateGoogle,
		PurposeOAuthStateApple, PurposeAppleWebResult, PurposeStepUp,
	}
	if len(purposes) != len(sealPurposes) {
		t.Fatalf("the test names %d purposes, the sealer accepts %d", len(purposes), len(sealPurposes))
	}
	for _, p := range purposes {
		blob, err := s.SealFor(p, `{"uid":"01U"}`)
		if err != nil {
			t.Fatal(err)
		}
		if strings.ContainsAny(blob, "+/=") {
			t.Fatalf("%s: a blob rides in cookies and URLs, so it is base64url: %q", p, blob)
		}
		if got, err := s.OpenFor(p, blob); err != nil || got != `{"uid":"01U"}` {
			t.Fatalf("%s: open = %q %v", p, got, err)
		}
		for _, other := range purposes {
			if other == p {
				continue
			}
			if _, err := s.OpenFor(other, blob); err == nil {
				t.Fatalf("a %s blob opened as %s", p, other)
			}
		}
		if _, err := s.Open(blob); err == nil {
			t.Fatalf("a %s blob opened with the at-rest key", p)
		}
	}

	// The at-rest key does not open as any purpose either.
	atRest, err := s.Seal("JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range purposes {
		if _, err := s.OpenFor(p, atRest); err == nil {
			t.Fatalf("a Seal blob opened as %s", p)
		}
	}

	// The purpose binds as additional data, not only through the key: a blob
	// sealed under the ticket key but naming another purpose opens for neither.
	aead, err := s.purposeAEAD(PurposeSignInTicket)
	if err != nil {
		t.Fatal(err)
	}
	misbound, err := seal(aead, "x", []byte(PurposeStepUp), base64.RawURLEncoding)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{PurposeSignInTicket, PurposeStepUp} {
		if _, err := s.OpenFor(p, misbound); err == nil {
			t.Fatalf("a blob bound to another purpose's name opened as %s", p)
		}
	}

	// Another secret, a changed byte, an unknown or empty purpose: all refused.
	blob, _ := s.SealFor(PurposeStepUp, "x")
	other, _ := NewSecretSealer([]byte("another-secret"))
	if _, err := other.OpenFor(PurposeStepUp, blob); err == nil {
		t.Fatal("another secret opened the blob")
	}
	raw, _ := base64.RawURLEncoding.DecodeString(blob)
	raw[len(raw)-1] ^= 1
	if _, err := s.OpenFor(PurposeStepUp, base64.RawURLEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("a changed byte opened")
	}
	for _, p := range []string{"", "step_up ", "sign-in-ticket"} {
		if _, err := s.SealFor(p, "x"); err == nil {
			t.Fatalf("purpose %q sealed", p)
		}
		if _, err := s.OpenFor(p, blob); err == nil {
			t.Fatalf("purpose %q opened", p)
		}
	}
	if _, err := (SecretSealer{}).SealFor(PurposeStepUp, "x"); err == nil {
		t.Fatal("a zero sealer sealed")
	}
}
