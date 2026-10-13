package ai

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The Postgres half of the run store (W-A, design §3/§4): the interface, the
// caps and the sweep reasons are in run_store.go, the SQL in
// server/pkg/db/queries/ai_uniwork.sql, the table in
// 9991791921200662_ai_uniwork_runs.
//
// Opening a run is one INSERT ... SELECT from the conversation it was resumed
// for, and every turn that follows is one conditional UPDATE
// (AiUniworkTakeRunTurn) whose conditions are the live window and both caps -
// so the caps hold across pods without a read-then-write at the service layer
// (design §4.2), and the window never passes the conversation's absolute
// horizon (design §3.4). A turn that reserved nothing asks AiUniworkGetRun
// which refusal it is; a run of another conversation or tenant is not found
// there, never detailed (design §3.5).

// The sweep's batch and loop bounds, the same shape as the conversation
// sweep's: expired runs collected oldest first, orphaned ones after them, each
// batch deleted by primary key so two pods sweeping at once is harmless.
const (
	uniworkRunSweepBatch      = int32(200)
	uniworkRunSweepMaxBatches = 25
)

// RunStorePG is the Postgres RunStore.
type RunStorePG struct {
	queries *db.Queries
	now     func() time.Time
}

// NewRunStore builds the store over the generated queries.
func NewRunStore(queries *db.Queries) *RunStorePG {
	return &RunStorePG{queries: queries, now: time.Now}
}

