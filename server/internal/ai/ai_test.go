package ai

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var update = flag.Bool("update", false, "rewrite prompt snapshots")

func TestPolicyFailClosed(t *testing.T) {
	if _, _, err := ResolveModel(Capability("nope"), "anthropic", nil, nil); err == nil {
		t.Fatal("unknown capability must be refused")
	}
	if _, _, err := ResolveModel(CapMeetingSummarization, "unknown-provider", nil, nil); err == nil {
		t.Fatal("provider without default must be refused")
	}
	_, model, err := ResolveModel(CapMeetingSummarization, "anthropic", nil, nil)
	if err != nil || model != "claude-opus-5" {
		t.Fatalf("%s %v", model, err)
	}
	_, model, _ = ResolveModel(CapContextExtraction, "openai", nil, nil)
	if model != "gpt-4o-mini" {
		t.Fatalf("fast tier: %s", model)
	}
}

func TestPolicyOverrideOutsideAllowlist(t *testing.T) {
	env := func(k string) string {
		switch k {
		case "AI_MODEL_COPILOT_ANSWER":
			return "claude-sonnet-5"
		case "AI_MODEL_MEETING_SUMMARIZATION":
			return "totally-made-up"
		case "AI_MODEL_CONTEXT_EXTRACTION":
			return "my-local-model"
		}
		return ""
	}
	if _, m, _ := ResolveModel(CapCopilotAnswer, "anthropic", env, nil); m != "claude-sonnet-5" {
		t.Fatalf("override in allowlist ignored: %s", m)
	}
	if _, m, _ := ResolveModel(CapMeetingSummarization, "anthropic", env, nil); m != "claude-opus-5" {
		t.Fatalf("override outside allowlist accepted: %s", m)
	}
	if _, m, _ := ResolveModel(CapContextExtraction, "ollama", env, []string{"my-local-model"}); m != "my-local-model" {
		t.Fatalf("AI_MODEL_ALLOW not honoured: %s", m)
	}
	legacy := func(k string) string {
		if k == "ANTHROPIC_MODEL" {
			return "claude-haiku-4-5-20251001"
		}
		return ""
	}
	if _, m, _ := ResolveModel(CapMeetingSummarization, "anthropic", legacy, nil); m != "claude-haiku-4-5-20251001" {
		t.Fatalf("ANTHROPIC_MODEL compat: %s", m)
	}
	if _, m, _ := ResolveModel(CapMeetingSummarization, "openai", legacy, nil); m != "gpt-4o" {
		t.Fatalf("ANTHROPIC_MODEL must not leak to openai: %s", m)
	}
}

func TestFromEnv(t *testing.T) {
	get := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if p, _ := FromEnv(get(map[string]string{})); p != nil {
		t.Fatal("no credentials must disable")
	}
	if p, _ := FromEnv(get(map[string]string{"ANTHROPIC_API_KEY": "k"})); p == nil || p.Name() != "anthropic" {
		t.Fatal("anthropic inferred from key")
	}
	if p, opts := FromEnv(get(map[string]string{"AI_PROVIDER": "openai", "OPENAI_API_KEY": "k", "AI_TIMEOUT_SECONDS": "5", "AI_MODEL_ALLOW": "a, b"})); p == nil || p.Name() != "openai" || opts.Timeout != 5*time.Second || len(opts.ExtraAllow) != 2 {
		t.Fatalf("%v %+v", p, opts)
	}
	if p, _ := FromEnv(get(map[string]string{"AI_PROVIDER": "openai"})); p != nil {
		t.Fatal("openai without key must disable")
	}
	if p, _ := FromEnv(get(map[string]string{"AI_PROVIDER": "fake"})); p == nil || p.Name() != "fake" {
		t.Fatal("fake provider")
	}
}

func TestSystemPromptsEndWithUntrustedFooter(t *testing.T) {
	for _, k := range PromptKeys() {
		p, _ := LookupPrompt(k)
		if !strings.HasSuffix(p.System, UntrustedFooter) {
			t.Errorf("%s: system prompt does not end with the untrusted footer", k)
		}
		if p.Key() != k || len(p.OutputSchema) == 0 || p.Render == nil {
			t.Errorf("%s: incomplete prompt", k)
		}
	}
}

