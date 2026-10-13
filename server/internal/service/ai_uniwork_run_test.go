package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// fakeRunStore is ai.RunStore for the service tests: it answers the scripted
// take and records what the service asked of it. W-A's own tests pin the
// store's SQL (run_store_pg_test.go); here the store is the seam, so what the
// service does with its answers is what these tests read.
type fakeRunStore struct {
	take      ai.Run
	err       error
	takes     []ai.TakeRunTurn
	credits   []runCreditCall
	creditErr error
}

type runCreditCall struct {
	RunID          string
	ConversationID string
	Tokens         int64
}

func (f *fakeRunStore) TakeTurn(_ context.Context, in ai.TakeRunTurn) (ai.Run, error) {
	f.takes = append(f.takes, in)
	if f.err != nil {
		return ai.Run{}, f.err
	}
	return f.take, nil
}

func (f *fakeRunStore) AddCredits(_ context.Context, runID, conversationID string, tokens int64) error {
	f.credits = append(f.credits, runCreditCall{RunID: runID, ConversationID: conversationID, Tokens: tokens})
	return f.creditErr
}

func (f *fakeRunStore) Sweep(context.Context, time.Time) (int64, error) { return 0, nil }

// A run whose model-call cap is spent answers 409 run_limit_reached with
// fields.limit naming the cap (A3, design §2.3): the store decides which cap
// bound, the service hands the refusal to the wire unchanged — no rewrapping
// into ai_quota_exceeded, no silent new run.
func TestAIUniworkRunLimitReachedOnModelCalls(t *testing.T) {
	store := &fakeRunStore{err: ai.RunLimitReached(ai.UniworkRunLimitModelCalls)}
	svc := &AIUniworkService{runs: store, now: time.Now}

	_, err := svc.takeRun(context.Background(), ai.TakeRunTurn{
		OrganizationID: "org-1", ConversationID: "conv-1", RunID: "run-1",
	})
	var ae *ai.Error
	if !errors.As(err, &ae) {
		t.Fatalf("takeRun at the model-call cap = %v, want an *ai.Error", err)
	}
	if ae.Code != "run_limit_reached" || ae.Status != http.StatusConflict {
		t.Fatalf("takeRun at the model-call cap = %s/%d, want run_limit_reached/409", ae.Code, ae.Status)
	}
	if ae.Fields["limit"] != ai.UniworkRunLimitModelCalls {
		t.Fatalf("fields.limit = %v, want %q", ae.Fields["limit"], ai.UniworkRunLimitModelCalls)
	}
	if len(store.takes) != 1 || store.takes[0].RunID != "run-1" || store.takes[0].ConversationID != "conv-1" {
		t.Fatalf("TakeTurn calls = %+v, want one continuation of run-1 in conv-1", store.takes)
	}
}

// The same cap on tool-result rounds: fields.limit = tool_rounds, so logs and
// telemetry can tell the two caps apart (D-3, design §4.2).
func TestAIUniworkRunLimitReachedOnToolRounds(t *testing.T) {
	store := &fakeRunStore{err: ai.RunLimitReached(ai.UniworkRunLimitToolRounds)}
	svc := &AIUniworkService{runs: store, now: time.Now}

	_, err := svc.takeRun(context.Background(), ai.TakeRunTurn{
		OrganizationID: "org-1", ConversationID: "conv-1", RunID: "run-1", ToolRound: true,
	})
	var ae *ai.Error
	if !errors.As(err, &ae) {
		t.Fatalf("takeRun at the tool-round cap = %v, want an *ai.Error", err)
	}
	if ae.Code != "run_limit_reached" || ae.Status != http.StatusConflict {
		t.Fatalf("takeRun at the tool-round cap = %s/%d, want run_limit_reached/409", ae.Code, ae.Status)
	}
	if ae.Fields["limit"] != ai.UniworkRunLimitToolRounds {
		t.Fatalf("fields.limit = %v, want %q", ae.Fields["limit"], ai.UniworkRunLimitToolRounds)
	}
	if len(store.takes) != 1 || !store.takes[0].ToolRound {
		t.Fatalf("TakeTurn calls = %+v, want one tool-round take", store.takes)
	}
}

// A run id the store does not own — unknown, expired, another conversation's
// — answers 409 run_expired (security rule 3, design §2.2), and the service
// never re-opens a run for it: the id goes to the store exactly as the client
// sent it.
func TestAIUniworkRunRejectsForeignRunID(t *testing.T) {
	store := &fakeRunStore{err: ai.ErrRunExpired}
	svc := &AIUniworkService{runs: store, now: time.Now}

	_, err := svc.takeRun(context.Background(), ai.TakeRunTurn{
		OrganizationID: "org-1", ConversationID: "conv-1", RunID: "run-of-someone-else",
	})
	if !errors.Is(err, ai.ErrRunExpired) {
		t.Fatalf("takeRun with a foreign run id = %v, want ErrRunExpired", err)
	}
	var ae *ai.Error
	if !errors.As(err, &ae) || ae.Code != "run_expired" || ae.Status != http.StatusConflict {
		t.Fatalf("takeRun with a foreign run id = %v, want run_expired/409", err)
	}
	if len(store.takes) != 1 || store.takes[0].RunID != "run-of-someone-else" {
		t.Fatalf("TakeTurn calls = %+v, want the foreign id handed over unchanged", store.takes)
	}
}

