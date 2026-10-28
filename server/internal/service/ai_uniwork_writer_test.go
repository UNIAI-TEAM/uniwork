package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// The writer route (plan 5) over the real gates, the real transcript store
// and the real run store on the test database; the provider is scripted.
// Skips without TEST_DATABASE_URL like the rest of the DB-backed suite.

type uniworkWriteWorld struct {
	f        *docPermFixture
	tn       docTenant
	svc      *AIUniworkService
	flags    flagMap
	provider *scriptedProvider
	doc      db.Document
}

func newUniworkWriteWorld(t *testing.T) *uniworkWriteWorld {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, "uniwork-write")
	box, err := secretbox.New([]byte("uniwork-write-test-key-material!"))
	if err != nil {
		t.Fatal(err)
	}
	flags := flagMap{officeAIUniworkFlag: true, officeAIUniworkFormatPrefix + "docx": true}
	p := answeringProvider()
	gw := ai.NewGateway(f.q, p, &runMeter{}, nil, ai.Options{Timeout: 5 * time.Second})
	svc := NewAIUniworkService(f.svc.orgs, NewEntitlementService(f.pool, f.q), f.svc,
		featureflag.NewService(flags), gw, ai.NewConversationStore(f.pool, f.q, box), nil)
	svc.SetRunStore(ai.NewRunStore(f.q))
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = f.pool.Exec(ctx, "DELETE FROM ai_uniwork_runs WHERE organization_id = $1", tn.orgID)
		_, _ = f.pool.Exec(ctx, "DELETE FROM ai_uniwork_turns WHERE conversation_id IN (SELECT id FROM ai_uniwork_conversations WHERE organization_id = $1)", tn.orgID)
		_, _ = f.pool.Exec(ctx, "DELETE FROM ai_uniwork_conversations WHERE organization_id = $1", tn.orgID)
	})
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID})
	return &uniworkWriteWorld{f: f, tn: tn, svc: svc, flags: flags, provider: p, doc: doc}
}

func (w *uniworkWriteWorld) scope() UniworkScope {
	return UniworkScope{UserID: w.tn.member.ID, OrgID: w.tn.orgID, DocumentID: w.doc.ID, Module: "docs"}
}

// question opens a conversation and its run the way the frame does: one chat
// turn. The writer call then continues that run.
func (w *uniworkWriteWorld) question(t *testing.T) UniworkTurn {
	t.Helper()
	return w.questionIn(t, w.scope())
}

// questionIn is question in another scope. A new conversation replaces the
// one of the same document (A9), so a second live one needs another document.
func (w *uniworkWriteWorld) questionIn(t *testing.T, scope UniworkScope) UniworkTurn {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"messages": []any{map[string]any{"role": "user", "content": "soạn giúp tôi"}}})
	turn, err := w.svc.Chat(context.Background(), scope, UniworkTurnInput{Body: body})
	if err != nil || turn.RunID == "" || turn.ConversationID == "" {
		t.Fatalf("the opening question = %+v, %v; want a conversation and a run", turn, err)
	}
	return turn
}

func writerBody(kind string, input map[string]any) []byte {
	raw, _ := json.Marshal(map[string]any{"kind": kind, "lang": "vi", "input": input})
	return raw
}

var docsWriterBody = writerBody("docs.write_document", map[string]any{"plan": "Báo cáo quý: tổng quan, doanh thu"})

func (w *uniworkWriteWorld) run(t *testing.T, id string) (modelCalls int, credits int64) {
	t.Helper()
	if err := w.f.pool.QueryRow(context.Background(),
		`SELECT model_calls, credits FROM ai_uniwork_runs WHERE id = $1`, id).Scan(&modelCalls, &credits); err != nil {
		t.Fatal(err)
	}
	return modelCalls, credits
}

