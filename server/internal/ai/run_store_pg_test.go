package ai

// The run store's tests (G6-03b W-A, design §3/§4/§10). The DB-backed half
// skips where no test database is reachable (testutil.DB; the cloud round owns
// those rows); the refusal classification and the runs sweep of the TTL worker
// are pure and always run.

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// --- the refusal mapping (pure) --------------------------------------------

// A turn that reserved nothing names which refusal it is (design §4.2): the
// run past its window is run_expired, a spent cap is run_limit_reached with
// the cap in fields.limit, and a row under both caps (the lost race between
// the UPDATE and the read) answers run_expired - the turn really did reserve
// nothing, so asking again is the honest answer. A spent cap answers with the
// run that was refused beside the error (A12: the refusal is an answer of that
// run, and the wire names it); a run that is gone names nothing.
func TestRunStoreRefusalNamesTheSpentCap(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	row := func(mutate func(*db.AiUniworkRun)) db.AiUniworkRun {
		r := db.AiUniworkRun{
			ID: "run-1", ModelCalls: 1,
			ExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
		}
		if mutate != nil {
			mutate(&r)
		}
		return r
	}

	if run, err := runTurnRefusal(row(func(r *db.AiUniworkRun) {
		r.ExpiresAt = pgtype.Timestamptz{Time: now.Add(-time.Second), Valid: true}
	}), false, now); !errors.Is(err, ErrRunExpired) || run.ID != "" {
		t.Fatalf("expired run = %v / %q, want ErrRunExpired with no run named", err, run.ID)
	}

	atCallCap := row(func(r *db.AiUniworkRun) { r.ModelCalls = UniworkRunModelCallMax })
	if run, err := runTurnRefusal(atCallCap, false, now); !isRunLimit(err, UniworkRunLimitModelCalls) || run.ID != "run-1" {
		t.Fatalf("spent call cap = %v / %q, want run_limit_reached(model_calls) naming run-1", err, run.ID)
	}
	if _, err := runTurnRefusal(atCallCap, true, now); !isRunLimit(err, UniworkRunLimitModelCalls) {
		t.Fatalf("a tool round at the call cap = %v, want the call cap to win", err)
	}

	atRoundCap := row(func(r *db.AiUniworkRun) {
		r.ModelCalls = 2
		r.ToolRounds = UniworkRunToolRoundMax
	})
	if run, err := runTurnRefusal(atRoundCap, true, now); !isRunLimit(err, UniworkRunLimitToolRounds) || run.ID != "run-1" {
		t.Fatalf("spent round cap = %v / %q, want run_limit_reached(tool_rounds) naming run-1", err, run.ID)
	}

	if run, err := runTurnRefusal(row(nil), false, now); !errors.Is(err, ErrRunExpired) || run.ID != "" {
		t.Fatalf("under both caps = %v / %q, want ErrRunExpired with no run named (nothing was reserved)", err, run.ID)
	}
}

func isRunLimit(err error, limit string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == "run_limit_reached" &&
		e.Status == http.StatusConflict && e.Fields["limit"] == limit
}

func wantRunLimitReached(t *testing.T, err error, limit string) {
	t.Helper()
	if !isRunLimit(err, limit) {
		t.Fatalf("err = %v, want run_limit_reached with fields.limit = %s", err, limit)
	}
}

// --- the TTL worker's runs sweep (pure) ------------------------------------

