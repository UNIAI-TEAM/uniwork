package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestSetAIConsentRecordsAgreementAndWithdrawal(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ctx := context.Background()
	u := registerVerified(t, q, s, "ai-consent@example.com", "Consent")

	auditRows := func(action string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, u.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	got, err := s.SetAIConsent(ctx, u.ID, " 2026-10-anthropic ")
	if err != nil || got.AiConsentVersion.String != "2026-10-anthropic" || !got.AiConsentAt.Valid {
		t.Fatalf("agree: %+v %v", got, err)
	}
	// Agreeing again to the same text changes nothing and writes no second row.
	if _, err := s.SetAIConsent(ctx, u.ID, "2026-10-anthropic"); err != nil {
		t.Fatal(err)
	}
	if n := auditRows("user.ai_consent_granted"); n != 1 {
		t.Fatalf("granted rows = %d, want 1", n)
	}

	got, err = s.SetAIConsent(ctx, u.ID, "")
	if err != nil || got.AiConsentVersion.Valid || got.AiConsentAt.Valid {
		t.Fatalf("withdraw: %+v %v", got, err)
	}
	if n := auditRows("user.ai_consent_withdrawn"); n != 1 {
		t.Fatalf("withdrawn rows = %d, want 1", n)
	}

	for _, bad := range []string{strings.Repeat("v", aiConsentVersionMax+1), "two words"} {
		var ve ValidationError
		if _, err := s.SetAIConsent(ctx, u.ID, bad); !errors.As(err, &ve) {
			t.Errorf("version %q: got %v, want a validation error", bad, err)
		}
	}
}