// Golden files: a change to prompt wording shows up as a diff here, which is
// the moment to bump Version instead.
func TestPromptSnapshots(t *testing.T) {
	fixtures := map[string]map[string]any{
		PromptMeetingSummary: {
			"title": "Standup", "agenda": "Ship F-09", "locale": "vi",
			"notes":      []string{"Ghi chú 1"},
			"transcript": []TranscriptLine{{Speaker: "An", Text: "Chốt thứ Sáu"}},
		},
		PromptCopilotAnswer: {
			"question": "task nào quá hạn?", "locale": "vi", "today": "2026-09-06",
			"sources": RenderSources([]Source{{ID: "S1", Kind: "task", Title: "Viết spec", Excerpt: "quá hạn 2 ngày"}}),
		},
	}
	for _, k := range PromptKeys() {
		p, _ := LookupPrompt(k)
		got := "SYSTEM:\n" + p.System + "\n\nUSER:\n" + p.Render(fixtures[k])
		path := filepath.Join("testdata", strings.ReplaceAll(k, "@", "_v")+".golden")
		if *update {
			if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: missing snapshot (run with -update): %v", k, err)
		}
		if string(want) != got {
			t.Errorf("%s: prompt changed; bump Version or run -update:\n%s", k, got)
		}
	}
}

func TestBuildContextBudget(t *testing.T) {
	var many []Source
	for i := 0; i < 30; i++ {
		many = append(many, Source{Kind: "task", Title: "t", Excerpt: strings.Repeat("x", 2000)})
	}
	pack, truncated := BuildContext(many)
	if len(pack) != MaxSources || !truncated {
		t.Fatalf("%d %v", len(pack), truncated)
	}
	if pack[0].ID != "S1" || pack[19].ID != "S20" || len([]rune(pack[0].Excerpt)) != MaxExcerpt+1 {
		t.Fatalf("%+v", pack[0])
	}
	pack, truncated = BuildContext([]Source{{Title: "a", Excerpt: "b"}})
	if len(pack) != 1 || truncated {
		t.Fatalf("%d %v", len(pack), truncated)
	}
	rendered := RenderSources(pack)
	if !strings.Contains(rendered, `<untrusted source="S1">`) || !strings.Contains(rendered, "[S1] a") {
		t.Fatalf("%q", rendered)
	}
}

func TestParseAnswerDropsUnknownCitations(t *testing.T) {
	pack := []Source{{ID: "S1"}, {ID: "S2"}}
	out, err := ParseAnswer("Sure:\n```json\n{\"answer\":\"Xem [S1]\",\"citations\":[{\"source_id\":\"S1\",\"quote\":\"q\"},{\"source_id\":\"S9\"}]}\n```", pack)
	if err != nil || len(out.Citations) != 1 || out.Citations[0].SourceID != "S1" {
		t.Fatalf("%+v %v", out, err)
	}
	if _, err := ParseAnswer("no json", pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("%v", err)
	}
	if _, err := ParseAnswer(`{"answer":""}`, pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("%v", err)
	}
}

func TestParseSummaryJSONTolerant(t *testing.T) {
	in := "Here you go:\n```json\n{\"summary\":\"S\",\"decisions\":[\"D1\"],\"action_items\":[{\"title\":\"T\",\"owner\":\"An\"}]}\n```"
	out, err := ParseSummaryJSON(in)
	if err != nil || out.Summary != "S" || len(out.Decisions) != 1 || out.ActionItems[0].Owner != "An" {
		t.Fatalf("%+v %v", out, err)
	}
	if _, err := ParseSummaryJSON("no json here"); err == nil {
		t.Fatal("expected error")
	}
	empty, err := ParseSummaryJSON(`{"summary":"x"}`)
	if err != nil || empty.Decisions == nil || empty.ActionItems == nil {
		t.Fatalf("nil slices must become empty: %+v %v", empty, err)
	}
}