// The worker sweeps runs in the same pass as conversations (design §3.4):
// both reasons come back in the result, each lands on its own counter, and the
// reconciler runs with the pass's batch. Metrics and reconciler are optional.
func TestAIUniworkTTLWorkerSweepsRunsAndReconciles(t *testing.T) {
	ctx := context.Background()
	store := &fakeConversations{sweptRunsExpired: 2, sweptRunsOrphan: 3, live: 9}
	metrics := &fakeRunSweepMetrics{}
	reconciler := &fakeUsageReconciler{}
	w := NewConversationTTLWorker(store, nil, time.Minute, nil)
	w.SetRunMetrics(metrics)
	w.SetUsageReconciler(reconciler)

	result, err := w.SweepOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.RunsExpired != 2 || result.RunsOrphan != 3 {
		t.Fatalf("runs swept = %d expired / %d orphan, want 2 / 3", result.RunsExpired, result.RunsOrphan)
	}
	if got := metrics.byReason[UniworkRunSweepExpired]; got != 2 {
		t.Fatalf("runs_swept{expired} = %d, want 2", got)
	}
	if got := metrics.byReason[UniworkRunSweepOrphan]; got != 3 {
		t.Fatalf("runs_swept{orphan} = %d, want 3", got)
	}
	if len(reconciler.batches) != 1 || reconciler.batches[0] != UniworkUsageReconcileBatch {
		t.Fatalf("reconcile batches = %v, want [%d]", reconciler.batches, UniworkUsageReconcileBatch)
	}
	if result.Live != 9 {
		t.Fatalf("live = %d, want 9", result.Live)
	}

	t.Run("nil metrics and reconciler are safe", func(t *testing.T) {
		bare := NewConversationTTLWorker(&fakeConversations{}, nil, time.Minute, nil)
		if _, err := bare.SweepOnce(ctx); err != nil {
			t.Fatalf("sweep without metrics/reconciler: %v", err)
		}
	})

	t.Run("a reconciler error ends the pass", func(t *testing.T) {
		boom := errors.New("reconcile boom")
		w := NewConversationTTLWorker(&fakeConversations{sweptRunsExpired: 1}, nil, time.Minute, nil)
		w.SetUsageReconciler(&fakeUsageReconciler{err: boom})
		result, err := w.SweepOnce(ctx)
		if !errors.Is(err, boom) {
			t.Fatalf("err = %v, want the reconciler's", err)
		}
		if result.RunsExpired != 1 {
			t.Fatalf("runs swept before the failure = %d, want 1", result.RunsExpired)
		}
	})
}

type fakeRunSweepMetrics struct{ byReason map[string]int64 }

func (f *fakeRunSweepMetrics) IncUniworkRunsSwept(reason string, runs int64) {
	if f.byReason == nil {
		f.byReason = map[string]int64{}
	}
	f.byReason[reason] += runs
}

type fakeUsageReconciler struct {
	batches []int
	err     error
}

func (f *fakeUsageReconciler) ReconcileUnknownUsage(_ context.Context, batch int) (int64, error) {
	f.batches = append(f.batches, batch)
	return 0, f.err
}

// --- the store (DB-backed; skips without a test database) -------------------

func runStoreFixture(t *testing.T) (*RunStorePG, *ConversationStorePG, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, "DELETE FROM ai_uniwork_runs")
		_, _ = pool.Exec(ctx, "DELETE FROM ai_uniwork_turns")
		_, _ = pool.Exec(ctx, "DELETE FROM ai_uniwork_conversations")
	})
	return NewRunStore(q), NewConversationStore(pool, q, testConversationBox(t)), pool
}

// seedRunConversation writes one conversation the way ConversationStore.Create
// writes it, born at createdAt.
func seedRunConversation(t *testing.T, pool *pgxpool.Pool, organizationID, userID string, createdAt time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := pool.Exec(context.Background(), `INSERT INTO ai_uniwork_conversations
		(id, organization_id, user_id, module, created_by, created_by_kind, created_at, last_used_at, expires_at)
		VALUES ($1, $2, $3, 'sheets', $3, 'human', $4, $4, $5)`,
		id, organizationID, userID, createdAt, createdAt.Add(ConversationIdleTTL)); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	return id
}

func runCounters(t *testing.T, pool *pgxpool.Pool, runID string) (int32, int32) {
	t.Helper()
	var calls, rounds int32
	if err := pool.QueryRow(context.Background(),
		`SELECT model_calls, tool_rounds FROM ai_uniwork_runs WHERE id = $1`, runID).Scan(&calls, &rounds); err != nil {
		t.Fatal(err)
	}
	return calls, rounds
}

