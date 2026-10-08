package service

import (
	"strings"
	"testing"
	"time"
)

// The token checks need no database: a zero DocumentService is enough for
// sign/verify, which never reach it.
func newFrameSignerForTest(t *testing.T, now *time.Time) *OfficeFrameService {
	t.Helper()
	s := NewOfficeFrameService(&DocumentService{}, "office-frame-test-secret-0123456789abcdef")
	s.SetClock(func() time.Time { return *now })
	return s
}

func TestOfficeFrameTokenVerifiesOnlyItsOwnUntamperedUnexpiredClaims(t *testing.T) {
	now := time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u", ExpiresAt: now.Add(OfficeFrameTokenTTL).UnixMilli(), Nonce: "n"}
	token, err := s.sign(officeFrameTokenPrefix, claims)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Verify(token)
	if err != nil || got != claims {
		t.Fatalf("Verify = %+v, %v", got, err)
	}

	payload, sig, _ := strings.Cut(strings.TrimPrefix(token, officeFrameTokenPrefix), ".")
	other := NewOfficeFrameService(&DocumentService{}, "another-secret-0123456789abcdef-xyz")
	forged, _ := other.sign(officeFrameTokenPrefix, claims)
	for name, bad := range map[string]string{
		"empty":            "",
		"no prefix":        payload + "." + sig,
		"asset prefix":     officeFrameAssetPrefix + payload + "." + sig,
		"tampered payload": officeFrameTokenPrefix + payload + "x." + sig,
		"tampered mac":     officeFrameTokenPrefix + payload + "." + sig[:len(sig)-2] + "AA",
		"other key":        forged,
	} {
		if _, err := s.Verify(bad); err == nil {
			t.Errorf("%s: Verify accepted %q", name, bad)
		}
	}

	now = now.Add(OfficeFrameTokenTTL)
	if _, err := s.Verify(token); err == nil {
		t.Fatal("Verify accepted an expired token")
	}
}

func TestOfficeFrameAssetSignatureNamesOneAsset(t *testing.T) {
	now := time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u"}
	signed, err := s.SignAsset(claims, "asset")
	if err != nil {
		t.Fatal(err)
	}
	sig := signed.URL[strings.Index(signed.URL, "?sig=")+len("?sig="):]
	got, err := s.VerifyAsset(sig, "doc", "asset")
	if err != nil || got.UserID != "u" || got.WorkspaceID != "ws" || got.OrganizationID != "org" {
		t.Fatalf("VerifyAsset = %+v, %v", got, err)
	}
	for _, c := range [][2]string{{"doc", "other"}, {"other", "asset"}} {
		if _, err := s.VerifyAsset(sig, c[0], c[1]); err == nil {
			t.Errorf("VerifyAsset accepted %v", c)
		}
	}
	// An image signature is not a frame token.
	if _, err := s.Verify(sig); err == nil {
		t.Fatal("Verify accepted an asset signature")
	}
	now = now.Add(OfficeFrameTokenTTL)
	if _, err := s.VerifyAsset(sig, "doc", "asset"); err == nil {
		t.Fatal("VerifyAsset accepted an expired signature")
	}
}
