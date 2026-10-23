package ai

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A16's unknown-usage branch and its reconciliation pass (G6-03b, design
// §6.3). The DB-backed half skips where TEST_DATABASE_URL is not set (the
// cloud round owns those rows).

// noUsageProvider is a vendor that answers without a usage block: the
// response settles the row as usage_unknown and charges nothing.
type noUsageProvider struct{ *provider.Fake }

func (p *noUsageProvider) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	resp, err := p.Fake.Complete(ctx, req)
	resp.UsagePresent = false
	resp.InputTokens, resp.OutputTokens = 0, 0
	return resp, err
}

// reconcileMetrics records what the pass reported.
type reconcileMetrics struct{ rows int64 }

func (m *reconcileMetrics) IncUniworkUsageReconciled(rows int64) { m.rows += rows }

// A call whose vendor sent no usage block leaves a succeeded row with
// reason usage_unknown and no charge; the reconciliation pass then prices it
// from the stored transcript, claims it once, meters it once — and a second
// pass (or a second pod) claims nothing and charges nothing.
func TestAIUniworkUsageUnknownReconcilesOnce(t *testing.T) {
	quota := &liveQuota{}
	g, q, pool := settleFixture(t, &noUsageProvider{Fake: &provider.Fake{}}, quota)
	ctx := context.Background()

	// Module is the office pack module (docx, xlsx, …), not the genoffice web
	// module the frame names: the service passes allow.Module, which
	// UniworkModuleAllowlist built through UniworkPackModule (openai_facade.go:775,
	// service/ai_uniwork.go:329). The conversation key below keeps the genoffice
	// name, which is what ConversationKey.Module carries.
	resp, err := g.Complete(ctx, Request{
		Actor: audit.User("u1"), OrganizationID: "org-1", Capability: CapOfficeUniworkAI,
		PromptID: PromptOfficeUniworkAI, Module: "docx",
		History: []provider.Message{{Role: "user", Content: "Ô A1 bằng mấy?"}},
	})
	if err != nil {
		t.Fatalf("Complete with a no-usage vendor: %v", err)
	}
	if resp.UsagePresent {
		t.Fatal("a vendor that sent no usage block answered UsagePresent=true")
	}
	row, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	if err != nil {
		t.Fatalf("usage row: %v", err)
	}
	if row.Status != "succeeded" || row.ReasonCode.String != UsageUnknownReason {
		t.Fatalf("row = %s/%s, want succeeded/%s", row.Status, row.ReasonCode.String, UsageUnknownReason)
	}
	if row.InputTokens != 0 || row.OutputTokens != 0 || row.CostMicros != 0 {
		t.Fatalf("unknown-usage row priced itself: in=%d out=%d cost=%d", row.InputTokens, row.OutputTokens, row.CostMicros)
	}
	if len(quota.recorded) != 0 {
		t.Fatalf("the meter was charged for an unknown call: %+v", quota.recorded)
	}

	// The transcript the pass reads: the question, then the assistant answer
	// carrying the usage row's id.
	if _, err := q.AiInsertRate(ctx, db.AiInsertRateParams{
		ID: util.NewID(), Provider: row.Provider, Model: row.Model,
		InputMicrosPerMtok: 1_000_000, OutputMicrosPerMtok: 2_000_000,
		EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("insert rate: %v", err)
	}
	// The transcript store shares the fixture's pool: testutil.DB serializes
	// tests with a session advisory lock held for the test's lifetime, so a
	// second call (conversationStoreFixture builds its own) would wait on this
	// test's own lock forever.
	store := NewConversationStore(pool, q, testConversationBox(t))
	conv, err := store.Create(ctx, ConversationKey{OrganizationID: "org-1", UserID: "u1", Module: "docs"})
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := store.Append(ctx, conv.ID, []Turn{
		{Message: provider.Message{Role: "user", Content: "Ô A1 bằng mấy?"}},
		{UsageEventID: resp.UsageEventID, Message: provider.Message{Role: "assistant", Content: resp.Text}},
	}); err != nil {
		t.Fatalf("append turns: %v", err)
	}

	metrics := &reconcileMetrics{}
	r := NewUsageReconciler(q, testConversationBox(t), quota, metrics)
	reconciled, err := r.ReconcileUnknownUsage(ctx, 10)
	if err != nil {
		t.Fatalf("first pass: %v", err)
	}
	if reconciled != 1 {
		t.Fatalf("first pass reconciled %d rows, want 1", reconciled)
	}
	priced, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	if err != nil {
		t.Fatalf("priced row: %v", err)
	}
	if priced.ReasonCode.String != UsageReconciledReason {
		t.Fatalf("reason_code = %q, want %q", priced.ReasonCode.String, UsageReconciledReason)
	}
	if priced.InputTokens <= 0 || priced.OutputTokens <= 0 {
		t.Fatalf("estimate = in %d out %d, want both above zero", priced.InputTokens, priced.OutputTokens)
	}
	if priced.CostMicros <= 0 {
		t.Fatalf("cost = %d, want the estimate priced at the row's model", priced.CostMicros)
	}
	if len(quota.recorded) != 1 || quota.recorded[0].Tokens != int64(priced.InputTokens+priced.OutputTokens) {
		t.Fatalf("meter after the first pass = %+v, want one charge of %d", quota.recorded, priced.InputTokens+priced.OutputTokens)
	}
	if quota.recorded[0].UsageEventID != priced.ID {
		t.Fatalf("meter keyed on %q, want the row id %q", quota.recorded[0].UsageEventID, priced.ID)
	}
	if metrics.rows != 1 {
		t.Fatalf("reconciled counter = %d, want 1", metrics.rows)
	}

	// A second pass (or a second pod) claims nothing and charges nothing:
	// the conditional claim and the per-event meter key hold the once.
	reconciled, err = r.ReconcileUnknownUsage(ctx, 10)
	if err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if reconciled != 0 {
		t.Fatalf("second pass reconciled %d rows, want 0", reconciled)
	}
	if len(quota.recorded) != 1 || metrics.rows != 1 {
		t.Fatalf("second pass charged again: meter %+v, counter %d", quota.recorded, metrics.rows)
	}
}

// The estimate itself: the same characters/4 rule as the package, summed over
// everything the model was sent (input) and the assistant turn the row
// belongs to (output), tool-call arguments included.
func TestAIUniworkUsageEstimateFromTurns(t *testing.T) {
	turns := []Turn{
		{Message: provider.Message{Role: "user", Content: strings.Repeat("y", 8)}},
		{Message: provider.Message{Role: "tool", Content: strings.Repeat("z", 4), ToolCallID: "c1"}},
		{
			UsageEventID: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
			Message: provider.Message{Role: "assistant", Content: strings.Repeat("x", 40),
				ToolCalls: []provider.ToolCall{{ID: "c1", Name: "set_cell", Input: []byte(`{"cell":"A1"}`)}}},
		},
	}
	input, output := estimateUsageTokens(turns, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	// 8/4+1 = 3 and 4/4+1 = 2 for the turns before the answer ...
	if input != 5 {
		t.Fatalf("input estimate = %d, want 5", input)
	}
	// ... and 40/4+1 plus the tool name and arguments on the answer.
	want := estimateTokens(strings.Repeat("x", 40) + "set_cell" + `{"cell":"A1"}`)
	if output != want {
		t.Fatalf("output estimate = %d, want %d (content plus tool calls)", output, want)
	}
}