// Opening a run spends the question turn that reached the Gateway; a question
// turn continues it, a tool-result round spends a round beside its call, and
// credits land on the run (design §2.2, §4.2).
func TestRunStoreTakeTurnOpensAndContinues(t *testing.T) {
	store, _, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	conv := seedRunConversation(t, pool, "org-a", "user-a", now)

	run, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: conv, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if run.ID == "" || run.ModelCalls != 1 || run.ToolRounds != 0 || run.Credits != 0 {
		t.Fatalf("opened run = %+v, want one model call and nothing else", run)
	}
	if run.CreatedBy != "user-a" || run.CreatedByKind != "human" {
		t.Fatalf("attribution = %s/%s, want the human pair", run.CreatedBy, run.CreatedByKind)
	}
	if want := now.Add(UniworkRunIdleTTL); !run.ExpiresAt.Equal(want) {
		t.Fatalf("opened window = %s, want %s", run.ExpiresAt, want)
	}

	next, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if next.ID != run.ID || next.ModelCalls != 2 || next.ToolRounds != 0 {
		t.Fatalf("continued run = %+v, want the same run at two calls", next)
	}

	tool, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, ToolRound: true, Now: now.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if tool.ModelCalls != 3 || tool.ToolRounds != 1 {
		t.Fatalf("tool round = %d calls / %d rounds, want 3 / 1", tool.ModelCalls, tool.ToolRounds)
	}

	if err := store.AddCredits(ctx, run.ID, conv, 1234); err != nil {
		t.Fatal(err)
	}
	after, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(3 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if after.Credits != 1234 {
		t.Fatalf("credits = %d, want 1234 to survive the next turn", after.Credits)
	}
	if !after.LastUsedAt.Equal(now.Add(3 * time.Minute)) {
		t.Fatalf("last_used_at = %s, want the turn's clock", after.LastUsedAt)
	}
}

// A run never outlives its conversation (design §3.4): a conversation near its
// 24 h absolute horizon hands the run that horizon, not its own 30 min idle
// window, and continuing the run does not push past it.
func TestRunStoreRunNeverOutlivesConversation(t *testing.T) {
	store, _, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	birth := now.Add(-(UniworkRunAbsoluteTTL - 5*time.Minute))
	conv := seedRunConversation(t, pool, "org-a", "user-a", birth)
	want := birth.Add(UniworkRunAbsoluteTTL)
	if !want.Before(now.Add(UniworkRunIdleTTL)) {
		t.Fatalf("fixture: the conversation horizon %s is not inside the idle window", want)
	}

	run, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: conv, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !run.ExpiresAt.Equal(want) {
		t.Fatalf("opened window = %s, want the conversation's horizon %s", run.ExpiresAt, want)
	}

	next, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !next.ExpiresAt.Equal(want) {
		t.Fatalf("refreshed window = %s, want it clamped at %s", next.ExpiresAt, want)
	}
}

// The caps are held by the UPDATE itself (design §4.2): ten model calls, eight
// tool rounds, and a refusal spends nothing.
func TestRunStoreCapsRefuseAtModelCallsAndToolRounds(t *testing.T) {
	store, _, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	conv := seedRunConversation(t, pool, "org-a", "user-a", now)

	run, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: conv, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < UniworkRunModelCallMax; i++ {
		if _, err := store.TakeTurn(ctx, TakeRunTurn{
			RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatalf("turn %d of %d: %v", i+1, UniworkRunModelCallMax, err)
		}
	}
	_, err = store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(time.Minute),
	})
	wantRunLimitReached(t, err, UniworkRunLimitModelCalls)
	if calls, _ := runCounters(t, pool, run.ID); calls != UniworkRunModelCallMax {
		t.Fatalf("model_calls = %d after the refusal, want %d", calls, UniworkRunModelCallMax)
	}

	// A fresh run in the same conversation spends its rounds.
	rounds, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: conv, CreatedBy: "user-a", Now: now.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < UniworkRunToolRoundMax; i++ {
		if _, err := store.TakeTurn(ctx, TakeRunTurn{
			RunID: rounds.ID, OrganizationID: "org-a", ConversationID: conv, ToolRound: true,
			Now: now.Add(2*time.Minute + time.Duration(i)*time.Second),
		}); err != nil {
			t.Fatalf("tool round %d of %d: %v", i+1, UniworkRunToolRoundMax, err)
		}
	}
	_, err = store.TakeTurn(ctx, TakeRunTurn{
		RunID: rounds.ID, OrganizationID: "org-a", ConversationID: conv, ToolRound: true,
		Now: now.Add(3 * time.Minute),
	})
	wantRunLimitReached(t, err, UniworkRunLimitToolRounds)

	// The last model call is still spendable: the round cap refused the ninth
	// round, not the tenth call.
	if _, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: rounds.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(4 * time.Minute),
	}); err != nil {
		t.Fatalf("the tenth call: %v", err)
	}
	_, err = store.TakeTurn(ctx, TakeRunTurn{
		RunID: rounds.ID, OrganizationID: "org-a", ConversationID: conv, Now: now.Add(5 * time.Minute),
	})
	wantRunLimitReached(t, err, UniworkRunLimitModelCalls)
	if calls, toolRounds := runCounters(t, pool, rounds.ID); calls != UniworkRunModelCallMax || toolRounds != UniworkRunToolRoundMax {
		t.Fatalf("counters = %d calls / %d rounds, want %d / %d", calls, toolRounds,
			UniworkRunModelCallMax, UniworkRunToolRoundMax)
	}
}

