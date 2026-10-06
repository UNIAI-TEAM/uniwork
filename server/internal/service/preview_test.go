package service

import (
	"strings"
	"testing"
	"time"
)

func TestPreviewCapabilityIsTamperEvident(t *testing.T) {
	s := &PreviewAssetService{secret: []byte("01234567890123456789012345678901")}
	token, err := s.sign(previewClaims{Version: 1, DocumentID: "d1", JobID: "j1", UserID: "u1", AssetIDs: []string{"a1"}, ExpiresAt: time.Now().Add(time.Minute).UnixMilli(), Nonce: "n"})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := s.verify(token)
	if err != nil || claims.DocumentID != "d1" || len(claims.AssetIDs) != 1 {
		t.Fatalf("verify = %#v, %v", claims, err)
	}
	// A MAC is 32 bytes = 43 base64 characters; the last one carries two
	// padding bits. Flipping them gives a non-canonical spelling of the same
	// bytes that must be refused too, so the check never depends on chance.
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, token[len(token)-1])
	nonCanonical := token[:len(token)-1] + string(alphabet[last^1])
	swapped := token[:len(token)-1] + string(alphabet[(last+4)%64])
	for _, altered := range []string{token + "x", "x" + token, swapped, nonCanonical} {
		if _, err := s.verify(altered); err == nil {
			t.Fatalf("altered capability accepted: %q", altered)
		}
	}
}

func TestPreviewCapabilityRejectsMalformedClaims(t *testing.T) {
	s := &PreviewAssetService{secret: []byte("01234567890123456789012345678901")}
	for _, claims := range []previewClaims{
		{Version: 1, DocumentID: "", UserID: "u1", ExpiresAt: 1},
		{Version: 1, DocumentID: "d1", UserID: "u1", ExpiresAt: 0},
		{Version: 1, DocumentID: "d1", UserID: "u1", ExpiresAt: 1, AssetIDs: make([]string, 257)},
	} {
		token, err := s.sign(claims)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.verify(token); err == nil {
			t.Fatalf("malformed claims accepted: %#v", claims)
		}
	}
}
