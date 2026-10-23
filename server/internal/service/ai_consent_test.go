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

// Apple 5.1.2(i): saying no is recorded too, and from then on what the person
// wrote stays out of every AI request (ai_opt_out.go); agreeing lifts it.
func TestDecliningAIProcessingOptsOutUntilAgreed(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ctx := context.Background()
	u := registerVerified(t, q, s, "ai-decline@example.com", "Decline")
	withdrawn := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'user.ai_consent_withdrawn' AND resource_id = $1`, u.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	got, err := s.SetAIConsent(ctx, u.ID, "")
	if err != nil || !got.AiOptOutAt.Valid || got.AiConsentVersion.Valid {
		t.Fatalf("decline without a prior agreement: %+v %v", got, err)
	}
	if _, err := s.SetAIConsent(ctx, u.ID, ""); err != nil || withdrawn() != 1 {
		t.Fatalf("declining again writes no second row: %v rows=%d", err, withdrawn())
	}
	optOuts, err := loadAIOptOuts(ctx, q, []string{u.ID, "", u.ID, "someone-else"})
	if err != nil || !optOuts.excludes(u.ID) || optOuts.excludes("someone-else") {
		t.Fatalf("opt-outs: %v %v", optOuts, err)
	}
	got, err = s.SetAIConsent(ctx, u.ID, "2026-10-anthropic")
	if err != nil || got.AiOptOutAt.Valid {
		t.Fatalf("agreeing lifts the opt-out: %+v %v", got, err)
	}
	if optOuts, err := loadAIOptOuts(ctx, q, []string{u.ID}); err != nil || optOuts.excludes(u.ID) {
		t.Fatalf("opt-outs after agreeing: %v %v", optOuts, err)
	}
	if empty, err := loadAIOptOuts(ctx, q, nil); err != nil || len(empty) != 0 {
		t.Fatalf("no senders: %v %v", empty, err)
	}
}
