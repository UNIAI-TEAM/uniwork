package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type actionsFlagFake struct{ on bool }

func (f actionsFlagFake) IsEnabled(_ context.Context, key string, def bool) bool {
	if key == askActionsFlag || key == askOfficeFlag { // the Office tools ride with the actions here
		return f.on
	}
	return def
}

func TestClampAskMode(t *testing.T) {
	for _, c := range []struct{ mode, ceiling, want string }{
		{"auto", "", "plan"},
		{"auto", "plan", "plan"},
		{"plan", "ask", "ask"},
		{"ask", "auto", "ask"},
		{"auto", "auto", "auto"},
		{"auto", "off", ""},
		{"", "auto", "ask"},
		{"weird", "auto", "ask"},
		{"auto", "weird", "plan"},
	} {
		if got := clampAskMode(c.mode, c.ceiling); got != c.want {
			t.Errorf("clampAskMode(%q, %q) = %q, want %q", c.mode, c.ceiling, got, c.want)
		}
	}
}

func TestAskUniModeIsClampedToTheCeiling(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	s.SetFlags(actionsFlagFake{on: true})
	tc := ai.ToolContext{ActorID: ua.ID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	setCeiling := func(v string) {
		t.Helper()
		if err := s.q.SetOrganizationAskWriteCeiling(ctx, db.SetOrganizationAskWriteCeilingParams{Ceiling: v, ActorID: ua.ID, ID: w.OrganizationID}); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.askActions(ctx, tc, "auto"); got != (AskActions{Enabled: true, Ceiling: "plan", Mode: "plan"}) {
		t.Fatalf("NULL ceiling: %+v", got)
	}
	setCeiling("ask")
	if got := s.askActions(ctx, tc, "plan"); got.Mode != "ask" || got.Ceiling != "ask" {
		t.Fatalf("ceiling ask: %+v", got)
	}
	setCeiling("off")
	if got := s.askActions(ctx, tc, "auto"); got.Mode != "" || got.Ceiling != "off" {
		t.Fatalf("ceiling off: %+v", got)
	}
	setCeiling("auto")
	if got := s.askActions(ctx, tc, ""); got.Mode != "ask" || !got.Enabled {
		t.Fatalf("unset mode: %+v", got)
	}
	// A saved mode is used when the turn names none.
	if _, err := s.SetAskUniMode(ctx, ua.ID, "auto"); err != nil {
		t.Fatal(err)
	}
	if got := s.askActions(ctx, tc, ""); got.Mode != "auto" {
		t.Fatalf("saved mode: %+v", got)
	}
	if _, err := s.SetAskUniMode(ctx, ua.ID, "yolo"); !errors.As(err, new(ValidationError)) {
		t.Fatalf("unknown mode: %v, want a validation error", err)
	}
	s.SetFlags(actionsFlagFake{on: false})
	if got := s.askActions(ctx, tc, "auto"); got.Enabled {
		t.Fatalf("flag off: %+v, want Enabled false", got)
	}
	if why := s.askWriteGate(ctx, tc).Refusal(ctx); why != "ai_actions_disabled" {
		t.Fatalf("flag off gate: %q", why)
	}
	s.SetFlags(actionsFlagFake{on: true})
	if why := s.askWriteGate(ctx, tc).Refusal(ctx); why != "" {
		t.Fatalf("open gate: %q", why)
	}
}

func TestSetAskWritePolicyNeedsAnAdminAndAudits(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	ctx := context.Background()
	org := w.OrganizationID
	if err := s.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org, UserID: ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetAskWritePolicy(ctx, ub.ID, org, "auto"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member: %v, want ErrForbidden", err)
	}
	if _, err := s.SetAskWritePolicy(ctx, ua.ID, org, "yolo"); !errors.As(err, new(ValidationError)) {
		t.Fatalf("unknown: %v, want a validation error", err)
	}
	if got, err := s.AskWritePolicy(ctx, ub.ID, org); err != nil || got != "plan" {
		t.Fatalf("default: %q %v, want plan", got, err)
	}
	if got, err := s.SetAskWritePolicy(ctx, ua.ID, org, "auto"); err != nil || got != "auto" {
		t.Fatalf("owner: %q %v", got, err)
	}
	var from, to string
	var by pgtype.Text
	if err := s.pool.QueryRow(ctx, `SELECT changes::jsonb->'ask_uni_write_ceiling'->>'from', changes::jsonb->'ask_uni_write_ceiling'->>'to' FROM audit_events WHERE organization_id = $1 AND action = 'organization.ask_uni_write_policy_changed'`, org).Scan(&from, &to); err != nil {
		t.Fatal(err)
	}
	if from != "plan" || to != "auto" {
		t.Fatalf("audit from/to %q/%q, want plan/auto", from, to)
	}
	if err := s.pool.QueryRow(ctx, `SELECT ask_uni_write_ceiling_updated_by FROM organizations WHERE id = $1`, org).Scan(&by); err != nil {
		t.Fatal(err)
	}
	if by.String != ua.ID {
		t.Fatalf("updated_by %q, want %q", by.String, ua.ID)
	}
	if _, err := s.SetAskWritePolicy(ctx, ua.ID, org, "auto"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'organization.ask_uni_write_policy_changed'`, org).Scan(&n); err != nil || n != 1 {
		t.Fatalf("the same value again left %d audit rows (err %v), want 1", n, err)
	}
}

// The 31st apply in a minute is refused with its own code; a closed gate
// never spends the budget.
func TestAskWriteGateBudget(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	s.SetFlags(actionsFlagFake{on: true})
	tc := ai.ToolContext{ActorID: ua.ID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	for i := 1; i <= askWriteBudget; i++ {
		if why := s.askWriteGate(ctx, tc).Refusal(ctx); why != "" {
			t.Fatalf("apply %d refused: %q", i, why)
		}
	}
	if why := s.askWriteGate(ctx, tc).Refusal(ctx); why != "ai_write_rate_limited" {
		t.Fatalf("apply 31: %q, want ai_write_rate_limited", why)
	}

	other := ai.ToolContext{ActorID: "u-closed", OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	s.SetFlags(actionsFlagFake{on: false})
	for i := 0; i < askWriteBudget+5; i++ {
		if why := s.askWriteGate(ctx, other).Refusal(ctx); why != "ai_actions_disabled" {
			t.Fatalf("closed gate: %q", why)
		}
	}
	s.SetFlags(actionsFlagFake{on: true})
	if why := s.askWriteGate(ctx, other).Refusal(ctx); why != "" {
		t.Fatalf("a closed gate spent the budget: %q", why)
	}
}

// agentActionsFlags turns ask_uni_actions on and the agent on or off.
type agentActionsFlags struct{ agent bool }

func (f agentActionsFlags) IsEnabled(_ context.Context, key string, def bool) bool {
	switch key {
	case askActionsFlag:
		return true
	case askAgentFlag:
		return f.agent
	}
	return def
}

// Writes are offered only where the turn runs the agent, as attachments are:
// with the actions flag on and the agent off, no turn is offered a write tool.
func TestCapabilitiesOfferActionsOnlyWhereTheAgentRuns(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	s.SetReadTools(NewMcpToolService(s.q, s, NewHomeService(s.q, s.ws), s.ws, "https://app.example.test"))
	for _, c := range []struct{ agent, want bool }{{true, true}, {false, false}} {
		s.SetFlags(agentActionsFlags{agent: c.agent})
		caps, err := s.Capabilities(context.Background(), ua.ID, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		if caps.Actions.Enabled != c.want {
			t.Errorf("agent %v: Actions.Enabled = %v, want %v", c.agent, caps.Actions.Enabled, c.want)
		}
	}
}
