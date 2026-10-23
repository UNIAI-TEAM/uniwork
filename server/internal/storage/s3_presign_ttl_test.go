package storage

import (
	"context"
	"net/url"
	"strconv"
	"testing"
	"time"
)

const sigV4MaxExpiresSeconds = 604800

func TestClampPresignTTL(t *testing.T) {
	cases := []struct {
		name string
		in   time.Duration
		want time.Duration
	}{
		{"short unchanged", 5 * time.Minute, 5 * time.Minute},
		{"just below the cap unchanged", maxPresignTTL - time.Second, maxPresignTTL - time.Second},
		{"the cap unchanged", maxPresignTTL, maxPresignTTL},
		{"just above the cap clamped", maxPresignTTL + time.Second, maxPresignTTL},
		{"exactly 7 days clamped", 7 * 24 * time.Hour, maxPresignTTL},
		{"30 days clamped", 30 * 24 * time.Hour, maxPresignTTL},
	}
	for _, c := range cases {
		if got := clampPresignTTL(c.in); got != c.want {
			t.Errorf("%s: clampPresignTTL(%s) = %s, want %s", c.name, c.in, got, c.want)
		}
	}
	if maxPresignTTL >= 7*24*time.Hour {
		t.Fatalf("maxPresignTTL = %s, must stay strictly below the SigV4 7-day limit", maxPresignTTL)
	}
}

func presignedExpires(t *testing.T, raw string) int {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse signed URL: %v", err)
	}
	n, err := strconv.Atoi(u.Query().Get("X-Amz-Expires"))
	if err != nil {
		t.Fatalf("X-Amz-Expires in %q: %v", raw, err)
	}
	return n
}

func TestS3SignedURLsNeverExceedSigV4Limit(t *testing.T) {
	store := newStubS3(t, &stubS3{})
	long := 30 * 24 * time.Hour
	loc := store.loc("provider/in.bin")

	w, err := store.SignWrite(context.Background(), loc, SignOptions{TTL: long})
	if err != nil {
		t.Fatalf("SignWrite: %v", err)
	}
	r, err := store.SignRead(context.Background(), loc, SignOptions{TTL: long})
	if err != nil {
		t.Fatalf("SignRead: %v", err)
	}
	for name, s := range map[string]SignedURL{"SignWrite": w, "SignRead": r} {
		got := presignedExpires(t, s.URL)
		if got >= sigV4MaxExpiresSeconds {
			t.Errorf("%s X-Amz-Expires = %d, want < %d", name, got, sigV4MaxExpiresSeconds)
		}
		if got != int(maxPresignTTL/time.Second) {
			t.Errorf("%s X-Amz-Expires = %d, want %d", name, got, int(maxPresignTTL/time.Second))
		}
		// The reported expiry must match the URL's life, not the request.
		if life := time.Until(s.ExpiresAt); life > maxPresignTTL || life < maxPresignTTL-time.Minute {
			t.Errorf("%s ExpiresAt is %s away, want about %s", name, life, maxPresignTTL)
		}
	}

	short, err := store.SignWrite(context.Background(), loc, SignOptions{TTL: 5 * time.Minute})
	if err != nil {
		t.Fatalf("SignWrite short: %v", err)
	}
	if got := presignedExpires(t, short.URL); got != 300 {
		t.Errorf("short TTL X-Amz-Expires = %d, want 300", got)
	}
}

// The legacy Presigner (avatars, chat voice, downloads) signs through its own
// client rather than the ObjectStore, so it needs its own proof that a request
// beyond the SigV4 limit is clamped and a default stays well inside it.
func TestS3StoragePresignGetNeverExceedsSigV4Limit(t *testing.T) {
	store := newStubS3(t, &stubS3{})
	legacy := &S3Storage{client: store.client, bucket: store.bucket}

	for name, ttl := range map[string]time.Duration{"30 days": 30 * 24 * time.Hour, "exactly 7 days": 7 * 24 * time.Hour} {
		for variant, sign := range map[string]func() (string, error){
			"PresignGet": func() (string, error) { return legacy.PresignGet(context.Background(), "avatars/a.png", ttl) },
			"PresignGetWithContentDisposition": func() (string, error) {
				return legacy.PresignGetWithContentDisposition(context.Background(), "avatars/a.png", ttl, `attachment; filename="a.png"`)
			},
		} {
			signed, err := sign()
			if err != nil {
				t.Fatalf("%s (%s): %v", variant, name, err)
			}
			if got := presignedExpires(t, signed); got != int(maxPresignTTL/time.Second) || got >= sigV4MaxExpiresSeconds {
				t.Errorf("%s (%s) X-Amz-Expires = %d, want %d (< %d)", variant, name, got, int(maxPresignTTL/time.Second), sigV4MaxExpiresSeconds)
			}
		}
	}

	signed, err := legacy.PresignGet(context.Background(), "avatars/a.png", 0)
	if err != nil {
		t.Fatalf("PresignGet default: %v", err)
	}
	if got := presignedExpires(t, signed); got != 1800 {
		t.Errorf("default X-Amz-Expires = %d, want 1800", got)
	}
}