// TakeTurn implements RunStore.
func (s *RunStorePG) TakeTurn(ctx context.Context, in TakeRunTurn) (Run, error) {
	now := in.Now
	if now.IsZero() {
		now = s.now()
	}
	if in.RunID == "" {
		row, err := s.queries.AiUniworkStartRun(ctx, db.AiUniworkStartRunParams{
			ID:             util.NewID(),
			OrganizationID: in.OrganizationID,
			ConversationID: in.ConversationID,
			CreatedBy:      in.CreatedBy,
			Now:            timestamptz(now),
			IdleSecs:       int32(UniworkRunIdleTTL / time.Second),
			AbsoluteSecs:   int32(UniworkRunAbsoluteTTL / time.Second),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// The conversation was resumed moments before this turn (A9); if
			// its row is gone now, no run can exist for it either, and that is
			// the same answer as an unknown id.
			return Run{}, ErrRunExpired
		}
		if err != nil {
			return Run{}, err
		}
		return runFromRow(row), nil
	}

	row, err := s.queries.AiUniworkTakeRunTurn(ctx, db.AiUniworkTakeRunTurnParams{
		RunID:          in.RunID,
		ConversationID: in.ConversationID,
		OrganizationID: in.OrganizationID,
		ToolRound:      in.ToolRound,
		Now:            timestamptz(now),
		IdleSecs:       int32(UniworkRunIdleTTL / time.Second),
		AbsoluteSecs:   int32(UniworkRunAbsoluteTTL / time.Second),
		ModelCallMax:   int32(UniworkRunModelCallMax),
		ToolRoundMax:   int32(UniworkRunToolRoundMax),
	})
	if err == nil {
		return runFromRow(row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Run{}, err
	}

	// Nothing was reserved: read the run back to say which refusal it is. The
	// read filters all three columns, so a run of another conversation or
	// tenant stays "not found" (design §3.5).
	live, err := s.queries.AiUniworkGetRun(ctx, db.AiUniworkGetRunParams{
		ID:             in.RunID,
		ConversationID: in.ConversationID,
		OrganizationID: in.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrRunExpired
	}
	if err != nil {
		return Run{}, err
	}
	return Run{}, runTurnRefusal(live, in.ToolRound, now)
}

// AddCredits implements RunStore. A run already swept is a no-op: the usage
// row and the meter still carry what the call cost.
func (s *RunStorePG) AddCredits(ctx context.Context, runID, conversationID string, tokens int64) error {
	return s.queries.AiUniworkAddRunCredits(ctx, db.AiUniworkAddRunCreditsParams{
		Tokens: tokens, RunID: runID, ConversationID: conversationID,
	})
}

// runTurnRefusal classifies a turn that reserved nothing (design §4.2): past
// its window or gone is run_expired, a spent cap is run_limit_reached with the
// cap in fields.limit. The final branch is the lost race - a sweep or the
// expiry boundary moved between the UPDATE and the read, leaving a live row
// under both caps - and a turn that reserved nothing is answered "ask again",
// which opens a new run in the same conversation.
func runTurnRefusal(row db.AiUniworkRun, toolRound bool, now time.Time) error {
	if !row.ExpiresAt.Time.After(now) {
		return ErrRunExpired
	}
	if row.ModelCalls >= UniworkRunModelCallMax {
		return RunLimitReached(UniworkRunLimitModelCalls)
	}
	if toolRound && row.ToolRounds >= UniworkRunToolRoundMax {
		return RunLimitReached(UniworkRunLimitToolRounds)
	}
	return ErrRunExpired
}

func runFromRow(row db.AiUniworkRun) Run {
	return Run{
		ID: row.ID, OrganizationID: row.OrganizationID, ConversationID: row.ConversationID,
		ModelCalls: int(row.ModelCalls), ToolRounds: int(row.ToolRounds), Credits: row.Credits,
		CreatedBy: row.CreatedBy, CreatedByKind: row.CreatedByKind,
		CreatedAt: row.CreatedAt.Time, LastUsedAt: row.LastUsedAt.Time, ExpiresAt: row.ExpiresAt.Time,
	}
}

// sweepUniworkRuns deletes the runs past their window and the runs whose
// conversation is gone, in batches so one pass holds no long transaction and
// reports how many of each this pass removed (design §3.4). The TTL worker
// reaches it through ConversationStorePG.SweepRuns, the entry that keeps the
// reason split the runs_swept_total counter needs.
func sweepUniworkRuns(ctx context.Context, q *db.Queries, now time.Time) (int64, int64, error) {
	var expired, orphan int64
	for i := 0; i < uniworkRunSweepMaxBatches; i++ {
		expiredBatch, orphanBatch, full, err := sweepUniworkRunBatch(ctx, q, now)
		expired += expiredBatch
		orphan += orphanBatch
		if err != nil {
			return expired, orphan, err
		}
		if !full {
			break
		}
	}
	return expired, orphan, nil
}

// sweepUniworkRunBatch removes one batch of each reason; full reports that a
// batch came back full, so more may remain.
//
// The orphan batch runs first, so a run whose conversation is gone is counted
// as an orphan even when its own window has passed too: the reason split is
// the only operator signal that a conversation cleanup left runs behind
// (docs/ops/RUNBOOK_AI.md, orphan within ≤ 1 minute of every cleanup), and a
// run the expired batch deleted first would report as ordinary TTL. The
// expired query then sees only runs whose conversation is still there, and no
// row is deleted — or counted — twice (BE3B-9).
func sweepUniworkRunBatch(ctx context.Context, q *db.Queries, now time.Time) (int64, int64, bool, error) {
	var expired, orphan int64
	var full bool
	orphans, err := q.AiUniworkOrphanRunIDs(ctx, uniworkRunSweepBatch)
	if err != nil {
		return 0, 0, false, err
	}
	if len(orphans) > 0 {
		deleted, err := q.AiUniworkDeleteRunsByIDs(ctx, orphans)
		if err != nil {
			return 0, 0, false, err
		}
		orphan, full = deleted, len(orphans) == int(uniworkRunSweepBatch)
	}
	ids, err := q.AiUniworkExpiredRunIDs(ctx, db.AiUniworkExpiredRunIDsParams{
		Now: timestamptz(now), Batch: uniworkRunSweepBatch,
	})
	if err != nil {
		return 0, orphan, full, err
	}
	if len(ids) > 0 {
		deleted, err := q.AiUniworkDeleteRunsByIDs(ctx, ids)
		if err != nil {
			return 0, orphan, full, err
		}
		expired = deleted
		full = full || len(ids) == int(uniworkRunSweepBatch)
	}
	return expired, orphan, full, nil
}
