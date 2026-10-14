package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// ---- Full-turn tests over the real gates (DB-backed, skip without
// TEST_DATABASE_URL; the cloud round runs them). The run store is a scripted
// fake because W-A owns the SQL store and its own tests — here the service's
// use of the seam is what is under test. ----

// scriptedProvider answers what the test scripts and records the requests the
// service sent, so a test can read the history a later run replays.
type scriptedProvider struct {
	mu    sync.Mutex
	calls []provider.CompletionRequest
	reply func(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error)
}

func (p *scriptedProvider) Name() string { return "fake" }

func (p *scriptedProvider) Embed(context.Context, provider.EmbedRequest) (provider.EmbedResponse, error) {
	return provider.EmbedResponse{}, errors.New("scripted provider: Embed is not used")
}

func (p *scriptedProvider) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	p.mu.Lock()
	p.calls = append(p.calls, req)
	p.mu.Unlock()
	return p.reply(ctx, req)
}

func (p *scriptedProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.calls)
}

func (p *scriptedProvider) request(i int) provider.CompletionRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls[i]
}

// runMeter is the ai.Quota the gateway records through; like a database write
// it refuses on a context that is already done.
type runMeter struct {
	mu      sync.Mutex
	records []ai.UsageRecord
}

func (m *runMeter) Check(context.Context, string) error { return nil }

func (m *runMeter) Record(ctx context.Context, in ai.UsageRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.records = append(m.records, in)
	return nil
}

func (m *runMeter) recorded() []ai.UsageRecord {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ai.UsageRecord(nil), m.records...)
}

// scriptedRunStore is ai.RunStore with the counters the service needs to read
// back: it opens a run when none is named, refuses an id it does not own with
// ErrRunExpired (as the store does for a foreign conversation), and counts
// the takes so a test can see both attempts of a retry.
type scriptedRunStore struct {
	mu      sync.Mutex
	runs    map[string]*ai.Run
	takes   []ai.TakeRunTurn
	credits []runCreditCall
}

func newScriptedRunStore() *scriptedRunStore {
	return &scriptedRunStore{runs: map[string]*ai.Run{}}
}