func (w *uniworkWriteWorld) runCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := w.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_uniwork_runs WHERE organization_id = $1`, w.tn.orgID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// writeErrCode reads the wire code and fields a refusal travels with.
func writeErrCode(err error) (string, map[string]any) {
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code, ce.Fields
	}
	var ae *ai.Error
	if errors.As(err, &ae) {
		return ae.Code, ae.Fields
	}
	return "", nil
}

// One writer call is one model call of the run the frame is already in: the
// text reaches onDelta, model_calls moves by one, the run's credits grow, and
// the usage row names the writer capability and the kind's prompt.
func TestUniworkWriteStreamsAndCountsOneModelCall(t *testing.T) {
	w := newUniworkWriteWorld(t)
	turn := w.question(t)
	if calls, _ := w.run(t, turn.RunID); calls != 1 {
		t.Fatalf("the opening question left model_calls = %d, want 1", calls)
	}
	_, before := w.run(t, turn.RunID)

	var got strings.Builder
	res, err := w.svc.Write(context.Background(), UniworkWriteInput{
		Scope: w.scope(), ConversationID: turn.ConversationID, RunID: turn.RunID, Body: docsWriterBody,
	}, func(s string) { got.WriteString(s) })
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if res.ConversationID != turn.ConversationID || res.RunID != turn.RunID {
		t.Fatalf("result ids = %s/%s, want the run it continued %s/%s", res.ConversationID, res.RunID, turn.ConversationID, turn.RunID)
	}
	if got.String() == "" || got.String() != res.Response.Text {
		t.Fatalf("onDelta saw %q, the answer is %q; want the whole text through onDelta", got.String(), res.Response.Text)
	}
	calls, after := w.run(t, turn.RunID)
	if calls != 2 {
		t.Fatalf("model_calls after one writer call = %d, want 2", calls)
	}
	if after <= before {
		t.Fatalf("run credits %d -> %d, want the writer call added", before, after)
	}
	var capability, promptID string
	if err := w.f.pool.QueryRow(context.Background(),
		`SELECT capability, prompt_id FROM ai_usage_events WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
		w.tn.orgID).Scan(&capability, &promptID); err != nil {
		t.Fatal(err)
	}
	if capability != string(ai.CapOfficeUniworkWriter) || promptID != ai.WriterPromptID(ai.WriterDocsDocument) {
		t.Fatalf("usage row = %s/%s, want %s/%s", capability, promptID, ai.CapOfficeUniworkWriter, ai.WriterPromptID(ai.WriterDocsDocument))
	}
	if w.provider.callCount() != 2 {
		t.Fatalf("provider calls = %d, want the question and the writer call", w.provider.callCount())
	}
}

// A writer call never spends the last model call of a run: at nine it is
// refused run_limit_reached(model_calls), and the tool round that hands the
// writer's result back still gets the tenth (ruling R1: the cap lives in the
// run store, so the round is taken there on the same run).
func TestUniworkWriteKeepsTheLastCallForTheToolRound(t *testing.T) {
	w := newUniworkWriteWorld(t)
	turn := w.question(t)
	ctx := context.Background()
	if _, err := w.f.pool.Exec(ctx, `UPDATE ai_uniwork_runs SET model_calls = 9 WHERE id = $1`, turn.RunID); err != nil {
		t.Fatal(err)
	}

	res, err := w.svc.Write(ctx, UniworkWriteInput{
		Scope: w.scope(), ConversationID: turn.ConversationID, RunID: turn.RunID, Body: docsWriterBody,
	}, func(string) {})
	code, fields := writeErrCode(err)
	if code != "run_limit_reached" || fields["limit"] != ai.UniworkRunLimitModelCalls {
		t.Fatalf("a writer call at nine model calls = %v (%v), want run_limit_reached limit=model_calls", err, fields)
	}
	if res.RunID != turn.RunID || res.ConversationID != turn.ConversationID {
		t.Fatalf("the refusal names %s/%s, want the run it refused %s/%s", res.ConversationID, res.RunID, turn.ConversationID, turn.RunID)
	}
	if w.provider.callCount() != 1 {
		t.Fatalf("the refused writer call reached the provider: %d calls", w.provider.callCount())
	}

	round, err := ai.NewRunStore(w.f.q).TakeTurn(ctx, ai.TakeRunTurn{
		OrganizationID: w.tn.orgID, ConversationID: turn.ConversationID, RunID: turn.RunID,
		ToolRound: true, CreatedBy: w.tn.member.ID, Now: time.Now(),
	})
	if err != nil || round.ModelCalls != ai.UniworkRunModelCallMax {
		t.Fatalf("the tool round after the refused writer call = %+v, %v; want it to take call %d", round, err, ai.UniworkRunModelCallMax)
	}
}

// A writer call works inside a running turn only: no run header is 400, an
// unknown run and another conversation's run are 409 run_expired — and none
// opens a run or reaches the provider.
func TestUniworkWriteNeverOpensARun(t *testing.T) {
	w := newUniworkWriteWorld(t)
	turn := w.question(t)
	otherScope := w.scope()
	otherScope.DocumentID = w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", aclOwner: w.tn.member.ID, createdBy: w.tn.member.ID}).ID
	other := w.questionIn(t, otherScope)
	runs, calls := w.runCount(t), w.provider.callCount()

	for _, tc := range []struct {
		name, conv, run, code string
		status                int
	}{
		{"no run header", turn.ConversationID, "", "invalid_request", http.StatusBadRequest},
		{"no conversation header", "", turn.RunID, "invalid_request", http.StatusBadRequest},
		{"an unknown run", turn.ConversationID, util.NewID(), "run_expired", http.StatusConflict},
		{"another conversation's run", turn.ConversationID, other.RunID, "run_expired", http.StatusConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := w.svc.Write(context.Background(), UniworkWriteInput{
				Scope: w.scope(), ConversationID: tc.conv, RunID: tc.run, Body: docsWriterBody,
			}, func(string) {})
			if code, _ := writeErrCode(err); code != tc.code {
				t.Fatalf("Write = %v, want %s", err, tc.code)
			}
			if tc.code == "invalid_request" {
				if !errors.Is(err, ai.ErrWriterInvalid) || !strings.Contains(err.Error(), ai.UniworkRunHeader) {
					t.Fatalf("Write = %v, want the writer refusal naming %s", err, ai.UniworkRunHeader)
				}
			}
		})
	}
	if got := w.runCount(t); got != runs {
		t.Fatalf("runs %d -> %d, want no run opened by a writer call", runs, got)
	}
	if got := w.provider.callCount(); got != calls {
		t.Fatalf("provider calls %d -> %d, want none from a refused writer call", calls, got)
	}
}