// The G7-12 official session's 409 at the store (2026-10-16): one question
// turn and eight tool rounds are answered, and the ninth tool round — the
// run's tenth model call — is refused run_limit_reached(tool_rounds). The run
// is still live, so the refusal answers with it beside the error: the wire
// names the run on those answers (A12, design §2.1), while a run past its
// window is run_expired and names nothing (the client drops the id).
func TestRunStoreToolRoundCapNamesTheRefusedRun(t *testing.T) {
	store, _, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	conv := seedRunConversation(t, pool, "org-a", "user-a", now)

	run, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: conv, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	for round := 1; round <= UniworkRunToolRoundMax; round++ {
		if _, err := store.TakeTurn(ctx, TakeRunTurn{
			RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, ToolRound: true,
			Now: now.Add(time.Duration(round) * time.Second),
		}); err != nil {
			t.Fatalf("tool round %d of %d: %v", round, UniworkRunToolRoundMax, err)
		}
	}
	refused, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv, ToolRound: true,
		Now: now.Add(time.Minute),
	})
	wantRunLimitReached(t, err, UniworkRunLimitToolRounds)
	if refused.ID != run.ID || refused.ConversationID != conv {
		t.Fatalf("refusal named run %q of conversation %q, want %q of %q", refused.ID, refused.ConversationID, run.ID, conv)
	}
	if calls, rounds := runCounters(t, pool, run.ID); calls != UniworkRunModelCallMax-1 || rounds != UniworkRunToolRoundMax {
		t.Fatalf("counters after the refusal = %d calls / %d rounds, want %d / %d",
			calls, rounds, UniworkRunModelCallMax-1, UniworkRunToolRoundMax)
	}

	gone, err := store.TakeTurn(ctx, TakeRunTurn{
		RunID: run.ID, OrganizationID: "org-a", ConversationID: conv,
		Now: now.Add(UniworkRunIdleTTL + time.Minute),
	})
	if !errors.Is(err, ErrRunExpired) || gone.ID != "" {
		t.Fatalf("turn past the window = %v / %q, want ErrRunExpired naming no run", err, gone.ID)
	}
}