func (s *scriptedRunStore) TakeTurn(_ context.Context, in ai.TakeRunTurn) (ai.Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A turn with no run id opens one — the question turn of a run (design
	// §2.2) — and the take is recorded under the run it resolved to, so both
	// attempts of a retry are read back from the same run. The opened run is
	// kept: a harness that opened it and then looked up the still-empty id
	// answered run_expired to every first turn (BE3B-3).
	if in.RunID == "" {
		in.RunID = util.NewID()
		s.runs[in.RunID] = &ai.Run{
			ID: in.RunID, OrganizationID: in.OrganizationID, ConversationID: in.ConversationID,
			CreatedBy: in.CreatedBy, CreatedByKind: "human",
			CreatedAt: in.Now, LastUsedAt: in.Now, ExpiresAt: in.Now.Add(ai.UniworkRunIdleTTL),
		}
	}
	s.takes = append(s.takes, in)
	run, ok := s.runs[in.RunID]
	if !ok {
		return ai.Run{}, ai.ErrRunExpired
	}
	run.ModelCalls++
	if in.ToolRound {
		run.ToolRounds++
	}
	return *run, nil
}

func (s *scriptedRunStore) AddCredits(_ context.Context, runID, conversationID string, tokens int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.credits = append(s.credits, runCreditCall{RunID: runID, ConversationID: conversationID, Tokens: tokens})
	if run, ok := s.runs[runID]; ok {
		run.Credits += tokens
	}
	return nil
}

func (s *scriptedRunStore) takesFor(runID string) []ai.TakeRunTurn {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []ai.TakeRunTurn
	for _, t := range s.takes {
		if t.RunID == runID {
			out = append(out, t)
		}
	}
	return out
}

func (s *scriptedRunStore) run(id string) ai.Run {
	s.mu.Lock()
	defer s.mu.Unlock()
	return *s.runs[id]
}

// The harness opens a run for the question turn and counts later turns on it,
// so a retry reads back from one run (BE3B-3); a foreign id is still the 409.
// It needs no database: this is the seam the DB-backed card tests above stand
// on, and the one a fix must not break silently.
func TestScriptedRunStoreTakeTurnOpensAndContinues(t *testing.T) {
	store := newScriptedRunStore()
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()

	opened, err := store.TakeTurn(ctx, ai.TakeRunTurn{
		OrganizationID: "org-1", ConversationID: "conv-1", CreatedBy: "user-1", Now: now,
	})
	if err != nil || opened.ID == "" || opened.ModelCalls != 1 {
		t.Fatalf("the opening take = %+v, %v; want a run at one model call", opened, err)
	}
	continued, err := store.TakeTurn(ctx, ai.TakeRunTurn{
		RunID: opened.ID, OrganizationID: "org-1", ConversationID: "conv-1", CreatedBy: "user-1", Now: now,
	})
	if err != nil || continued.ID != opened.ID || continued.ModelCalls != 2 {
		t.Fatalf("the continuation = %+v, %v; want %s at two model calls", continued, err, opened.ID)
	}
	if takes := store.takesFor(opened.ID); len(takes) != 2 {
		t.Fatalf("recorded takes of %s = %d, want both attempts under the run", opened.ID, len(takes))
	}
	if _, err := store.TakeTurn(ctx, ai.TakeRunTurn{
		RunID: "run-of-someone-else", OrganizationID: "org-1", ConversationID: "conv-1", Now: now,
	}); !errors.Is(err, ai.ErrRunExpired) {
		t.Fatalf("a foreign run id = %v, want ErrRunExpired", err)
	}
}

// uniworkRunWorld is one organization on the default plan with the UniWork AI
// flags on, a real transcript store and gateway, and the scripted run store.
type uniworkRunWorld struct {
	f        *docPermFixture
	tn       docTenant
	svc      *AIUniworkService
	runs     *scriptedRunStore
	metrics  *fakeRunMetrics
	meter    *runMeter
	provider *scriptedProvider
}

func newUniworkRunWorld(t *testing.T, p *scriptedProvider) *uniworkRunWorld {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, "uniwork-run")
	box, err := secretbox.New([]byte("uniwork-run-test-key-material-32"))
	if err != nil {
		t.Fatal(err)
	}
	flags, _, err := featureflags.NewService(graphFlagStore{rows: []db.FeatureFlagOverride{
		{FlagKey: officeAIUniworkFlag, ScopeType: featureflags.ScopeGlobal, Enabled: true},
		{FlagKey: officeAIUniworkFormatPrefix + "docx", ScopeType: featureflags.ScopeGlobal, Enabled: true},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	meter := &runMeter{}
	gw := ai.NewGateway(f.q, p, meter, nil, ai.Options{Timeout: 5 * time.Second})
	store := ai.NewConversationStore(f.pool, f.q, box)
	svc := NewAIUniworkService(f.svc.orgs, NewEntitlementService(f.pool, f.q), f.svc, flags, gw, store, nil)
	runs := newScriptedRunStore()
	svc.SetRunStore(runs)
	metrics := &fakeRunMetrics{}
	svc.SetUniworkMetrics(metrics)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = f.pool.Exec(ctx, "DELETE FROM ai_uniwork_turns")
		_, _ = f.pool.Exec(ctx, "DELETE FROM ai_uniwork_conversations")
	})
	return &uniworkRunWorld{f: f, tn: tn, svc: svc, runs: runs, metrics: metrics, meter: meter, provider: p}
}

func (w *uniworkRunWorld) scope() UniworkScope {
	return UniworkScope{UserID: w.tn.member.ID, OrgID: w.tn.orgID, Module: "docs"}
}

func (w *uniworkRunWorld) body(t *testing.T, content string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": content}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// usageRow is one ai_usage_events row of the world's organization.
type usageRow struct {
	Status       string
	ReasonCode   string
	InputTokens  int64
	OutputTokens int64
}

func (w *uniworkRunWorld) usageRows(t *testing.T) []usageRow {
	t.Helper()
	rows, err := w.f.pool.Query(context.Background(),
		`SELECT status, COALESCE(reason_code, ''), input_tokens, output_tokens
		 FROM ai_usage_events WHERE organization_id = $1 ORDER BY created_at, id`, w.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []usageRow
	for rows.Next() {
		var r usageRow
		if err := rows.Scan(&r.Status, &r.ReasonCode, &r.InputTokens, &r.OutputTokens); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func answeringProvider() *scriptedProvider {
	return &scriptedProvider{reply: func(_ context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
		return provider.CompletionResponse{
			Text: "trả lời thử nghiệm", Model: req.Model, UsagePresent: true,
			InputTokens: 12, OutputTokens: 5, StopReason: "end_turn",
		}, nil
	}}
}

// A client that hangs up while the vendor answers still leaves the usage row
// and the run's credits behind (design §6.2): the gateway and the service
// settle on contexts detached from the request, and nothing panics when the
// transcript write fails on the cancelled request.
func TestAIUniworkUsageRecordedWhenClientDisconnects(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	reqCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p.reply = func(_ context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
		cancel() // the client goes away while the vendor is answering
		return provider.CompletionResponse{
			Text: "trả lời thử nghiệm", Model: req.Model, UsagePresent: true,
			InputTokens: 12, OutputTokens: 5, StopReason: "end_turn",
		}, nil
	}

	// The turn may answer nothing to a client that is gone; what it must not
	// do is stop before the vendor, so the error is kept for the failure
	// message instead of the row count being the only clue (a refusal that
	// precedes the Gateway — run_expired, a spent cap — read as "0 rows").
	turn, err := w.svc.Chat(reqCtx, w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi bị ngắt")})

	rows := w.usageRows(t)
	if len(rows) != 1 {
		t.Fatalf("usage rows after the hang-up = %d %+v (turn %+v, err %v), want one settled row",
			len(rows), rows, turn, err)
	}
	if rows[0].Status != "succeeded" || rows[0].InputTokens != 12 || rows[0].OutputTokens != 5 {
		t.Fatalf("row after the hang-up = %+v, want succeeded with the vendor's tokens", rows[0])
	}
	w.runs.mu.Lock()
	credits := append([]runCreditCall(nil), w.runs.credits...)
	w.runs.mu.Unlock()
	if len(credits) != 1 || credits[0].Tokens != 17 {
		t.Fatalf("run credits after the hang-up = %+v, want one charge of 17", credits)
	}
	if len(w.metrics.seconds) != 1 || len(w.metrics.credits) != 1 {
		t.Fatalf("run histograms after the hang-up = %v/%v, want one observation", w.metrics.seconds, w.metrics.credits)
	}
}

// An upstream 429 keeps the run id on the refusal, and the retry with that
// same run id is accepted: both attempts count one model call, the failed one
// leaves a zero-token failed row and is never charged, the answered one is
// charged exactly once (design §4.1, §5.5).
func TestAIUniworkRetrySameRunAcceptedAfter429(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	attempts := 0
	p.reply = func(_ context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
		attempts++
		if attempts == 1 {
			return provider.CompletionResponse{}, &provider.StatusError{Status: http.StatusTooManyRequests, RetryAfter: 10 * time.Second}
		}
		return provider.CompletionResponse{
			Text: "trả lời thử nghiệm", Model: req.Model, UsagePresent: true,
			InputTokens: 12, OutputTokens: 5, StopReason: "end_turn",
		}, nil
	}
	ctx := context.Background()

	first, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi lần một")})
	var ae *ai.Error
	if !errors.As(err, &ae) || ae.Code != "ai_rate_limited" {
		t.Fatalf("first attempt = %v, want ai_rate_limited", err)
	}
	if first.RunID == "" || first.ConversationID == "" {
		t.Fatalf("429 answer = %+v, want the run id and conversation id kept for the retry", first)
	}
	if retry, ok := ae.Fields["retry_after"]; !ok || retry == nil {
		t.Fatalf("429 fields = %v, want retry_after", ae.Fields)
	}

	second, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{
		ConversationID: first.ConversationID, RunID: first.RunID, Body: w.body(t, "câu hỏi lần hai"),
	})
	if err != nil {
		t.Fatalf("retry with the same run id after a 429: %v", err)
	}
	if second.RunID != first.RunID {
		t.Fatalf("retry answered run %q, want the same run %q", second.RunID, first.RunID)
	}
	if takes := w.runs.takesFor(first.RunID); len(takes) != 2 {
		t.Fatalf("takes of %s = %d, want the retry counted on the same run", first.RunID, len(takes))
	}
	if got := w.runs.run(first.RunID).ModelCalls; got != 2 {
		t.Fatalf("model_calls = %d, want 2 (attempt-based)", got)
	}
}

// A retry of the same run does not charge twice: the 429 attempt leaves a
// failed zero-token row and no meter record, the answered attempt charges
// once (design §4.1, §6.4).
func TestAIUniworkRunRetryUsageChargedOnce(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	attempts := 0
	p.reply = func(_ context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
		attempts++
		if attempts == 1 {
			return provider.CompletionResponse{}, &provider.StatusError{Status: http.StatusTooManyRequests, RetryAfter: 10 * time.Second}
		}
		return provider.CompletionResponse{
			Text: "trả lời thử nghiệm", Model: req.Model, UsagePresent: true,
			InputTokens: 12, OutputTokens: 5, StopReason: "end_turn",
		}, nil
	}
	ctx := context.Background()

	first, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi lần một")})
	if err == nil {
		t.Fatal("the 429 attempt answered without an error")
	}
	if _, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{
		ConversationID: first.ConversationID, RunID: first.RunID, Body: w.body(t, "câu hỏi lần hai"),
	}); err != nil {
		t.Fatalf("retry: %v", err)
	}

	rows := w.usageRows(t)
	if len(rows) != 2 {
		t.Fatalf("usage rows = %d %+v, want the failed attempt and the answered one", len(rows), rows)
	}
	if rows[0].Status != "failed" || rows[0].InputTokens != 0 || rows[0].OutputTokens != 0 {
		t.Fatalf("failed attempt's row = %+v, want failed with zero tokens", rows[0])
	}
	if rows[1].Status != "succeeded" || rows[1].InputTokens+rows[1].OutputTokens != 17 {
		t.Fatalf("answered attempt's row = %+v, want succeeded with 17 tokens", rows[1])
	}
	if recorded := w.meter.recorded(); len(recorded) != 1 || recorded[0].Tokens != 17 {
		t.Fatalf("meter records = %+v, want exactly one charge of 17", recorded)
	}
}

// "Hỏi tiếp" after a spent run is a new run in the same conversation, and the
// new run sees the turns before it (design §4.3): the client drops the run
// header, the server opens a run and replays the transcript.
func TestAIUniworkNextRunSeesPriorTurns(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	ctx := context.Background()

	first, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi đầu tiên")})
	if err != nil {
		t.Fatalf("first turn: %v", err)
	}
	second, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{
		ConversationID: first.ConversationID, Body: w.body(t, "câu hỏi tiếp theo"),
	})
	if err != nil {
		t.Fatalf("second turn: %v", err)
	}
	if second.RunID == first.RunID {
		t.Fatalf("the next question reused run %s; the client dropping the header must open a new one", first.RunID)
	}
	if got := w.runs.run(second.RunID).ModelCalls; got != 1 {
		t.Fatalf("the new run's model_calls = %d, want 1", got)
	}
	history := w.provider.request(1).Messages
	found := false
	for _, m := range history {
		if m.Role == "assistant" && m.Content == first.Response.Text {
			found = true
		}
	}
	if !found {
		t.Fatalf("the new run's history does not carry the first answer: %+v", history)
	}
}

// A vendor that reports no usage leaves a usage_unknown row and moves the
// unknown counter; the meter is not charged (A16, design §6.3).
func TestAIUniworkUsageUnknownRowAndMetric(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	p.reply = func(_ context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
		return provider.CompletionResponse{
			Text: "trả lời không có usage", Model: req.Model, UsagePresent: false, StopReason: "end_turn",
		}, nil
	}

	if _, err := w.svc.Chat(context.Background(), w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi không usage")}); err != nil {
		t.Fatalf("turn with a no-usage vendor: %v", err)
	}
	rows := w.usageRows(t)
	if len(rows) != 1 || rows[0].ReasonCode != ai.UsageUnknownReason || rows[0].Status != "succeeded" {
		t.Fatalf("rows = %+v, want one succeeded %s row", rows, ai.UsageUnknownReason)
	}
	if rows[0].InputTokens != 0 || rows[0].OutputTokens != 0 {
		t.Fatalf("unknown-usage row was priced in the request: %+v", rows[0])
	}
	if w.metrics.unknown != 1 {
		t.Fatalf("usage-unknown counter = %d, want 1", w.metrics.unknown)
	}
	if recorded := w.meter.recorded(); len(recorded) != 0 {
		t.Fatalf("the meter was charged for an unknown call: %+v", recorded)
	}
}

// A spent meter stops the turn before the Gateway: 402 credits_exhausted, no
// model call, no usage row, no model call counted on a run (design §6.1).
func TestAIUniworkCreditsExhaustedStopsBeforeGateway(t *testing.T) {
	p := answeringProvider()
	w := newUniworkRunWorld(t, p)
	ctx := context.Background()

	var planID string
	if err := w.f.pool.QueryRow(ctx,
		`SELECT plan_id FROM subscriptions WHERE organization_id = $1`, w.tn.orgID).Scan(&planID); err != nil {
		t.Fatal(err)
	}
	var old *int64
	if err := w.f.pool.QueryRow(ctx,
		`SELECT quota_limit FROM plan_features WHERE plan_id = $1 AND feature_key = 'ai.tokens'`, planID).Scan(&old); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.pool.Exec(ctx,
		`UPDATE plan_features SET quota_limit = 0 WHERE plan_id = $1 AND feature_key = 'ai.tokens'`, planID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = w.f.pool.Exec(context.Background(),
			`UPDATE plan_features SET quota_limit = $2 WHERE plan_id = $1 AND feature_key = 'ai.tokens'`, planID, old)
	})

	_, err := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{Body: w.body(t, "câu hỏi hết credit")})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "credits_exhausted" || ce.Status != http.StatusPaymentRequired {
		t.Fatalf("turn on a spent meter = %v, want credits_exhausted/402", err)
	}
	if p.callCount() != 0 {
		t.Fatalf("the gateway was reached on a spent meter: %d calls", p.callCount())
	}
	if rows := w.usageRows(t); len(rows) != 0 {
		t.Fatalf("usage rows written for a refused turn: %+v", rows)
	}
	if len(w.runs.takes) != 0 {
		t.Fatalf("a spent meter spent a run: %+v", w.runs.takes)
	}
}
