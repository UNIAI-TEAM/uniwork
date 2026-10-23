package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FeatureAITokens is the meter the AI gateway spends (OPEN_QUESTIONS G2:
// 500k per organization per month until billing sets tiers).
const FeatureAITokens = "ai.tokens"

// aiQuota adapts the entitlement gate to ai.Quota. Check runs before the
// provider is asked and fails closed: a plan without the meter, an inactive
// subscription or an exhausted counter all read as "over quota". Record
// meters what was actually charged and never refuses (RecordUsage).
type aiQuota struct{ ent *EntitlementService }

func NewAIQuota(ent *EntitlementService) ai.Quota { return aiQuota{ent: ent} }

func (a aiQuota) Check(ctx context.Context, orgID string) error {
	err := a.ent.CheckQuota(ctx, orgID, FeatureAITokens, 1)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrQuotaExceeded), errors.Is(err, ErrEntitlementRequired), errors.Is(err, ErrSubscriptionInactive):
		return &ai.Error{Code: ai.ErrQuotaExceeded.Code, Status: ai.ErrQuotaExceeded.Status, Msg: ai.ErrQuotaExceeded.Msg, Err: err}
	}
	return err
}

func (a aiQuota) Record(ctx context.Context, in ai.UsageRecord) error {
	if in.Tokens <= 0 {
		return nil
	}
	// The caller's MeterKey is the idempotency key when it named the logical
	// call (G6-03b: UniWork AI's "uniwork-ai:<run id>:<seq>", design §6.4), so
	// a replayed attempt or a reconciled row is the same key and the meter
	// swallows it. Empty keeps the per-event key, which is what every other
	// capability gets.
	key := in.MeterKey
	if key == "" {
		key = "ai:" + in.UsageEventID
	}
	return a.ent.RecordUsage(ctx, a.ent.q, ConsumeInput{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, Meter: FeatureAITokens, Delta: in.Tokens,
		Actor: in.Actor, RefType: "ai_usage_event", RefID: in.UsageEventID, IdempotencyKey: key,
	})
}

// NewAIGateway builds the one gateway the process shares: quota from the
// entitlement gate, events through the process-wide audit recorder. A nil
// provider yields a disabled gateway, which every caller treats as
// "feature hidden".
func NewAIGateway(pool *pgxpool.Pool, q *db.Queries, p provider.Provider, opts ai.Options) *ai.Gateway {
	return ai.NewGateway(q, p, NewAIQuota(NewEntitlementService(pool, q)), auditRecorder, opts)
}
