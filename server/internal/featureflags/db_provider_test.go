package featureflags

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type fakeStore struct {
	rows  []db.FeatureFlagOverride
	err   error
	calls int
}

func (f *fakeStore) ListActiveFlagOverrides(context.Context) ([]db.FeatureFlagOverride, error) {
	f.calls++
	return f.rows, f.err
}

func row(key, scope, id string, enabled bool) db.FeatureFlagOverride {
	return db.FeatureFlagOverride{FlagKey: key, ScopeType: scope, ScopeID: id, Enabled: enabled}
}

func ctxFor(user, org string) context.Context {
	return featureflag.WithEvalContext(context.Background(), featureflag.EvalContext{UserID: user, OrganizationID: org})
}

func TestDBProviderPrecedenceUserOrgGlobal(t *testing.T) {
	store := &fakeStore{rows: []db.FeatureFlagOverride{
		row("k", ScopeGlobal, "", false),
		row("k", ScopeOrganization, "org1", true),
		row("k", ScopeUser, "u1", false),
	}}
	p := NewDBProvider(store, nil)
	cases := []struct {
		user, org string
		want      bool
	}{
		{"u1", "org1", false}, // user wins over org
		{"u2", "org1", true},  // org wins over global
		{"u2", "org9", false}, // global
		{"", "", false},
	}
	for _, c := range cases {
		d, ok := p.Lookup(ctxFor(c.user, c.org), "k")
		if !ok || d.Enabled != c.want || d.Reason != featureflag.ReasonOverride || d.Source != "db" {
			t.Errorf("user=%q org=%q: ok=%v %+v", c.user, c.org, ok, d)
		}
	}
	if _, ok := p.Lookup(ctxFor("u1", "org1"), "other"); ok {
		t.Fatal("unknown key matched")
	}
	if store.calls != 1 {
		t.Fatalf("store read %d times, want one cached load", store.calls)
	}
}

func TestDBProviderCacheTTLAndInvalidate(t *testing.T) {
	store := &fakeStore{rows: []db.FeatureFlagOverride{row("k", ScopeGlobal, "", true)}}
	p := NewDBProvider(store, nil)
	now := time.Now()
	p.now = func() time.Time { return now }
	p.Lookup(context.Background(), "k")
	store.rows = []db.FeatureFlagOverride{row("k", ScopeGlobal, "", false)}
	if d, _ := p.Lookup(context.Background(), "k"); !d.Enabled {
		t.Fatal("cache should still serve the old value")
	}
	if err := NewInvalidator(p).Handle(context.Background(), outbox.Row{Topic: "flag.updated"}); err != nil {
		t.Fatal(err)
	}
	if d, _ := p.Lookup(context.Background(), "k"); d.Enabled {
		t.Fatal("invalidate should reload")
	}
	store.rows = []db.FeatureFlagOverride{row("k", ScopeGlobal, "", true)}
	now = now.Add(CacheTTL + time.Second)
	if d, _ := p.Lookup(context.Background(), "k"); !d.Enabled {
		t.Fatal("ttl should reload")
	}
}

func TestDBProviderSurvivesStoreErrors(t *testing.T) {
	store := &fakeStore{err: errors.New("db down")}
	p := NewDBProvider(store, nil)
	if _, ok := p.Lookup(context.Background(), "k"); ok {
		t.Fatal("no rows, no match")
	}
	var nilP *DBProvider
	if _, ok := nilP.Lookup(context.Background(), "k"); ok {
		t.Fatal("nil provider must not match")
	}
	// Chain: a service with a nil store has no db layer at all.
	svc, dbp, err := NewService(nil, nil)
	if err != nil || dbp != nil || !svc.IsEnabled(context.Background(), "k", true) {
		t.Fatalf("service without store: %v %v", err, dbp)
	}
}

func TestPublicFlagsFollowCatalogueAndOverrides(t *testing.T) {
	store := &fakeStore{rows: []db.FeatureFlagOverride{row("agents_assignee", ScopeOrganization, "org1", true)}}
	svc, _, err := NewService(store, nil)
	if err != nil {
		t.Fatal(err)
	}
	flags := EvaluateFrontendPublicFlags(ctxFor("", "org1"), svc)
	if !flags["agents_assignee"] || !flags["rum_sampling"] || flags["meeting_ai_summary"] {
		t.Fatalf("flags = %v", flags)
	}
	if _, private := flags["admin_quota"]; private {
		t.Fatal("admin_quota is not public")
	}
	if got := EvaluateFrontendPublicFlags(ctxFor("", "org2"), svc)["agents_assignee"]; got {
		t.Fatal("override leaked to another organization")
	}
}

// A flag past its review date is a permanent flag nobody decided on (§7.3).
func TestFlagsAreReviewed(t *testing.T) {
	for _, f := range Catalogue() {
		if f.ReviewAt.IsZero() {
			t.Errorf("%s has no review_at", f.Key)
		}
		if time.Now().After(f.ReviewAt) {
			t.Errorf("%s passed review_at %s: delete it or extend the date with the reason in the commit", f.Key, f.ReviewAt.Format("2006-01-02"))
		}
		if f.Owner == "" || f.Description == "" {
			t.Errorf("%s needs owner and description", f.Key)
		}
	}
}
