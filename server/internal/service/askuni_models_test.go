package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// modelsFixture is the agent fixture with the three Claude keys mapped onto
// fake model ids (haiku fake-b, sonnet fake = the Auto model, opus fake-c),
// priced like the real ones, and the second user a plain member of the
// organization.
func modelsFixture(t *testing.T) (*AskUNIService, *provider.Fake, db.User, db.User, db.Workspace) {
	t.Helper()
	s, fake, ua, ub, w := askFixture(t)
	s.SetReadTools(NewMcpToolService(s.q, s, NewHomeService(s.q, s.ws), s.ws, "https://app.example.test"))
	s.SetFlags(agentFlagFake{org: w.OrganizationID})
	s.gw = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{ExtraAllow: []string{"fake-b", "fake-c"}})
	old := askModels
	askModels = []askModel{
		{Key: "haiku", IDs: map[string]string{"fake": "fake-b"}, Speed: 5, Intelligence: 3, DefaultOn: true},
		{Key: "sonnet", IDs: map[string]string{"fake": "fake"}, Speed: 4, Intelligence: 4, DefaultOn: true},
		{Key: "opus", IDs: map[string]string{"fake": "fake-c"}, Speed: 2, Intelligence: 5, DefaultOn: false},
	}
	t.Cleanup(func() { askModels = old })
	for model, in := range map[string][2]int64{"fake-b": {100_000, 500_000}, "fake": {2_000_000, 10_000_000}, "fake-c": {4_000_000, 20_000_000}} {
		if _, err := s.q.AiInsertRate(context.Background(), db.AiInsertRateParams{
			ID: util.NewID(), Provider: "fake", Model: model, InputMicrosPerMtok: in[0], OutputMicrosPerMtok: in[1],
			EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	return s, fake, ua, ub, w
}

func TestAskModelChoiceFallsBackToAuto(t *testing.T) {
	s, _, _, _, w := modelsFixture(t)
	ctx := context.Background()
	for key, want := range map[string]string{"": "", "opus": "", "unknown": "", "haiku": "fake-b", "sonnet": "fake"} {
		if got, _ := s.resolveAskModel(ctx, w.OrganizationID, key, ""); got != want {
			t.Errorf("model %q resolved to %q, want %q", key, got, want)
		}
	}
}

func TestAskEffortDefaultsToMedium(t *testing.T) {
	s, _, _, _, w := modelsFixture(t)
	ctx := context.Background()
	for effort, want := range map[string]string{"": "medium", "xhigh": "medium", "max": "medium", "low": "low", "medium": "medium", "high": "high"} {
		if _, got := s.resolveAskModel(ctx, w.OrganizationID, "", effort); got != want {
			t.Errorf("effort %q resolved to %q, want %q", effort, got, want)
		}
	}
}

func TestAskAgentSendsTheChosenModelAndEffort(t *testing.T) {
	s, fake, ua, _, w := modelsFixture(t)
	reqs := scriptAgent(fake, "banner", "Xong")
	agentTask(t, s, ua, w, "Banner Tết")
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu rồi?", Locale: "vi", Model: "haiku", Effort: "high"}); err != nil {
		t.Fatal(err)
	}
	for i, r := range *reqs {
		if r.Model != "fake-b" || r.Effort != "high" {
			t.Errorf("call %d went to model %q effort %q, want fake-b/high", i, r.Model, r.Effort)
		}
	}
}

func TestSetAskModelsNeedsOrgAdmin(t *testing.T) {
	s, _, ua, ub, w := modelsFixture(t)
	ctx := context.Background()
	org := w.OrganizationID
	if _, err := s.SetAskModels(ctx, ub.ID, org, []string{"opus"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member: %v, want ErrForbidden", err)
	}
	got, err := s.SetAskModels(ctx, ua.ID, org, []string{"sonnet", "opus", "sonnet"})
	if err != nil || !reflect.DeepEqual(got, []string{"opus", "sonnet"}) {
		t.Fatalf("owner: %v %v, want [opus sonnet]", got, err)
	}
	if read, err := s.AskModels(ctx, ub.ID, org); err != nil || !reflect.DeepEqual(read, got) {
		t.Fatalf("a member reads %v %v, want %v", read, err, got)
	}
	count := func() (n int) {
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'organization.ask_models_changed'`, org).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(); n != 1 {
		t.Fatalf("audit rows %d, want 1", n)
	}
	if _, err := s.SetAskModels(ctx, ua.ID, org, []string{"sonnet", "opus"}); err != nil || count() != 1 {
		t.Fatalf("an unchanged save wrote an audit row (err %v)", err)
	}
	var ve ValidationError
	if _, err := s.SetAskModels(ctx, ua.ID, org, []string{"gpt"}); !errors.As(err, &ve) {
		t.Fatalf("unknown key: %v, want a validation error", err)
	}
	if got, err := s.SetAskModels(ctx, ua.ID, org, []string{}); err != nil || len(got) != 0 {
		t.Fatalf("switching every model off: %v %v", got, err)
	}
	if id, _ := s.resolveAskModel(ctx, org, "haiku", ""); id != "" {
		t.Fatalf("a disabled model resolved to %q, want Auto", id)
	}
}

func TestCapabilitiesListsSelectableModels(t *testing.T) {
	s, _, ua, _, w := modelsFixture(t)
	c, err := s.Capabilities(context.Background(), ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []AskModelOption{
		{Key: "haiku", Speed: 5, Intelligence: 3, Cost: 1, Enabled: true},
		{Key: "sonnet", Speed: 4, Intelligence: 4, Cost: 3, Enabled: true},
		{Key: "opus", Speed: 2, Intelligence: 5, Cost: 4, Enabled: false},
	}
	if !reflect.DeepEqual(c.Models, want) || c.AutoModel != "sonnet" {
		t.Fatalf("models %+v auto %q, want %+v auto sonnet", c.Models, c.AutoModel, want)
	}
}

func TestAskCostTier(t *testing.T) {
	for total, want := range map[int64]int{600_000: 1, 1_000_000: 1, 5_000_000: 2, 12_000_000: 3, 24_000_000: 4, 30_000_001: 5} {
		if got := askCostTier(total); got != want {
			t.Errorf("tier of %d = %d, want %d", total, got, want)
		}
	}
}