// The kind names a module and the frame token names another: the token
// wins, and the call is refused before the gateway.
func TestUniworkWriteRefusesAKindOfAnotherModule(t *testing.T) {
	w := newUniworkWriteWorld(t)
	turn := w.question(t)
	body := writerBody("slides.page", map[string]any{
		"style": "tối giản", "title": "Mở đầu", "brief": "trang mở đầu", "page_index": 1, "total_pages": 3,
	})
	_, err := w.svc.Write(context.Background(), UniworkWriteInput{
		Scope: w.scope(), ConversationID: turn.ConversationID, RunID: turn.RunID, Body: body,
	}, func(string) {})
	if code, _ := writeErrCode(err); code != "invalid_request" || !errors.Is(err, ai.ErrWriterInvalid) {
		t.Fatalf("a slides kind on a docs frame = %v, want invalid_request", err)
	}
	if w.provider.callCount() != 1 {
		t.Fatalf("the refused kind reached the provider: %d calls", w.provider.callCount())
	}
}

// Writing changes the document, so a frame that may only view it is refused
// before anything else runs.
func TestUniworkWriteNeedsEdit(t *testing.T) {
	w := newUniworkWriteWorld(t)
	restricted := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID})
	w.f.share(t, restricted, DocumentPrincipalUser, w.tn.outsider.ID, DocumentLevelView, w.tn.aclOwner.ID)

	_, err := w.svc.Write(context.Background(), UniworkWriteInput{
		Scope:          UniworkScope{UserID: w.tn.outsider.ID, OrgID: w.tn.orgID, DocumentID: restricted.ID, Module: "docs"},
		ConversationID: util.NewID(), RunID: util.NewID(), Body: docsWriterBody,
	}, func(string) {})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("a view-only writer call = %v, want ErrForbidden", err)
	}
	if w.provider.callCount() != 0 {
		t.Fatalf("a view-only writer call reached the provider: %d calls", w.provider.callCount())
	}
}

// The writer passes the chat route's gates in the chat route's order and is
// refused with the chat route's codes: everything off answers the plan first,
// then the kill switch, then the format flag, then the credits.
func TestUniworkWriteGatesInChatOrder(t *testing.T) {
	w := newUniworkWriteWorld(t)
	turn := w.question(t)
	ctx := context.Background()
	var saved []byte
	if err := w.f.pool.QueryRow(ctx, `SELECT overrides FROM subscriptions WHERE organization_id = $1`, w.tn.orgID).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = w.f.pool.Exec(context.Background(), `UPDATE subscriptions SET overrides = $2 WHERE organization_id = $1`, w.tn.orgID, saved)
	})
	plan := func(overrides string) {
		t.Helper()
		if _, err := w.f.pool.Exec(ctx, `UPDATE subscriptions SET overrides = $2::jsonb WHERE organization_id = $1`, w.tn.orgID, overrides); err != nil {
			t.Fatal(err)
		}
	}
	calls := w.provider.callCount()
	expect := func(step, code, capability string) {
		t.Helper()
		_, werr := w.svc.Write(ctx, UniworkWriteInput{
			Scope: w.scope(), ConversationID: turn.ConversationID, RunID: turn.RunID, Body: docsWriterBody,
		}, func(string) {})
		body, _ := json.Marshal(map[string]any{"messages": []any{map[string]any{"role": "user", "content": "hỏi"}}})
		_, cerr := w.svc.Chat(ctx, w.scope(), UniworkTurnInput{ConversationID: turn.ConversationID, Body: body})
		wcode, wfields := writeErrCode(werr)
		ccode, cfields := writeErrCode(cerr)
		if wcode != code || ccode != code {
			t.Fatalf("%s: writer %v / chat %v, want both %s", step, werr, cerr, code)
		}
		if capability != "" && (wfields["capability"] != capability || cfields["capability"] != capability) {
			t.Fatalf("%s: fields.capability writer %v / chat %v, want %s", step, wfields["capability"], cfields["capability"], capability)
		}
	}

	plan(`{"office.ai_cloud": false, "ai.tokens": 0}`)
	w.flags[officeAIUniworkFlag] = false
	w.flags[officeAIUniworkFormatPrefix+"docx"] = false
	expect("plan off", "entitlement_required", "")
	plan(`{"ai.tokens": 0}`)
	expect("kill switch off", "office_capability_off", "ai_uniwork")
	w.flags[officeAIUniworkFlag] = true
	expect("format flag off", "office_capability_off", "ai_uniwork_docx")
	w.flags[officeAIUniworkFormatPrefix+"docx"] = true
	expect("credits spent", "credits_exhausted", "")

	if got := w.provider.callCount(); got != calls {
		t.Fatalf("provider calls %d -> %d, want no gated call to reach it", calls, got)
	}
}
