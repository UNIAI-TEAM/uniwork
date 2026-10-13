package ai

import (
	"context"
	"net/http"
	"time"
)

// The UniWork AI run (G6-03b, G6-D1 A3/A12): one server-issued run id counting
// what a single question may spend — model calls and tool-result rounds —
// across every pod. Like the conversation store, the interface and its types
// live in this package because only internal/ai may call the Ai* sqlc queries
// (ADR 0010; TestAIPackageOnlyCallsAiQueries), and because a run is
// infrastructure state, not business state: no audit row, no outbox event
// (A16; design §8). The Postgres implementation, the migration and the sweep
// of the TTL worker are W-A's, behind this shape (design §3).
//
// Design: reports/g6-ai_server/g6-03b-design.md.

const (
	// UniworkRunModelCallMax is A3's cap of model calls per run. A call is
	// counted when the turn reaches the Gateway, retries included; a turn
	// refused before the Gateway (rate limit, concurrency, quota) counts for
	// nothing (design §4.1).
	UniworkRunModelCallMax = 10
	// UniworkRunToolRoundMax is A3's cap of tool-result rounds per run.
	UniworkRunToolRoundMax = 8
	// UniworkRunIdleTTL and UniworkRunAbsoluteTTL mirror the conversation's
	// TTLs: a run never outlives the conversation that owns it (design §3.4).
	UniworkRunIdleTTL     = ConversationIdleTTL
	UniworkRunAbsoluteTTL = ConversationAbsoluteTTL

	// UniworkRunSweepExpired and UniworkRunSweepOrphan are the reasons of
	// uniwork_ai_uniwork_runs_swept_total{%reason}.
	UniworkRunSweepExpired = "expired"
	UniworkRunSweepOrphan  = "orphan"
)

// The limit a run_limit_reached refusal names in Fields["limit"] (design §4.2).
const (
	UniworkRunLimitModelCalls = "model_calls"
	UniworkRunLimitToolRounds = "tool_rounds"
)

var (
	// ErrRunExpired answers a run id that is unknown, expired or another
	// conversation's (security rule 3): the client drops the run id and asks
	// again, which opens a new run in the same conversation. 409 like
	// conversation_expired; the code is new and waits on its contract-p0 row
	// (design §2.3, §12 Q1).
	ErrRunExpired = &Error{Code: "run_expired", Status: http.StatusConflict,
		Msg: "lượt chạy (run) đã kết thúc hoặc không thuộc hội thoại này; hãy hỏi lại để mở lượt chạy mới"}
)

// RunLimitReached is A3: a cap is spent. 409 and not a quota denial (Q2,
// contract-p0 §4); fields.limit names which cap so logs and telemetry can
// tell them apart (design §4.2).
func RunLimitReached(limit string) *Error {
	return &Error{Code: "run_limit_reached", Status: http.StatusConflict,
		Msg:    "lượt chạy đã dùng hết số bước cho phép; hãy hỏi tiếp để mở lượt chạy mới",
		Fields: map[string]any{"limit": limit}}
}

// Run is one run's counters and live window, as the store answers them.
type Run struct {
	ID             string
	OrganizationID string
	ConversationID string
	ModelCalls     int
	ToolRounds     int
	Credits        int64
	CreatedBy      string
	CreatedByKind  string
	CreatedAt      time.Time
	LastUsedAt     time.Time
	ExpiresAt      time.Time
}

// TakeRunTurn is one turn reserving its model call. RunID empty opens a run
// for the conversation; otherwise the named run is continued. ToolRound
// reserves a tool-result round as well. CreatedBy is the user the run is
// bound to (kind: human), for the attribution pair of ADR 0007.
type TakeRunTurn struct {
	OrganizationID string
	ConversationID string
	RunID          string
	ToolRound      bool
	CreatedBy      string
	Now            time.Time
}

// RunStore is W-A's seam. TakeTurn is the only path that moves the counters,
// so the caps hold across pods (design §4.2), and AddCredits records what an
// answered call cost.
//
// The sweep is not here: the TTL worker reaches runs through its own
// ConversationMaintenance.SweepRuns, because the runbook's counter needs the
// reason split (uniwork_ai_uniwork_runs_swept_total{reason}) a one-count
// method cannot carry. The scaffold's Sweep method had no caller and went with
// BE3B-11; both paths still share sweepUniworkRuns.
type RunStore interface {
	// TakeTurn reserves one model call for the turn about to reach the
	// Gateway — and one tool round when the turn answers the model's calls —
	// opening a run when RunID is empty. It answers ErrRunExpired when the
	// named run is unknown, expired or not this conversation's, and
	// RunLimitReached when a cap is already spent.
	TakeTurn(ctx context.Context, in TakeRunTurn) (Run, error)
	// AddCredits records the tokens one answered model call cost, so the run
	// carries what it spent (uniwork_ai_uniwork_run_credits, design §7).
	AddCredits(ctx context.Context, runID, conversationID string, tokens int64) error
}

// RunSweepMetrics is the counter surface the sweep needs, declared where it is
// used so this package does not import Prometheus (metrics.AIUniwork
// satisfies it; design §7).
type RunSweepMetrics interface {
	IncUniworkRunsSwept(reason string, runs int64)
}

// UniworkUsageReconciler is the usage reconciliation pass the TTL worker runs
// beside its sweeps (design §6.3). Nil skips it.
type UniworkUsageReconciler interface {
	ReconcileUnknownUsage(ctx context.Context, batch int) (int64, error)
}