func TestAskUniToolRegistryHelpers(t *testing.T) {
	r := Registry{{Name: "a", Kind: ToolRead}, {Name: "b", Kind: ToolWrite}}
	if r.MutationCount() != 1 || len(r.Names()) != 2 {
		t.Fatal("registry helpers")
	}
	if _, ok := r.Get("zzz"); ok {
		t.Fatal("unknown tool found")
	}
}

// ---- Gateway on a real database ------------------------------------------

type fakeQuota struct {
	checkErr error
	recorded []UsageRecord
}

func (f *fakeQuota) Check(context.Context, string) error { return f.checkErr }
func (f *fakeQuota) Record(_ context.Context, in UsageRecord) error {
	f.recorded = append(f.recorded, in)
	return nil
}

func gatewayFixture(t *testing.T, p provider.Provider, quota Quota) (*Gateway, *db.Queries) {
	t.Helper()
	q := db.New(testutil.DB(t))
	g := NewGateway(q, p, quota, nil, Options{Timeout: time.Second})
	return g, q
}

func askReq() Request {
	return Request{
		Actor: audit.User("u1"), OrganizationID: "org1", WorkspaceID: "ws1",
		Capability: CapCopilotAnswer, PromptID: PromptCopilotAnswer,
		Vars:    map[string]any{"question": "q", "locale": "vi", "today": "2026-09-06", "sources": ""},
		Sources: []Source{{ID: "S1"}}, Truncated: true,
	}
}