// A run id that is unknown, past its window, another conversation's or another
// tenant's is the same 409 run_expired, and never reveals which (design §2.2
// rule 3, §3.5).
func TestRunStoreRejectsExpiredAndForeignRunID(t *testing.T) {
	store, _, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	convA := seedRunConversation(t, pool, "org-a", "user-a", now)
	convB := seedRunConversation(t, pool, "org-b", "user-b", now)
	runA, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: convA, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]TakeRunTurn{
		"past its window": {
			RunID: runA.ID, OrganizationID: "org-a", ConversationID: convA,
			Now: now.Add(UniworkRunIdleTTL + time.Minute),
		},
		"another conversation's": {
			RunID: runA.ID, OrganizationID: "org-b", ConversationID: convB, Now: now,
		},
		"another tenant's": {
			RunID: runA.ID, OrganizationID: "org-b", ConversationID: convA, Now: now,
		},
		"unknown": {
			RunID: util.NewID(), OrganizationID: "org-a", ConversationID: convA, Now: now,
		},
	}
	for name, in := range cases {
		if _, err := store.TakeTurn(ctx, in); !errors.Is(err, ErrRunExpired) {
			t.Errorf("%s = %v, want ErrRunExpired", name, err)
		}
	}

	// Opening a run for a conversation of another tenant inserts nothing.
	if _, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-b", ConversationID: convA, CreatedBy: "user-b", Now: now,
	}); !errors.Is(err, ErrRunExpired) {
		t.Fatalf("opening under the wrong tenant = %v, want ErrRunExpired", err)
	}
}

// The sweep deletes the runs past their window and the runs whose conversation
// is gone, and leaves the live ones (design §3.4): both reasons happen in one
// pass, and each reason counts what it deleted.
func TestRunStoreSweepExpiredAndOrphanRuns(t *testing.T) {
	store, conversations, pool := runStoreFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)

	convExpired := seedRunConversation(t, pool, "org-a", "user-a", now)
	runExpired, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: convExpired, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}

	convOrphan := seedRunConversation(t, pool, "org-a", "user-a", now)
	runOrphan, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: convOrphan, CreatedBy: "user-a", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	// A cleanup path (document deleted, membership gone) removes the
	// conversation; its run is the orphan the sweep collects.
	if err := conversations.Delete(ctx, convOrphan); err != nil {
		t.Fatal(err)
	}

	convLive := seedRunConversation(t, pool, "org-a", "user-a", now)
	runLive, err := store.TakeTurn(ctx, TakeRunTurn{
		OrganizationID: "org-a", ConversationID: convLive, CreatedBy: "user-a", Now: now.Add(25 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}

	sweptAt := now.Add(UniworkRunIdleTTL + time.Minute)
	expired, orphan, err := conversations.SweepRuns(ctx, sweptAt)
	if err != nil {
		t.Fatal(err)
	}
	if expired != 1 || orphan != 1 {
		// The windows, not only the counts: a run counted under the wrong
		// reason is a classification answer, and "2 expired / 0 orphan" hid
		// that the orphan's window had passed too (BE3B-9).
		t.Fatalf("sweep at %s = %d expired / %d orphan, want 1 / 1 (expired %s expires %s, orphan %s expires %s, live %s expires %s)",
			sweptAt.Format(time.RFC3339Nano), expired, orphan,
			runExpired.ID, runExpired.ExpiresAt.Format(time.RFC3339Nano),
			runOrphan.ID, runOrphan.ExpiresAt.Format(time.RFC3339Nano),
			runLive.ID, runLive.ExpiresAt.Format(time.RFC3339Nano))
	}
	var remaining []string
	rows, err := pool.Query(ctx, `SELECT id FROM ai_uniwork_runs ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		remaining = append(remaining, id)
	}
	if len(remaining) != 1 || remaining[0] != runLive.ID {
		t.Fatalf("remaining runs = %v, want only %s (expired %s and orphan %s gone)",
			remaining, runLive.ID, runExpired.ID, runOrphan.ID)
	}
}
