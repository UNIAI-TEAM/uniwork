package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Ask UNI's permission modes, lowest to highest, and the organization ceiling
// that caps them (ADR 0044 §3, ruling R9). The ceiling adds "off".
const (
	AskModeAsk     = "ask"
	AskModePlan    = "plan"
	AskModeAuto    = "auto"
	AskCeilingOff  = "off"
	askActionsFlag = "ask_uni_actions"
	// askWriteBudget is applied rows per person per minute.
	askWriteBudget = 30
)

func askModeRank(v string) int {
	switch v {
	case AskModeAsk:
		return 1
	case AskModePlan:
		return 2
	case AskModeAuto:
		return 3
	}
	return 0
}

// clampAskMode is the mode a turn may run in: the requested mode, never above
// the ceiling. An empty or unknown ceiling reads as plan; an empty or unknown
// mode reads as ask; the off ceiling leaves no mode ("").
func clampAskMode(mode, ceiling string) string {
	if ceiling == AskCeilingOff {
		return ""
	}
	if askModeRank(ceiling) == 0 {
		ceiling = AskModePlan
	}
	if askModeRank(mode) == 0 {
		mode = AskModeAsk
	}
	if askModeRank(mode) > askModeRank(ceiling) {
		return ceiling
	}
	return mode
}

// AskActions is what the capabilities say about Ask UNI's writes: Enabled
// (flag on), the organization's Ceiling and the Mode the asker runs in.
type AskActions struct {
	Enabled       bool
	Ceiling, Mode string
}

func (s *AskUNIService) askCeiling(ctx context.Context, orgID string) (string, error) {
	c, err := s.q.GetOrganizationAskWriteCeiling(ctx, orgID)
	if err != nil {
		return "", err
	}
	if !c.Valid || c.String == "" {
		return AskModePlan, nil
	}
	return c.String, nil
}

// askActionsFlag is ask_uni_actions as tc's asker, organization and workspace
// see it; false without a flag source.
func (s *AskUNIService) askActionsFlag(ctx context.Context, tc ai.ToolContext) bool {
	if s.flags == nil {
		return false
	}
	f, _ := featureflags.Lookup(askActionsFlag)
	fctx := featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: tc.ActorID, OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID})
	return s.flags.IsEnabled(fctx, askActionsFlag, f.Default)
}

// AskActionsEnabled is the kill switch (R2) for the routes that name no
// proposal: the person's mode and the organization's ceiling. orgID may be
// empty (the mode route names no organization).
func (s *AskUNIService) AskActionsEnabled(ctx context.Context, userID, orgID string) bool {
	return s.askActionsFlag(ctx, ai.ToolContext{ActorID: userID, OrganizationID: orgID})
}

// askActions reads the flag, the ceiling and the saved mode; requested wins
// over the saved mode. A failed ceiling read closes: Enabled false, ceiling off.
func (s *AskUNIService) askActions(ctx context.Context, tc ai.ToolContext, requested string) AskActions {
	out := AskActions{Ceiling: AskCeilingOff}
	if ceiling, err := s.askCeiling(ctx, tc.OrganizationID); err == nil {
		out.Ceiling = ceiling
		out.Enabled = s.askActionsFlag(ctx, tc)
	}
	if requested == "" {
		if m, err := s.q.GetUserAskUniMode(ctx, tc.ActorID); err == nil && m.Valid {
			requested = m.String
		}
	}
	out.Mode = clampAskMode(requested, out.Ceiling)
	return out
}

// askWriteGate is the shared gate for an Ask UNI row: the flag and the
// ceiling, then a mode, then 30 applied rows a minute per person.
func (s *AskUNIService) askWriteGate(ctx context.Context, tc ai.ToolContext) AIWriteGate {
	a := s.askActions(ctx, tc, "")
	return AIWriteGate{
		Open: a.Enabled && a.Ceiling != AskCeilingOff, OpenCode: "ai_actions_disabled",
		Scoped: a.Mode != "", ScopeCode: "ai_actions_disabled",
		Budget: func(ctx context.Context) bool {
			n, ok := s.askCount(ctx, "uw:ai:ask:write:"+tc.ActorID)
			return !ok || n <= askWriteBudget
		},
		BudgetCode: "ai_write_rate_limited",
	}
}

// AskWritePolicy is the organization's ceiling, read by any member.
func (s *AskUNIService) AskWritePolicy(ctx context.Context, actorID, orgID string) (string, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, actorID); err != nil {
		return "", err
	}
	return s.askCeiling(ctx, orgID)
}

// SetAskWritePolicy sets the ceiling; owner or admin only. A changed value
// writes one audit row in the same transaction.
func (s *AskUNIService) SetAskWritePolicy(ctx context.Context, actorID, orgID, ceiling string) (string, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return "", err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return "", ErrForbidden
	}
	if ceiling != AskCeilingOff && askModeRank(ceiling) == 0 {
		return "", Invalid("invalid ceiling")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The old value is read under the row lock, so two admins cannot both
	// record the same "from" in the append-only audit table.
	stored, err := q.GetOrganizationAskWriteCeilingForUpdate(ctx, orgID)
	if err != nil {
		return "", err
	}
	before := AskModePlan
	if stored.Valid && stored.String != "" {
		before = stored.String
	}
	if before != ceiling {
		if err := q.SetOrganizationAskWriteCeiling(ctx, db.SetOrganizationAskWriteCeilingParams{Ceiling: ceiling, ActorID: actorID, ID: orgID}); err != nil {
			return "", err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationAskWritePolicyChanged,
			ResourceType: "organization", ResourceID: orgID,
			Changes: audit.Diff(map[string]any{"ask_uni_write_ceiling": before}, map[string]any{"ask_uni_write_ceiling": ceiling}),
		}); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return ceiling, nil
}

// SetAskUniMode saves the person's mode. It is a display-style setting, so it
// writes no audit row (R9).
func (s *AskUNIService) SetAskUniMode(ctx context.Context, userID, mode string) (string, error) {
	if askModeRank(mode) == 0 {
		return "", Invalid("invalid mode")
	}
	if err := s.q.SetUserAskUniMode(ctx, db.SetUserAskUniModeParams{ID: userID, Mode: pgtype.Text{String: mode, Valid: true}}); err != nil {
		return "", err
	}
	return mode, nil
}