func TestGatewayMetersBeforeAndAfter(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"answer":"ok","citations":[]}`, Model: "fake", InputTokens: 1_000_000, OutputTokens: 500_000}
	}}
	quota := &fakeQuota{}
	g, q := gatewayFixture(t, fp, quota)
	// Price the fake model: 2 USD / 1M in, 4 USD / 1M out.
	if _, err := q.AiInsertRate(ctx, db.AiInsertRateParams{ID: util.NewID(), Provider: "fake", Model: "fake", InputMicrosPerMtok: 2_000_000, OutputMicrosPerMtok: 4_000_000, EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	resp, err := g.Complete(ctx, askReq())
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "succeeded" || row.InputTokens != 1_000_000 || row.CostMicros != 4_000_000 || !row.RateID.Valid || row.SourceCount != 1 || !row.Truncated || !row.CompletedAt.Valid {
		t.Fatalf("%+v", row)
	}
	if row.PromptID != PromptCopilotAnswer || row.ActorKind != "human" || row.Capability != "copilot_answer" || !row.LatencyMs.Valid {
		t.Fatalf("%+v", row)
	}
	if len(quota.recorded) != 1 || quota.recorded[0].Tokens != 1_500_000 || quota.recorded[0].UsageEventID != row.ID {
		t.Fatalf("quota record %+v", quota.recorded)
	}
	// A new price does not rewrite the old row; the next call uses it.
	if _, err := q.AiInsertRate(ctx, db.AiInsertRateParams{ID: util.NewID(), Provider: "fake", Model: "fake", InputMicrosPerMtok: 10_000_000, OutputMicrosPerMtok: 10_000_000, EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	resp2, err := g.Complete(ctx, askReq())
	if err != nil {
		t.Fatal(err)
	}
	old, _ := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	fresh, _ := q.AiGetUsageEvent(ctx, resp2.UsageEventID)
	if old.CostMicros != 4_000_000 || fresh.CostMicros != 15_000_000 || old.RateID.String == fresh.RateID.String {
		t.Fatalf("old %d new %d", old.CostMicros, fresh.CostMicros)
	}
	// No rate for the model: cost 0, rate NULL, still succeeded.
	fp.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "{}", Model: "unpriced", InputTokens: 10, OutputTokens: 10}
	}
	resp3, err := g.Complete(ctx, askReq())
	if err != nil {
		t.Fatal(err)
	}
	unpriced, _ := q.AiGetUsageEvent(ctx, resp3.UsageEventID)
	if unpriced.Status != "succeeded" || unpriced.CostMicros != 0 || unpriced.RateID.Valid {
		t.Fatalf("%+v", unpriced)
	}
}

func TestGatewayProviderErrorMarksFailed(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Err: errors.New("boom")}
	quota := &fakeQuota{}
	g, q := gatewayFixture(t, fp, quota)
	_, err := g.Complete(ctx, askReq())
	if !errors.Is(err, ErrProviderError) {
		t.Fatalf("%v", err)
	}
	rows, _ := q.AiUsageByDay(ctx, db.AiUsageByDayParams{OrganizationID: "org1", FromAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}, ToAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}})
	if len(rows) != 1 || rows[0].Calls != 1 || rows[0].InputTokens != 0 {
		t.Fatalf("%+v", rows)
	}
	if len(quota.recorded) != 0 {
		t.Fatal("failed call must not be metered")
	}
}

func TestGatewayToolNotAllowed(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "", ToolCalls: []provider.ToolCall{{Name: "delete_everything", Input: json.RawMessage(`{}`)}}, Model: "fake"}
	}}
	g, q := gatewayFixture(t, fp, &fakeQuota{})
	req := askReq()
	req.Tools = Registry{{Name: "search_workspace", Kind: ToolRead, Risk: RiskLow}}
	_, err := g.Complete(ctx, req)
	if !errors.Is(err, ErrToolNotAllowed) {
		t.Fatalf("%v", err)
	}
	rows, _ := q.AiUsageByDay(ctx, db.AiUsageByDayParams{OrganizationID: "org1", FromAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}, ToAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}})
	if len(rows) != 1 {
		t.Fatalf("%+v", rows)
	}
	if fp.Calls != 1 {
		t.Fatal("provider not called once")
	}
}

func TestGatewayQuotaRejected(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{}
	g, q := gatewayFixture(t, fp, &fakeQuota{checkErr: ErrQuotaExceeded})
	_, err := g.Complete(ctx, askReq())
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("%v", err)
	}
	if fp.Calls != 0 {
		t.Fatal("provider must not be called over quota")
	}
	rows, _ := q.AiUsageByDay(ctx, db.AiUsageByDayParams{OrganizationID: "org1", FromAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}, ToAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}})
	if len(rows) != 1 || rows[0].Calls != 1 {
		t.Fatalf("rejected call must leave a row: %+v", rows)
	}
}

func TestGatewayDisabledAndUnknownPrompt(t *testing.T) {
	var g *Gateway
	if g.Enabled() {
		t.Fatal("nil gateway enabled")
	}
	if _, err := g.Complete(context.Background(), askReq()); !errors.Is(err, ErrDisabled) {
		t.Fatalf("%v", err)
	}
	g = NewGateway(nil, nil, nil, nil, Options{})
	if g.Enabled() || g.Provider() != "" {
		t.Fatal("nil provider enabled")
	}
	g = NewGateway(nil, &provider.Fake{}, nil, nil, Options{})
	req := askReq()
	req.PromptID = "nope@9"
	if _, err := g.Complete(context.Background(), req); err == nil {
		t.Fatal("unknown prompt accepted")
	}
}

func TestFakeReplyCitesEverySource(t *testing.T) {
	p, _ := LookupPrompt(PromptCopilotAnswer)
	pack, _ := BuildContext([]Source{{Kind: "task", Title: "Viết spec", Excerpt: "x"}, {Kind: "meeting", Title: "Standup", Excerpt: "y"}})
	req := provider.CompletionRequest{System: p.System, Messages: []provider.Message{{Role: "user", Content: p.Render(map[string]any{"sources": RenderSources(pack), "question": "?"})}}}
	out, err := ParseAnswer(fakeReply(req).Text, pack)
	if err != nil || len(out.Citations) != 2 || !strings.Contains(out.Answer, "[S1]") {
		t.Fatalf("%+v %v", out, err)
	}
	empty, _ := ParseAnswer(fakeReply(provider.CompletionRequest{System: p.System, Messages: []provider.Message{{Role: "user", Content: "Sources: (none)"}}}).Text, nil)
	if empty.Answer != NoSourcesAnswer {
		t.Fatalf("%q", empty.Answer)
	}
	if _, err := ParseSummaryJSON(fakeReply(provider.CompletionRequest{System: "meeting"}).Text); err != nil {
		t.Fatal(err)
	}
}
