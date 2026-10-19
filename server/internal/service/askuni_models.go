package service

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askModel is one model a person can pick for Ask UNI (R14). IDs maps a
// provider name to its model id; a provider with no id offers no such model.
// DefaultOn is the state of an organization that never chose.
type askModel struct {
	Key                 string
	IDs                 map[string]string
	Speed, Intelligence int
	DefaultOn           bool
}

// askModels is the catalogue, in the order clients list it. Tests swap it.
var askModels = []askModel{
	{Key: "haiku", IDs: map[string]string{"anthropic": "claude-haiku-5-5"}, Speed: 5, Intelligence: 3, DefaultOn: true},
	{Key: "sonnet", IDs: map[string]string{"anthropic": "claude-sonnet-5-5"}, Speed: 4, Intelligence: 4, DefaultOn: true},
	{Key: "opus", IDs: map[string]string{"anthropic": "claude-opus-5-5"}, Speed: 2, Intelligence: 5, DefaultOn: false},
}

// AskModelOption is one entry of the capabilities' model list: every model
// the gateway can run, enabled or not for the organization.
type AskModelOption struct {
	Key                 string
	Speed, Intelligence int
	Cost                int
	Enabled             bool
}

// askCostTier buckets input plus output price (micros per million tokens).
func askCostTier(totalMicros int64) int {
	switch {
	case totalMicros <= 1_000_000:
		return 1
	case totalMicros <= 5_000_000:
		return 2
	case totalMicros <= 15_000_000:
		return 3
	case totalMicros <= 30_000_000:
		return 4
	}
	return 5
}

// askModelID is the model's id on the gateway's provider, "" when it has none.
func (s *AskUNIService) askModelID(m askModel) string { return m.IDs[s.gw.Provider()] }

// enabledAskKeys turns the stored column into the enabled keys, sorted: NULL is
// the DefaultOn set, and a key the catalogue no longer knows is dropped.
func enabledAskKeys(stored []string) []string {
	out := []string{}
	for _, m := range askModels {
		if (stored == nil && m.DefaultOn) || (stored != nil && slices.Contains(stored, m.Key)) {
			out = append(out, m.Key)
		}
	}
	slices.Sort(out)
	return out
}

// AskModels lists the model keys the organization has switched on, sorted.
func (s *AskUNIService) AskModels(ctx context.Context, actorID, orgID string) ([]string, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	return s.orgAskKeys(ctx, orgID)
}

func (s *AskUNIService) orgAskKeys(ctx context.Context, orgID string) ([]string, error) {
	stored, err := s.q.GetOrganizationAskModels(ctx, orgID)
	if err != nil {
		return nil, err
	}
	return enabledAskKeys(stored), nil
}

// SetAskModels replaces the enabled set; owner or admin only, as for the MCP
// policy. An unchanged set writes nothing, a changed one writes one audit row.
func (s *AskUNIService) SetAskModels(ctx context.Context, actorID, orgID string, keys []string) ([]string, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return nil, err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return nil, ErrForbidden
	}
	want := []string{}
	for _, k := range keys {
		if !slices.ContainsFunc(askModels, func(a askModel) bool { return a.Key == k }) {
			return nil, Invalid("model không hợp lệ")
		}
		if !slices.Contains(want, k) {
			want = append(want, k)
		}
	}
	slices.Sort(want)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	stored, err := q.GetOrganizationAskModelsForUpdate(ctx, orgID)
	if err != nil {
		return nil, err
	}
	before := enabledAskKeys(stored)
	if !slices.Equal(before, want) {
		if err := q.SetOrganizationAskModels(ctx, db.SetOrganizationAskModelsParams{ID: orgID, Models: want, ActorID: actorID}); err != nil {
			return nil, err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationAskModelsChanged,
			ResourceType: "organization", ResourceID: orgID,
			Changes: audit.Diff(map[string]any{"ask_uni_models": strings.Join(before, ",")}, map[string]any{"ask_uni_models": strings.Join(want, ",")}),
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return want, nil
}

// resolveAskModel maps a person's choice to what the run sends. An empty or
// unusable model is Auto ("", the capability's default); an unusable one is
// logged. An effort outside low/medium/high is the Auto effort (R4).
func (s *AskUNIService) resolveAskModel(ctx context.Context, orgID, key, effort string) (modelID, eff string) {
	eff = askAgentEffort
	if effort == "low" || effort == "medium" || effort == "high" {
		eff = effort
	}
	if key == "" {
		return "", eff
	}
	if i := slices.IndexFunc(askModels, func(m askModel) bool { return m.Key == key }); i >= 0 {
		if id := s.askModelID(askModels[i]); id != "" && s.gw.ModelSelectable(ctx, id) {
			if keys, err := s.orgAskKeys(ctx, orgID); err == nil && slices.Contains(keys, key) {
				return id, eff
			}
		}
	}
	slog.Warn("ask uni: model choice not usable, using Auto", "organization_id", orgID, "model", key)
	return "", eff
}

// askModelOptions is the capabilities' list; a model the gateway cannot run
// (no id for the provider, off the allowlist, unpriced) is left out.
func (s *AskUNIService) askModelOptions(ctx context.Context, orgID string) ([]AskModelOption, string) {
	keys, err := s.orgAskKeys(ctx, orgID)
	if err != nil {
		return nil, ""
	}
	auto := s.gw.DefaultModel(ai.CapCopilotAgent)
	opts, autoKey := []AskModelOption{}, ""
	for _, m := range askModels {
		id := s.askModelID(m)
		if id == "" || !s.gw.ModelSelectable(ctx, id) {
			continue
		}
		rate, err := s.q.AiLatestRate(ctx, db.AiLatestRateParams{Provider: s.gw.Provider(), Model: id, EffectiveAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}})
		if err != nil {
			continue
		}
		if id == auto {
			autoKey = m.Key
		}
		opts = append(opts, AskModelOption{
			Key: m.Key, Speed: m.Speed, Intelligence: m.Intelligence, Enabled: slices.Contains(keys, m.Key),
			Cost: askCostTier(rate.InputMicrosPerMtok + rate.OutputMicrosPerMtok),
		})
	}
	return opts, autoKey
}
