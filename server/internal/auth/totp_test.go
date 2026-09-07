package auth

import (
	"testing"
	"time"
)

// RFC 6238 appendix B vectors, SHA-1, secret "12345678901234567890"
// (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), truncated to 6 digits.
func TestTOTPCodeMatchesRFC6238Vectors(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	for _, tc := range []struct {
		at   int64
		want string
	}{{59, "287082"}, {1111111109, "081804"}, {1234567890, "005924"}, {20000000000, "353130"}} {
		got, err := TOTPCode(secret, time.Unix(tc.at, 0))
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("t=%d: got %s want %s", tc.at, got, tc.want)
		}
	}
}

func TestValidTOTPAcceptsOneStepOfSkewOnly(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	prev, _ := TOTPCode(secret, now.Add(-totpStep))
	old, _ := TOTPCode(secret, now.Add(-2*totpStep))
	if !ValidTOTP(secret, prev, now) {
		t.Error("previous step must be accepted")
	}
	if ValidTOTP(secret, old, now) && old != prev {
		t.Error("two steps back must be refused")
	}
	if ValidTOTP(secret, "12345", now) || ValidTOTP(secret, "", now) {
		t.Error("wrong length must be refused")
	}
}

func TestSealerRoundTripsAndRejectsOtherKey(t *testing.T) {
	a, _ := NewSecretSealer([]byte("key-a"))
	b, _ := NewSecretSealer([]byte("key-b"))
	sealed, err := a.Seal("JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := a.Open(sealed); err != nil || got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("open: %q %v", got, err)
	}
	if _, err := b.Open(sealed); err == nil {
		t.Fatal("another key must not open it")
	}
	if _, err := NewSecretSealer(nil); err == nil {
		t.Fatal("empty key must be refused")
	}
}

func TestRecoveryCodesAreUniqueAndHashStable(t *testing.T) {
	codes, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 11 || c[5] != '-' || seen[c] {
			t.Fatalf("bad code %q", c)
		}
		seen[c] = true
	}
	if HashRecoveryCode(" AbCdE-FGHij ") != HashRecoveryCode("abcde-fghij") {
		t.Error("hash must normalise case and spaces")
	}
}