// fakeRunMetrics is the §7 surface the service reports to, recording what was
// observed.
type fakeRunMetrics struct {
	seconds []float64
	credits []int64
	unknown int64
	dropped map[string]int64
}

func (m *fakeRunMetrics) ObserveUniworkRun(seconds float64, credits int64) {
	m.seconds = append(m.seconds, seconds)
	m.credits = append(m.credits, credits)
}

func (m *fakeRunMetrics) IncUniworkUsageUnknown(calls int64) { m.unknown += calls }

func (m *fakeRunMetrics) IncUniworkDroppedToolCalls(reason string, calls int64) {
	if m.dropped == nil {
		m.dropped = map[string]int64{}
	}
	m.dropped[reason] += calls
}

// A turn's credits and the two run histograms survive a request the client
// already cancelled (design §6.2): addRunCredits settles on a context
// detached from the request, so the store write and the observation happen
// even though ctx is done. The credits the histogram reports are the run's
// after this turn: what the store held before it plus what the vendor
// charged.
func TestAIUniworkRunCreditsSettleAfterCancelledRequest(t *testing.T) {
	store := &fakeRunStore{}
	metrics := &fakeRunMetrics{}
	now := time.Unix(1_700_000_000, 0).UTC()
	svc := &AIUniworkService{runs: store, metrics: metrics, now: func() time.Time { return now }}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	run := ai.Run{
		ID: "run-1", ConversationID: "conv-1", ModelCalls: 2, ToolRounds: 1,
		CreatedAt: now.Add(-30 * time.Second), Credits: 500,
	}
	svc.addRunCredits(ctx, run, 120)

	if len(store.credits) != 1 {
		t.Fatalf("AddCredits calls = %+v, want one despite the cancelled request", store.credits)
	}
	if got := store.credits[0]; got.RunID != "run-1" || got.ConversationID != "conv-1" || got.Tokens != 120 {
		t.Fatalf("AddCredits = %+v, want run-1/conv-1/120", got)
	}
	if len(metrics.seconds) != 1 || metrics.seconds[0] != 30 {
		t.Fatalf("run seconds observed = %v, want [30]", metrics.seconds)
	}
	if len(metrics.credits) != 1 || metrics.credits[0] != 620 {
		t.Fatalf("run credits observed = %v, want [620]", metrics.credits)
	}
}

// A deployment without a run store (the scaffold seam) records no credits and
// observes nothing: there is no run to name.
func TestAIUniworkRunCreditsWithoutStore(t *testing.T) {
	metrics := &fakeRunMetrics{}
	svc := &AIUniworkService{metrics: metrics, now: time.Now}
	svc.addRunCredits(context.Background(), ai.Run{}, 120)
	if len(metrics.seconds) != 0 || len(metrics.credits) != 0 {
		t.Fatalf("a run-less turn observed %v/%v, want nothing", metrics.seconds, metrics.credits)
	}
}

// The meter key names the model call the run is about to make (design §6.4):
// uniwork-ai:<run id>:<seq>, where seq is model_calls after the take, so a
// replayed charge is the same key and the meter swallows it.
func TestAIUniworkMeterKeyNamesRunAndSeq(t *testing.T) {
	got := uniworkMeterKey(ai.Run{ID: "01HZZZZZZZZZZZZZZZZZZZZZZZ", ModelCalls: 3})
	if got != "uniwork-ai:01HZZZZZZZZZZZZZZZZZZZZZZZ:3" {
		t.Fatalf("uniworkMeterKey = %q, want uniwork-ai:<run id>:3", got)
	}
	if got := uniworkMeterKey(ai.Run{}); got != "" {
		t.Fatalf("uniworkMeterKey without a run = %q, want \"\" (the gateway's own per-event key)", got)
	}
}

// A spent ai.tokens meter answers 402 credits_exhausted with fields.meter —
// the same shape as the organization-tier cloud route, so the client routes
// both to its credits state. The other two entitlement refusals keep their
// own code: they are about the plan, and the client must run its plan path,
// not its credits path (design §6.1).
func TestAIUniworkCreditsExhaustedBeforeGateway(t *testing.T) {
	got := uniworkQuotaErr(errQuotaExceeded(FeatureAITokens, 1000, 1000, 1))
	var ce CodedError
	if !errors.As(got, &ce) || ce.Code != "credits_exhausted" || ce.Status != http.StatusPaymentRequired {
		t.Fatalf("spent meter = %v, want credits_exhausted/402", got)
	}
	if ce.Fields["meter"] != FeatureAITokens {
		t.Fatalf("fields.meter = %v, want %q", ce.Fields["meter"], FeatureAITokens)
	}
	if !errors.Is(got, ErrQuotaExceeded) {
		t.Fatalf("spent meter = %v, want it to still match ErrQuotaExceeded", got)
	}
	for _, in := range []struct {
		name string
		err  error
		code string
	}{
		{"entitlement_required", errEntitlementRequired(string(FeatureOfficeAICloud)), "entitlement_required"},
		{"subscription_inactive", errSubscriptionInactive("past_due"), "subscription_inactive"},
	} {
		got := uniworkQuotaErr(in.err)
		if !errors.As(got, &ce) || ce.Code != in.code {
			t.Fatalf("%s refusal = %v, want its own code %s", in.name, got, in.code)
		}
		if ce.Code == "credits_exhausted" {
			t.Fatalf("%s refusal turned into credits_exhausted; the plan path and the credits path must stay apart", in.name)
		}
	}
}
