package ai

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A16's reconciliation pass (G6-03b, design §6.3): a vendor that sends no
// usage block leaves a succeeded row with reason_code usage_unknown and no
// charge — never a zero-token charge, which would claim nobody counted
// anything. This pass prices those rows from the transcript stored for them
// (the same characters/4 rule every other cap in the package uses), claims
// each row with one conditional update so two passes or two pods cannot price
// it twice, and records the meter once under the row's own event id. The TTL
// worker runs it beside its sweeps; it answers no request.

// UniworkUsageReconcileBatch is how many unknown-usage rows one pass prices.
const UniworkUsageReconcileBatch = 20

// UsageReconcileMetrics is the counter surface the pass reports to, declared
// where it is used (metrics.AIUniwork satisfies it; design §7).
type UsageReconcileMetrics interface {
	IncUniworkUsageReconciled(rows int64)
}

// UsageReconciler prices the unknown-usage queue. box is the conversation
// key's secretbox (the transcript is sealed with it); quota is the same
// entitlement adapter the Gateway meters through.
type UsageReconciler struct {
	q       *db.Queries
	box     *secretbox.Box
	quota   Quota
	metrics UsageReconcileMetrics
	now     func() time.Time
	log     *slog.Logger
}

func NewUsageReconciler(q *db.Queries, box *secretbox.Box, quota Quota, metrics UsageReconcileMetrics) *UsageReconciler {
	return &UsageReconciler{q: q, box: box, quota: quota, metrics: metrics, now: time.Now, log: slog.Default()}
}

// SetClock replaces the reconciler's clock (tests).
func (r *UsageReconciler) SetClock(now func() time.Time) { r.now = now }

// ReconcileUnknownUsage prices up to batch rows of the unknown-usage queue
// and reports how many it claimed. A row whose transcript is gone is left in
// the queue and logged: this pass never invents a number (design §6.3), and
// leaving the row keeps it visible instead of charging a guess.
func (r *UsageReconciler) ReconcileUnknownUsage(ctx context.Context, batch int) (int64, error) {
	if batch <= 0 {
		return 0, nil
	}
	rows, err := r.q.AiUniworkUnknownUsageEvents(ctx, int32(batch))
	if err != nil {
		return 0, err
	}
	var reconciled int64
	for _, row := range rows {
		claimed, err := r.reconcileOne(ctx, row)
		if err != nil {
			return reconciled, err
		}
		if claimed {
			reconciled++
		}
	}
	return reconciled, nil
}

// reconcileOne prices one usage row from its stored transcript and claims it.
// It answers false when it claimed nothing: the transcript is gone, its turns
// are unreadable, or another pass priced the row first.
func (r *UsageReconciler) reconcileOne(ctx context.Context, row db.AiUsageEvent) (bool, error) {
	turn, err := r.q.AiUniworkTurnByUsageEvent(ctx, db.AiUniworkTurnByUsageEventParams{
		OrganizationID: row.OrganizationID, UsageEventID: pgtype.Text{String: row.ID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		r.log.Warn("ai: usage reconcile: transcript gone", "usage_event_id", row.ID)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	turns, err := r.q.AiUniworkTurnsToUsageEvent(ctx, db.AiUniworkTurnsToUsageEventParams{
		ConversationID: turn.ConversationID, Seq: turn.Seq,
	})
	if err != nil {
		return false, err
	}
	messages := make([]Turn, 0, len(turns))
	for _, t := range turns {
		message, err := r.openTurn(t.Ciphertext)
		if err != nil {
			r.log.Warn("ai: usage reconcile: turn unreadable",
				"usage_event_id", row.ID, "turn_id", t.ID, "err", err)
			return false, nil
		}
		messages = append(messages, Turn{Seq: t.Seq, UsageEventID: t.UsageEventID.String, Message: message})
	}
	input, output := estimateUsageTokens(messages, row.ID)
	rateID, cost, err := r.price(ctx, row, input, output)
	if err != nil {
		return false, err
	}
	claimed, err := r.q.AiUniworkClaimUnknownUsage(ctx, db.AiUniworkClaimUnknownUsageParams{
		ID: row.ID, RateID: rateID, InputTokens: int32(input), OutputTokens: int32(output), CostMicros: cost,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Another pass or pod priced the row first: nothing to meter.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// The meter is idempotent per usage event ("ai:<event id>"), so a claimed
	// row records exactly once even if this branch is reached twice.
	if r.quota != nil && input+output > 0 {
		if err := r.quota.Record(ctx, UsageRecord{
			OrganizationID: claimed.OrganizationID, WorkspaceID: claimed.WorkspaceID.String,
			Actor:        audit.Actor{ID: claimed.ActorID, Kind: audit.Kind(claimed.ActorKind)},
			Tokens:       int64(input + output),
			UsageEventID: claimed.ID,
		}); err != nil {
			r.log.Warn("ai: usage reconcile: quota record", "usage_event_id", claimed.ID, "err", err)
		}
	}
	if r.metrics != nil {
		r.metrics.IncUniworkUsageReconciled(1)
	}
	return true, nil
}

// price is the estimate priced at the row's own provider and model, exactly
// as the Gateway prices a reported call (AiLatestRate). A rate table with no
// row for the model prices at zero, as the Gateway does; a lookup that fails
// for any other reason stops the row: claiming it at zero would lose the
// charge to a database that was merely slow.
func (r *UsageReconciler) price(ctx context.Context, row db.AiUsageEvent, input, output int) (pgtype.Text, int64, error) {
	rate, err := r.q.AiLatestRate(ctx, db.AiLatestRateParams{
		Provider: row.Provider, Model: row.Model, EffectiveAt: pgtype.Timestamptz{Time: r.now(), Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.Text{}, 0, nil
		}
		return pgtype.Text{}, 0, err
	}
	cost := int64(input)*rate.InputMicrosPerMtok/1_000_000 + int64(output)*rate.OutputMicrosPerMtok/1_000_000
	return pgtype.Text{String: rate.ID, Valid: true}, cost, nil
}

// openTurn reads one sealed transcript turn. It is the reconciler's copy of
// the store's own open: the store owns its box field, this pass only has the
// key.
func (r *UsageReconciler) openTurn(ciphertext []byte) (provider.Message, error) {
	if r.box == nil {
		return provider.Message{}, ErrConversationStoreDisabled
	}
	raw, err := r.box.Open(ciphertext)
	if err != nil {
		return provider.Message{}, err
	}
	var payload turnPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return provider.Message{}, err
	}
	return provider.Message{
		Role: payload.Role, Content: payload.Content, ToolCalls: payload.ToolCalls, ToolCallID: payload.ToolCallID,
	}, nil
}

// estimateUsageTokens is the §6.3 estimate: the same characters/4 rule as
// estimateTokens, summed over every turn the model was sent (input) and over
// the assistant answer the usage row belongs to (output). A turn's tool-call
// arguments count too — they are tokens the model produced.
func estimateUsageTokens(turns []Turn, usageEventID string) (input, output int) {
	for _, t := range turns {
		n := estimateTokens(messageText(t.Message))
		if t.UsageEventID == usageEventID {
			output += n
			continue
		}
		input += n
	}
	return input, output
}

// messageText is the character count one stored message contributes: its
// content plus the names and arguments of the tool calls it carries.
func messageText(m provider.Message) string {
	var b strings.Builder
	b.WriteString(m.Content)
	for _, c := range m.ToolCalls {
		b.WriteString(c.Name)
		b.Write(c.Input)
	}
	return b.String()
}
