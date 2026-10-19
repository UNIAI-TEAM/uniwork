package ai

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
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
		if p.Sections != nil {
			// The office pack (G6-14) is the exception: its System is the
			// common section and the module section is appended per turn, so
			// the assembled variants are what must close with the footer. It
			// is free-text (no OutputSchema) and has no Render: the façade
			// sends the conversation itself. prompts_office_test.go pins its
			// goldens, caps and version pins.
			// The registry checks every prompt gets still hold (BE14-6).
			if p.Key() != k || strings.TrimSpace(p.System) == "" {
				t.Errorf("%s: incomplete sectioned prompt (key %s, empty common System %v)", k, p.Key(), strings.TrimSpace(p.System) == "")
			}
			for _, m := range officeModuleSections {
				got, err := officeAssemble(p, m.module)
				if err != nil || !strings.HasSuffix(got, UntrustedFooter) {
					t.Errorf("%s: %s variant does not end with the untrusted footer: %v", k, m.module, err)
				}
			}
			continue
		}
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
	quorumMet := true
	meetingWithFacts := map[string]any{
		"title": "Standup", "agenda": "Ship F-09", "locale": "vi",
		"notes":      []string{"Ghi chú 1"},
		"transcript": []TranscriptLine{{Speaker: "An", Text: "Chốt thứ Sáu"}},
		"attendance": &AttendanceFacts{
			Members: 4, Present: 2, Late: 1, Excused: 1, Absent: 0,
			QuorumPercent: 60, QuorumMet: &quorumMet, Finalized: true,
			NamesByStatus: map[string][]string{"PRESENT": {"An", "Bình"}, "LATE": {"Chi"}, "EXCUSED": {"Dũng"}},
		},
		"motions": []MotionFact{
			{Title: "Thông qua kế hoạch quý IV", BallotMode: "SECRET", Yes: 3, No: 0, Abstain: 0, Required: 2, Outcome: "PASSED"},
			{Title: "Tăng ngân sách quảng cáo", BallotMode: "PUBLIC", Yes: 1, No: 1, Abstain: 1, Required: 3, Outcome: "FAILED"},
		},
	}
	email := map[string]any{
		"locale": "vi", "subject": "Demo F-09", "from": "an@example.com",
		"to": "team@example.com", "sent_at": "2026-09-06T10:00:00Z",
		"body": "Chốt demo thứ Sáu.",
	}
	catchUp := map[string]any{
		"locale": "vi", "today": "2026-09-11", "scope": "room", "since": "2026-09-11T08:00:00Z",
		"sources": RenderSources([]Source{{ID: "S1", Kind: "chat", Title: "An · 2026-09-11 09:00", Excerpt: "Nhắc hạn F-09"}}),
	}
	fixtures := map[string]map[string]any{
		// Superseded versions stay registered for old usage rows; their keys
		// are literal so moving a Prompt* constant cannot re-point a fixture.
		"meeting_summary@2":      meetingWithFacts,
		PromptMeetingSummary:     meetingWithFacts,
		"email_thread_summary@1": email,
		PromptEmailThreadSummary: email,
		PromptMediaAnalysis: {
			"locale": "vi", "files": "image/png, application/pdf",
			"requirements": "Tóm tắt nội dung hai tệp.",
		},
		// @1 stays registered for old usage rows. Its key is literal so moving
		// PromptMeetingSummary to @2 cannot silently re-point this fixture.
		"meeting_summary@1": {
			"title": "Standup", "agenda": "Ship F-09", "locale": "vi",
			"notes":      []string{"Ghi chú 1"},
			"transcript": []TranscriptLine{{Speaker: "An", Text: "Chốt thứ Sáu"}},
		},
		PromptCopilotAnswer: {
			"question": "task nào quá hạn?", "locale": "vi", "today": "2026-09-06",
			"sources": RenderSources([]Source{{ID: "S1", Kind: "task", Title: "Viết spec", Excerpt: "quá hạn 2 ngày"}}),
		},
		"chat_catchup@1":  catchUp,
		PromptChatCatchUp: catchUp,
		PromptChatCallSummary: {
			"locale": "vi", "today": "2026-09-16", "duration": "1:05", "participants": "An, Bình",
			"sources": RenderSources([]Source{
				{ID: "S1", Kind: "chat", Title: "Cuộc gọi", Excerpt: "Cuộc gọi thoại · 1:05 · An, Bình"},
				{ID: "S2", Kind: "chat", Title: "An · 09:00", Excerpt: "Chốt demo thứ Sáu"},
			}),
		},
	}
	for _, k := range PromptKeys() {
		p, _ := LookupPrompt(k)
		if p.Sections != nil {
			// The office pack has one System per module and no Render: its
			// goldens (testdata/office_uniwork_ai_v1_*.golden) and their test
			// live in prompts_office_test.go, which keeps this snapshot's
			// one-SYSTEM-one-USER shape for every other prompt.
			continue
		}
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

// TestMeetingSummaryV2Facts: @2 renders the recorded facts as system lines,
// renders exactly like @1 when there are none, and still reaches the fake
// provider's meeting-summary branch (E2E runs on AI_PROVIDER=fake).
func TestMeetingSummaryV2Facts(t *testing.T) {
	v1, _ := LookupPrompt("meeting_summary@1")
	v2, ok := LookupPrompt("meeting_summary@2")
	if !ok || v2.Key() != "meeting_summary@2" {
		t.Fatal("meeting_summary@2 must stay registered")
	}
	// Summarize passes a typed nil when the meeting has no members.
	base := map[string]any{"title": "Họp", "locale": "vi", "attendance": (*AttendanceFacts)(nil), "motions": []MotionFact{}}
	if got, want := v2.Render(base), v1.Render(base); got != want {
		t.Fatalf("no facts must render like @1:\n%s", got)
	}
	notMet := false
	cases := []struct {
		name string
		vars map[string]any
		want []string
	}{
		{"no minimum, provisional", map[string]any{"attendance": &AttendanceFacts{Members: 3, Present: 1, Absent: 2}},
			[]string{"- Members: 3 (present 1, late 0, excused 0, absent 2)\n", "- Minimum attendance: not set\n", "- Attendance finalized: no (provisional)\n"}},
		{"minimum not met", map[string]any{"attendance": &AttendanceFacts{Members: 4, Present: 1, QuorumPercent: 50, QuorumMet: &notMet}},
			[]string{"- Minimum attendance: 50%, not met\n"}},
		{"vote without voters", map[string]any{"motions": []MotionFact{{Title: "Phương án A", BallotMode: "PUBLIC", Outcome: "FAILED"}}},
			[]string{"- Vote 1: FAILED · open ballot · yes 0 · no 0 · abstain 0 · no eligible voters\n", `  Title: <untrusted source="motions">Phương án A</untrusted>` + "\n"}},
	}
	for _, c := range cases {
		out := v2.Render(c.vars)
		for _, w := range c.want {
			if !strings.Contains(out, w) {
				t.Errorf("%s: missing %q in:\n%s", c.name, w, out)
			}
		}
	}
	for _, trigger := range []string{"You are UNI", "You catch a teammate up", "You summarize one email thread", "You summarize a completed voice call"} {
		if strings.Contains(v2.System, trigger) {
			t.Errorf("@2 system contains the fake-provider trigger %q", trigger)
		}
	}
	resp := FakeReply(provider.CompletionRequest{System: v2.System, Messages: []provider.Message{{Role: "user", Content: v2.Render(base)}}})
	if out, err := ParseSummaryJSON(resp.Text); err != nil || out.Summary != "Bản tóm tắt thử nghiệm." {
		t.Fatalf("fake provider must answer @2 with a meeting summary: %+v %v (%s)", out, err, resp.Text)
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

func TestParseEmailThreadSummaryJSON(t *testing.T) {
	in := `{"summary":"Tóm tắt","key_points":["a"],"action_items":[{"title":"  Làm X  ","owner":"An","due":"mai"},{"title":"   ","owner":"Bình","due":"thứ sáu"},{"title":"Làm Y","owner":"Chi","due":"tuần sau"}],"needs_reply":true,"reply_hint":"Trả lời hạn"}`
	out, err := ParseEmailThreadSummaryJSON(in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Summary != "Tóm tắt" || !out.NeedsReply || len(out.KeyPoints) != 1 {
		t.Fatalf("unexpected: %+v", out)
	}
	if len(out.ActionItems) != 2 {
		t.Fatalf("action items = %+v, want two nonblank items", out.ActionItems)
	}
	if out.ActionItems[0] != (ActionItem{Title: "Làm X", Owner: "An", Due: "mai"}) ||
		out.ActionItems[1] != (ActionItem{Title: "Làm Y", Owner: "Chi", Due: "tuần sau"}) {
		t.Fatalf("action item order or metadata changed: %+v", out.ActionItems)
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

func TestParseCatchUpJSON(t *testing.T) {
	pack := []Source{{ID: "S1"}, {ID: "S2"}}
	in := "```json\n{\"summary\":\"Brief\",\"highlights\":null,\"action_items\":[{\"title\":\"Do it\",\"source_id\":\"S1\"},{\"title\":\"\",\"source_id\":\"S1\"},{\"title\":\"Drop id\",\"source_id\":\"S9\"}]}\n```"
	out, err := ParseCatchUpJSON(in, pack)
	if err != nil || out.Summary != "Brief" || out.Highlights == nil || len(out.ActionItems) != 2 {
		t.Fatalf("%+v %v", out, err)
	}
	if out.ActionItems[0].SourceID != "S1" || out.ActionItems[1].SourceID != "" {
		t.Fatalf("source filter %+v", out.ActionItems)
	}
	// chat_catchup@1 and chat_call_summary@1 answer highlights as strings;
	// @2 as objects naming a source, which must be one the pack holds.
	v1, err := ParseCatchUpJSON(`{"summary":"x","highlights":["Chốt thứ Sáu",""]}`, pack)
	if err != nil || len(v1.Highlights) != 2 || v1.Highlights[0] != (CatchUpHighlight{Text: "Chốt thứ Sáu"}) {
		t.Fatalf("string highlights: %+v %v", v1, err)
	}
	if got := v1.HighlightTexts(); len(got) != 2 || got[0] != "Chốt thứ Sáu" || got[1] != "" {
		t.Fatalf("texts must keep every string as is: %q", got)
	}
	v2, err := ParseCatchUpJSON(`{"summary":"x","highlights":[{"text":"Có nguồn","source_id":"S2"},{"text":"Nguồn lạ","source_id":"S9"},{"text":"Không nguồn","source_id":""}]}`, pack)
	want := []CatchUpHighlight{{Text: "Có nguồn", SourceID: "S2"}, {Text: "Nguồn lạ"}, {Text: "Không nguồn"}}
	if err != nil || len(v2.Highlights) != len(want) {
		t.Fatalf("object highlights: %+v %v", v2, err)
	}
	for i := range want {
		if v2.Highlights[i] != want[i] {
			t.Fatalf("highlight %d: %+v want %+v", i, v2.Highlights[i], want[i])
		}
	}
	if _, err := ParseCatchUpJSON(`{"summary":"x","highlights":[1]}`, pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("a highlight neither string nor object: %v", err)
	}
	if _, err := ParseCatchUpJSON("no json", pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("%v", err)
	}
	if _, err := ParseCatchUpJSON(`{"summary":""}`, pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("%v", err)
	}
	if _, err := ParseCatchUpJSON(`{"summary":"x",`, pack); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("%v", err)
	}
}

func TestAIErrorMethods(t *testing.T) {
	wrapped := ErrQuotaExceeded.wrap(errors.New("db"))
	var ae *Error
	if !errors.As(wrapped, &ae) || ae.Error() == "" || ae.Unwrap() == nil {
		t.Fatalf("%v", wrapped)
	}
	plain := &Error{Code: "x", Msg: "m"}
	if plain.Error() != "x: m" || plain.Unwrap() != nil {
		t.Fatalf("%v", plain)
	}
	if !errors.Is(wrapped, ErrQuotaExceeded) || errors.Is(wrapped, ErrDisabled) {
		t.Fatal("Is by code")
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
	pool := testutil.DB(t)
	// ai_model_rates is the global catalogue and survives the test TRUNCATE;
	// drop the fake provider's rows so an earlier run cannot price this one.
	if _, err := pool.Exec(context.Background(), "DELETE FROM ai_model_rates WHERE provider = 'fake'"); err != nil {
		t.Fatal(err)
	}
	q := db.New(pool)
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
	// UsagePresent is set explicitly: the fake stands in for a vendor that
	// answered with a usage block, and this test pins the priced path (BE3B-4).
	// A reply without the flag is the no-usage shape, tested separately.
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"answer":"ok","citations":[]}`, Model: "fake", UsagePresent: true, InputTokens: 1_000_000, OutputTokens: 500_000}
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

// The unknown-usage branch is UniWork AI's alone (BE3B-4, design §6.3): every
// other capability keeps the pre-03b priced path, so a vendor that omitted the
// usage block still settles succeeded with a cost and is still metered — not a
// usage_unknown row nobody reconciles (AiUniworkUnknownUsageEvents filters
// capability = 'office_uniwork_ai').
//
// One database fixture for both calls: testutil.DB serializes tests with a
// session advisory lock, so a second call inside the same test would wait on
// the first pool's lock forever.
func TestGatewayUnknownUsageBranchScopedToUniwork(t *testing.T) {
	ctx := context.Background()
	pool := testutil.DB(t)
	if _, err := pool.Exec(ctx, "DELETE FROM ai_model_rates WHERE provider = 'fake'"); err != nil {
		t.Fatal(err)
	}
	q := db.New(pool)
	// A reply that positively reports no usage block: UsagePresent false and
	// no tokens (the shape the branch exists for).
	noUsage := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "{}", Model: "fake"}
	}}
	if _, err := q.AiInsertRate(ctx, db.AiInsertRateParams{ID: util.NewID(), Provider: "fake", Model: "fake", InputMicrosPerMtok: 2_000_000, OutputMicrosPerMtok: 4_000_000, EffectiveAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}}); err != nil {
		t.Fatal(err)
	}

	// A non-UniWork capability: priced/metered as before, no unknown row.
	quota := &fakeQuota{}
	g := NewGateway(q, noUsage, quota, nil, Options{Timeout: time.Second})
	resp, err := g.Complete(ctx, askReq())
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "succeeded" || row.ReasonCode.Valid || row.CostMicros != 0 || !row.CompletedAt.Valid {
		t.Fatalf("non-UniWork no-usage row = %+v, want succeeded priced at 0 with no reason code", row)
	}
	if resp.UsagePresent {
		t.Fatal("a vendor that sent no usage block must report UsagePresent false")
	}
	if len(quota.recorded) != 1 {
		t.Fatalf("non-UniWork no-usage call metered %d times, want the priced path to still record", len(quota.recorded))
	}

	// UniWork AI on the same shape: the A16 branch, no meter call.
	uQuota := &fakeQuota{}
	ug := NewGateway(q, noUsage, uQuota, nil, Options{Timeout: time.Second})
	uresp, err := ug.Complete(ctx, Request{
		Actor: audit.User("u1"), OrganizationID: "org1", WorkspaceID: "ws1",
		Capability: CapOfficeUniworkAI, PromptID: PromptOfficeUniworkAI, Module: "xlsx",
		History: []provider.Message{{Role: "user", Content: "how many rows?"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	urow, err := q.AiGetUsageEvent(ctx, uresp.UsageEventID)
	if err != nil {
		t.Fatal(err)
	}
	if urow.Status != "succeeded" || urow.ReasonCode.String != UsageUnknownReason || urow.CostMicros != 0 {
		t.Fatalf("UniWork no-usage row = %+v, want succeeded/%s at cost 0", urow, UsageUnknownReason)
	}
	if len(uQuota.recorded) != 0 {
		t.Fatalf("UniWork unknown-usage call metered %d times, want the reconciler to own that charge", len(uQuota.recorded))
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
	out, err := ParseAnswer(FakeReply(req).Text, pack)
	if err != nil || len(out.Citations) != 2 || !strings.Contains(out.Answer, "[S1]") {
		t.Fatalf("%+v %v", out, err)
	}
	empty, _ := ParseAnswer(FakeReply(provider.CompletionRequest{System: p.System, Messages: []provider.Message{{Role: "user", Content: "Sources: (none)"}}}).Text, nil)
	if empty.Answer != NoSourcesAnswer {
		t.Fatalf("%q", empty.Answer)
	}
	if _, err := ParseSummaryJSON(FakeReply(provider.CompletionRequest{System: "meeting"}).Text); err != nil {
		t.Fatal(err)
	}
}

// TestFakeReplyReportsUsage pins BE-4: under AI_PROVIDER=fake the gateway
// builds &provider.Fake{Reply: FakeReply} (config.go), so this response is
// what every fake turn returns. It must report usage like the scripted
// provider/fake.go path does; otherwise, once G6-03b reads UsagePresent,
// every CI and E2E fake turn would take the usage_unknown branch and never
// reach quota.Record (spec §8.2).
func TestFakeReplyReportsUsage(t *testing.T) {
	p, _ := LookupPrompt(PromptCopilotAnswer)
	cases := []provider.CompletionRequest{
		{Model: "fake", System: p.System, Messages: []provider.Message{{Role: "user", Content: "Sources: (none)"}}},
		{Model: "fake", System: "You catch a teammate up", Messages: []provider.Message{{Role: "user", Content: "Sources: (none)"}}},
		{Model: "fake", System: "meeting", Messages: []provider.Message{{Role: "user", Content: "x"}}},
	}
	for _, req := range cases {
		resp := FakeReply(req)
		if !resp.UsagePresent || resp.InputTokens <= 0 || resp.OutputTokens <= 0 {
			t.Fatalf("system %q: usage not reported: %+v", req.System, resp)
		}
		if resp.Model != req.Model {
			t.Fatalf("system %q: model %q", req.System, resp.Model)
		}
	}
}

func TestCloudChargeTable(t *testing.T) {
	for secs, want := range map[float64]int64{0: 1000, 1: 1000, 60: 1000, 60.5: 2000, 600: 10000} {
		if got := TranscribeCharge(secs); got != want {
			t.Errorf("TranscribeCharge(%v) = %d, want %d", secs, got, want)
		}
	}
	if CloudSearchTokens != 500 || CloudImageTokensPerImage != 4000 || CloudTranscribeTokensPerMinute != 1000 {
		t.Fatal("contract D5 token-equivalents changed")
	}
}

func TestCloudFromEnv(t *testing.T) {
	env := map[string]string{
		"AI_CLOUD_SEARCH_PROVIDER": "brave", "AI_CLOUD_SEARCH_API_KEY": "k",
		"AI_CLOUD_IMAGE_PROVIDER":      "openai", // no key: unavailable
		"AI_CLOUD_TRANSCRIBE_PROVIDER": "fake",
	}
	c := CloudFromEnv(func(k string) string { return env[k] })
	if c.Search == nil || c.Search.Name() != "brave" || c.Images != nil || c.Transcriber == nil {
		t.Fatalf("cloud: %+v", c)
	}
	g := NewGateway(nil, nil, nil, nil, Options{Cloud: c})
	a := g.CloudAvailability()
	if !a.WebSearch || !a.ImageSearch || a.ImageGenerate || !a.Transcribe || a.MediaAnalyze {
		t.Fatalf("availability: %+v", a)
	}
	if _, err := g.CloudImage(context.Background(), CloudCall{}, provider.ImageRequest{}); !errors.Is(err, ErrCloudUnavailable) {
		t.Fatalf("image unavailable: %v", err)
	}
	if empty := CloudFromEnv(func(string) string { return "" }); empty.Search != nil || empty.Images != nil || empty.Transcriber != nil {
		t.Fatalf("empty env: %+v", empty)
	}
}

func TestParseMediaAnalysisJSON(t *testing.T) {
	if got := ParseMediaAnalysisJSON("```json\n{\"text\":\"ok\"}\n```"); got.Text != "ok" {
		t.Fatalf("fenced: %q", got.Text)
	}
	if got := ParseMediaAnalysisJSON("plain prose"); got.Text != "plain prose" {
		t.Fatalf("prose: %q", got.Text)
	}
}

// A cloud tool call is metered like a completion: a finished usage row whose
// input_tokens is the token-equivalent the meter was charged; a vendor error
// marks the row failed and charges nothing; an exhausted quota writes a
// rejected row and never reaches the vendor.
func TestGatewayCloudMeters(t *testing.T) {
	ctx := context.Background()
	quota := &fakeQuota{}
	g, q := gatewayFixture(t, &provider.Fake{}, quota)
	search, images := &provider.FakeSearch{}, &provider.FakeImages{}
	g.SetCloud(CloudTools{Search: search, Images: images, Transcriber: &provider.FakeTranscriber{}})
	call := CloudCall{Actor: audit.User("u1"), OrganizationID: "org1"}

	res, err := g.CloudSearch(ctx, call, provider.SearchRequest{Query: "q", Kind: "web", MaxResults: 2})
	if err != nil || len(res.Results) != 2 {
		t.Fatalf("search: %+v %v", res, err)
	}
	if len(quota.recorded) != 1 || quota.recorded[0].Tokens != CloudSearchTokens {
		t.Fatalf("search charge: %+v", quota.recorded)
	}
	row, err := q.AiGetUsageEvent(ctx, quota.recorded[0].UsageEventID)
	if err != nil || row.Status != "succeeded" || row.Capability != "cloud_search" || row.InputTokens != int32(CloudSearchTokens) || row.Provider != "fake" || row.WorkspaceID.Valid {
		t.Fatalf("search row: %+v %v", row, err)
	}

	if _, err := g.CloudTranscribe(ctx, call, provider.TranscribeRequest{Audio: provider.Part{MIME: "audio/mpeg", Data: make([]byte, 16384*90)}}); err != nil {
		t.Fatal(err)
	}
	if got := quota.recorded[1].Tokens; got != 2*CloudTranscribeTokensPerMinute {
		t.Fatalf("90 s of audio charged %d", got)
	}

	images.Err = errors.New("vendor down")
	if _, err := g.CloudImage(ctx, call, provider.ImageRequest{Prompt: "p"}); !errors.Is(err, ErrProviderError) {
		t.Fatalf("image error: %v", err)
	}
	if len(quota.recorded) != 2 {
		t.Fatalf("a failed call was charged: %+v", quota.recorded)
	}

	quota.checkErr = ErrQuotaExceeded
	calls := search.Calls
	if _, err := g.CloudSearch(ctx, call, provider.SearchRequest{Query: "q", Kind: "web", MaxResults: 1}); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("quota: %v", err)
	}
	if search.Calls != calls {
		t.Fatal("vendor called over quota")
	}
}

// Media analysis is a completion whose final user message carries the parts.
func TestGatewayMediaAttachments(t *testing.T) {
	fp := &provider.Fake{Reply: FakeReply}
	g, _ := gatewayFixture(t, fp, &fakeQuota{})
	resp, err := g.Complete(context.Background(), Request{
		Actor: audit.User("u1"), OrganizationID: "org1", Capability: CapMediaAnalysis, PromptID: PromptMediaAnalysis,
		Vars:        map[string]any{"requirements": "mô tả", "locale": "vi", "files": "image/png"},
		Attachments: []provider.Part{{MIME: "image/png", Data: []byte{1}}},
	})
	if err != nil || ParseMediaAnalysisJSON(resp.Text).Text != "Phân tích thử nghiệm của 1 tệp." {
		t.Fatalf("%+v %v", resp, err)
	}
	if last := fp.Last.Messages[len(fp.Last.Messages)-1]; len(last.Parts) != 1 {
		t.Fatalf("parts not sent: %+v", last)
	}
	fp.Err = provider.ErrUnsupportedMedia
	if _, err := g.Complete(context.Background(), Request{
		Actor: audit.User("u1"), OrganizationID: "org1", Capability: CapMediaAnalysis, PromptID: PromptMediaAnalysis,
		Vars: map[string]any{}, Attachments: []provider.Part{{MIME: "video/mp4"}},
	}); !errors.Is(err, ErrMediaUnsupported) {
		t.Fatalf("unsupported media: %v", err)
	}
}

// ---- office_uniwork_ai (G6-13, G6-D1 A1) -----------------------------------

func TestPolicyOfficeUniworkAI(t *testing.T) {
	for prov, want := range map[string]string{"anthropic": "claude-opus-5", "openai": "gpt-4o", "fake": "fake"} {
		p, model, err := ResolveModel(CapOfficeUniworkAI, prov, nil, nil)
		if err != nil || model != want || p.MaxTokens != 4096 || p.Temperature != 0 {
			t.Fatalf("%s: %+v %s %v", prov, p, model, err)
		}
	}
	// No ollama default: UniWork AI is not configured on an ollama deployment,
	// and the refusal says for which capability.
	if _, _, err := ResolveModel(CapOfficeUniworkAI, "ollama", nil, nil); err == nil || !strings.Contains(err.Error(), "office_uniwork_ai") {
		t.Fatalf("ollama must refuse office_uniwork_ai: %v", err)
	}
	env := func(v string) func(string) string {
		return func(k string) string {
			if k == "AI_MODEL_OFFICE_UNIWORK_AI" {
				return v
			}
			return ""
		}
	}
	if _, m, _ := ResolveModel(CapOfficeUniworkAI, "openai", env("gpt-4o-mini"), nil); m != "gpt-4o-mini" {
		t.Fatalf("override in allowlist ignored: %s", m)
	}
	if _, m, _ := ResolveModel(CapOfficeUniworkAI, "openai", env("dev-model"), []string{"dev-model"}); m != "dev-model" {
		t.Fatalf("AI_MODEL_ALLOW not honoured: %s", m)
	}
	var logs strings.Builder
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(prev)
	if _, m, _ := ResolveModel(CapOfficeUniworkAI, "openai", env("dev-model"), nil); m != "gpt-4o" {
		t.Fatalf("override outside allowlist accepted: %s", m)
	}
	if out := logs.String(); !strings.Contains(out, "outside allowlist") || !strings.Contains(out, "office_uniwork_ai") || !strings.Contains(out, "dev-model") {
		t.Fatalf("no warning logged: %q", out)
	}
	// Existing capabilities keep their policies: ollama still has a default.
	if _, m, err := ResolveModel(CapCopilotAnswer, "ollama", nil, nil); err != nil || m != "llama3.1" {
		t.Fatalf("copilot on ollama: %s %v", m, err)
	}
}

// ---- Tool-result turn (G6-13): one Complete per tool-result round ------------

func toolTurnHistory(id string) []provider.Message {
	return []provider.Message{
		{Role: "user", Content: "what is in A1?"},
		{Role: "assistant", ToolCalls: []provider.ToolCall{{ID: id, Name: "get_cell", Input: json.RawMessage(`{"cell":"A1"}`)}}},
		{Role: "tool", ToolCallID: id, Content: `{"value":42}`},
	}
}

// TestRequestMessages pins what reaches the provider: the old path is
// History + the rendered prompt (unchanged for every existing caller), a
// tool-result turn is History exactly, with no invented user message.
func TestRequestMessages(t *testing.T) {
	p, _ := LookupPrompt(PromptCopilotAnswer)
	req := askReq()
	req.History = []provider.Message{{Role: "user", Content: "trước"}, {Role: "assistant", Content: "sau"}}
	req.Attachments = []provider.Part{{MIME: "image/png", Data: []byte{1}}}
	got, err := requestMessages(req, p)
	if err != nil {
		t.Fatal(err)
	}
	want := append(append([]provider.Message{}, req.History...), provider.Message{Role: "user", Content: p.Render(req.Vars), Parts: req.Attachments})
	if gj, wj := mustJSON(t, got), mustJSON(t, want); gj != wj {
		t.Fatalf("default path changed:\n%s\n%s", gj, wj)
	}

	turn := Request{ToolResultTurn: true, History: toolTurnHistory("call_1")}
	got, err = requestMessages(turn, p)
	if err != nil {
		t.Fatal(err)
	}
	if gj, wj := mustJSON(t, got), mustJSON(t, turn.History); gj != wj {
		t.Fatalf("tool turn must be History as is:\n%s\n%s", gj, wj)
	}
	// Parallel calls: every result after the assistant turn that asked.
	parallel := toolTurnHistory("call_1")
	parallel[1].ToolCalls = append(parallel[1].ToolCalls, provider.ToolCall{ID: "call_2", Name: "get_cell"})
	parallel = append(parallel, provider.Message{Role: "tool", ToolCallID: "call_2", Content: "7"})
	if _, err := requestMessages(Request{ToolResultTurn: true, History: parallel}, p); err != nil {
		t.Fatalf("parallel results refused: %v", err)
	}

	// Every call must be paired with exactly one result: an unanswered call, a
	// repeated result, a repeated call id and an empty call id are all refused
	// (BE13-1).
	partial := toolTurnHistory("call_1")
	partial[1].ToolCalls = append(partial[1].ToolCalls, provider.ToolCall{ID: "call_2", Name: "get_cell"})
	duplicate := append(toolTurnHistory("call_1"), provider.Message{Role: "tool", ToolCallID: "call_1", Content: "again"})
	repeated := toolTurnHistory("call_1")
	repeated[1].ToolCalls = append(repeated[1].ToolCalls, provider.ToolCall{ID: "call_1", Name: "get_cell"})
	nameless := toolTurnHistory("call_1")
	nameless[1].ToolCalls = append([]provider.ToolCall{{Name: "get_cell"}}, nameless[1].ToolCalls...)
	// Parts on a role "tool" message would reach the vendor as media on a tool
	// result (BE13-4).
	withParts := toolTurnHistory("call_1")
	withParts[2].Parts = []provider.Part{{MIME: "image/png", Data: []byte{1}}}

	for name, bad := range map[string]Request{
		"empty history":   {ToolResultTurn: true},
		"ends with user":  {ToolResultTurn: true, History: toolTurnHistory("call_1")[:1]},
		"result w/o call": {ToolResultTurn: true, History: []provider.Message{{Role: "user", Content: "q"}, {Role: "tool", ToolCallID: "call_1", Content: "1"}}},
		"unknown id":      {ToolResultTurn: true, History: append(toolTurnHistory("call_1")[:2], provider.Message{Role: "tool", ToolCallID: "call_9", Content: "1"})},
		"missing id":      {ToolResultTurn: true, History: append(toolTurnHistory("call_1")[:2], provider.Message{Role: "tool", Content: "1"})},
		"attachments":     {ToolResultTurn: true, History: toolTurnHistory("call_1"), Attachments: []provider.Part{{MIME: "image/png"}}},
		"unanswered call": {ToolResultTurn: true, History: partial},
		"dup result id":   {ToolResultTurn: true, History: duplicate},
		"dup call id":     {ToolResultTurn: true, History: repeated},
		"call w/o id":     {ToolResultTurn: true, History: nameless},
		"parts on result": {ToolResultTurn: true, History: withParts},
	} {
		if _, err := requestMessages(bad, p); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}

	// A prompt without Render (office_uniwork_ai, BE14-1) renders nothing:
	// History goes as is and must end with the user's message; a tool-result
	// turn takes the same path as for any prompt.
	office := officePack(t)
	conv := []provider.Message{{Role: "user", Content: "trước"}, {Role: "assistant", Content: "sau"}, {Role: "user", Content: "cột X?"}}
	got, err = requestMessages(Request{History: conv}, office)
	if err != nil {
		t.Fatal(err)
	}
	if gj, wj := mustJSON(t, got), mustJSON(t, conv); gj != wj {
		t.Fatalf("render-less turn must be History as is:\n%s\n%s", gj, wj)
	}
	if got, err = requestMessages(Request{ToolResultTurn: true, History: toolTurnHistory("call_1")}, office); err != nil || len(got) != 3 {
		t.Fatalf("render-less tool turn: %v %d", err, len(got))
	}
	for name, bad := range map[string]Request{
		"no history":       {},
		"ends assistant":   {History: conv[:2]},
		"attachments":      {History: conv, Attachments: []provider.Part{{MIME: "image/png"}}},
		"tool turn broken": {ToolResultTurn: true, History: toolTurnHistory("call_1")[:2]},
	} {
		if _, err := requestMessages(bad, office); err == nil || !strings.HasPrefix(err.Error(), "ai: policy:") {
			t.Fatalf("render-less %s: %v", name, err)
		}
	}
}

// TestSystemTextOfficeModule: the system text a Sections prompt sends is the
// variant assembled for Request.Module; every other prompt sends its System
// whatever Module says, and a missing or unknown module is a policy refusal.
func TestSystemTextOfficeModule(t *testing.T) {
	office := officePack(t)
	for _, m := range officeModuleSections {
		want, err := OfficeSystemPrompt(m.module)
		if err != nil {
			t.Fatal(err)
		}
		got, err := systemText(Request{Module: m.module}, office)
		if err != nil || got != want {
			t.Fatalf("%s: %v\n%s", m.module, err, firstDiff(want, got))
		}
		if !strings.Contains(got, office.Sections[m.section]) || !strings.HasPrefix(got, office.System) {
			t.Fatalf("%s: not COMMON+MODULE", m.module)
		}
	}
	for _, module := range []string{"", "sheets", "XLSX", "csv"} {
		if _, err := systemText(Request{Module: module}, office); err == nil || !strings.HasPrefix(err.Error(), "ai: policy:") {
			t.Fatalf("module %q: %v", module, err)
		}
	}
	copilot, _ := LookupPrompt(PromptCopilotAnswer)
	if got, err := systemText(Request{Module: "xlsx"}, copilot); err != nil || got != copilot.System {
		t.Fatalf("single-System prompt changed: %v", err)
	}
	other := Prompt{ID: "other", Version: 1, System: "s", Sections: map[string]string{"sheets": "x"}}
	if _, err := systemText(Request{Module: "xlsx"}, other); err == nil {
		t.Fatal("a Sections prompt with no assembler accepted")
	}
}

// TestGatewayOfficeRefusedBeforeUsageRow: an office turn without a known
// module never reaches the usage row or the provider. The gateway has no
// database here, so reaching insertUsage would panic.
func TestGatewayOfficeRefusedBeforeUsageRow(t *testing.T) {
	fp := &provider.Fake{}
	g := NewGateway(nil, fp, nil, nil, Options{Timeout: time.Second})
	for _, module := range []string{"", "unknown"} {
		_, err := g.Complete(context.Background(), Request{
			Actor: audit.User("u1"), OrganizationID: "org1", Capability: CapOfficeUniworkAI,
			PromptID: PromptOfficeUniworkAI, Module: module,
			History: []provider.Message{{Role: "user", Content: "cột X?"}},
		})
		if err == nil || !strings.HasPrefix(err.Error(), "ai: policy:") {
			t.Fatalf("module %q: %v", module, err)
		}
	}
	if fp.Calls != 0 {
		t.Fatalf("provider called %d times", fp.Calls)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// TestGatewayToolResultTurn drives two rounds through the Gateway with the
// scripted fake: round 1 asks for a tool, round 2 sends the result under the
// same id and gets the answer; ids survive into Response and the audit column.
func TestGatewayToolResultTurn(t *testing.T) {
	const key = "test_tool_turn@1"
	prompts[key] = Prompt{ID: "test_tool_turn", Version: 1, System: "sys " + UntrustedFooter,
		Render: func(vars map[string]any) string { return fmt.Sprint(vars["question"]) }}
	t.Cleanup(func() { delete(prompts, key) })
	ctx := context.Background()
	fp := &provider.Fake{}
	g, q := gatewayFixture(t, fp, &fakeQuota{})
	req := Request{
		Actor: audit.User("u1"), OrganizationID: "org1", Capability: CapOfficeUniworkAI, PromptID: key,
		Vars:  map[string]any{"question": "what is in A1?"},
		Tools: Registry{{Name: "get_cell", Kind: ToolRead, Risk: RiskLow}},
	}
	first, err := g.Complete(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID != provider.FakeToolCallID {
		t.Fatalf("round 1 %+v", first)
	}
	row, err := q.AiGetUsageEvent(ctx, first.UsageEventID)
	if err != nil || row.Status != "succeeded" || !strings.Contains(row.ToolCalls, `"id":"`+provider.FakeToolCallID+`"`) {
		t.Fatalf("round 1 audit %+v %v", row, err)
	}

	req.ToolResultTurn = true
	req.Vars = nil
	req.History = []provider.Message{
		{Role: "user", Content: "what is in A1?"},
		{Role: "assistant", ToolCalls: first.ToolCalls},
		{Role: "tool", ToolCallID: first.ToolCalls[0].ID, Content: `{"value":42}`},
	}
	second, err := g.Complete(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(second.Text, provider.FakeToolCallID) || len(second.ToolCalls) != 0 {
		t.Fatalf("round 2 %+v", second)
	}
	if gj, wj := mustJSON(t, fp.Last.Messages), mustJSON(t, req.History); gj != wj {
		t.Fatalf("round 2 sent more than the history:\n%s\n%s", gj, wj)
	}
	if len(fp.Last.Tools) != 1 {
		t.Fatalf("tools not offered on round 2: %+v", fp.Last.Tools)
	}
	row2, _ := q.AiGetUsageEvent(ctx, second.UsageEventID)
	if row2.Status != "succeeded" || row2.Capability != "office_uniwork_ai" || row2.PromptID != key {
		t.Fatalf("round 2 usage %+v", row2)
	}
	// A malformed turn is refused before a usage row or a provider call.
	calls := fp.Calls
	req.History = req.History[:2]
	if _, err := g.Complete(ctx, req); err == nil || fp.Calls != calls {
		t.Fatalf("malformed turn reached the provider: %v", err)
	}
}
