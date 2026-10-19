package handler

// G712-A1-CONFIRM D half (UNI-1923): the server-side half of the A1/A3 claim.
//
// The claim: a UniWork AI turn whose model output carries allowlisted WRITE
// calls changes no business-content row and writes no audit_events row; the
// calls only return to the caller as proposals, with their id, name and
// arguments unchanged and finish_reason tool_calls. The turn does make
// accounting writes, and those are the only permitted changes:
// ai_uniwork_conversations / ai_uniwork_turns / ai_uniwork_runs /
// ai_usage_events, the ai.tokens meter of usage_events and usage_counters for
// this turn's usage key, and new outbox_events rows whose topic is
// ai.usage.updated (or quota.threshold, when a case crosses a threshold on
// purpose). Pre-existing outbox rows stay byte-identical. Anything else
// changing fails, naming the table.
//
// The oracle is the isolation matrix's own tenantDigest + isoDiff, unchanged,
// over the real router, the real ai.Gateway, the real PG conversation store,
// the real PG run store and the real quota/recorder of newUniworkWorld — not
// facadeGatewayFixture, whose fake quota and nil recorder would hide the
// billing and outbox writes the claim has to allow for.

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// uniworkScriptedIn and uniworkScriptedOut are the usage the fake provider
// reports: the turn is priced, and the meter's delta is known exactly.
const (
	uniworkScriptedIn  = 1200
	uniworkScriptedOut = 64
	// uniworkScriptedTokens is what the meter records for one turn — the
	// vendor's input plus output tokens (ai/gateway.go, quota.Record).
	uniworkScriptedTokens = uniworkScriptedIn + uniworkScriptedOut
)

// uniworkProposalPermitted is the accounting set the claim permits a
// proposal-only turn to change. A table that changed and is not in it fails
// the test with its name; a table in it may change.
var uniworkProposalPermitted = map[string]bool{
	"ai_uniwork_conversations": true,
	"ai_uniwork_turns":         true,
	"ai_uniwork_runs":          true,
	"ai_usage_events":          true,
	"usage_events":             true,
	"usage_counters":           true,
	"outbox_events":            true,
}

// uniworkProposalTopics are the only topics a new outbox row may carry.
var uniworkProposalTopics = map[string]bool{
	"ai.usage.updated": true,
	"quota.threshold":  true,
}

// uniworkOutboxRow is one outbox row as the claim reads it: the complete
// canonical row (so any column moving fails, not just the topic or payload)
// and the topic the new-row rule names.
type uniworkOutboxRow struct {
	canonical string // to_jsonb(x)::text — every column
	topic     string
}

// uniworkUsageRow is one usage_events row: the complete canonical row, plus
// the meter, delta and idempotency key the turn's own charge is named by.
type uniworkUsageRow struct {
	canonical string
	meter     string
	delta     int64
	key       string // idempotency_key, "" when NULL
}

// uniworkCounterRow is one usage_counters row: the complete canonical row,
// plus the total and the notified pair the one allowed counter moves.
type uniworkCounterRow struct {
	canonical string
	total     int64
	notified  string // notified_80_at|notified_100_at, "" when NULL
}

// uniworkProposalSnapshot is the baseline a case is measured against: the
// whole-tenant digest, plus complete canonical rows of the tables the claim
// makes a finer promise about.
type uniworkProposalSnapshot struct {
	digest   map[string]string
	outbox   map[string]uniworkOutboxRow  // outbox id -> row
	usage    map[string]uniworkUsageRow   // usage_events id -> row
	counters map[string]uniworkCounterRow // meter|period -> row
	audit    int
}

// uniworkCounterKey names one counter by its meter and the instant its period
// starts, formatted in UTC so the same instant is the same key however the
// session renders timestamptz.
func uniworkCounterKey(meter string, period time.Time) string {
	return meter + "|" + period.UTC().Format(time.RFC3339Nano)
}

func uniworkProposalTake(t *testing.T, w *isoWorld, tn *isoTenant) uniworkProposalSnapshot {
	t.Helper()
	ctx := context.Background()
	snap := uniworkProposalSnapshot{
		digest:   w.tenantDigest(t, tn),
		outbox:   map[string]uniworkOutboxRow{},
		usage:    map[string]uniworkUsageRow{},
		counters: map[string]uniworkCounterRow{},
	}
	rows, err := w.pool.Query(ctx,
		`SELECT id, topic, to_jsonb(x)::text FROM outbox_events x WHERE organization_id = $1 ORDER BY id`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		var row uniworkOutboxRow
		if err := rows.Scan(&id, &row.topic, &row.canonical); err != nil {
			t.Fatal(err)
		}
		snap.outbox[id] = row
	}
	rows.Close()

	rows, err = w.pool.Query(ctx,
		`SELECT id, meter_key, delta, coalesce(idempotency_key, ''), to_jsonb(x)::text
		 FROM usage_events x WHERE organization_id = $1 ORDER BY id`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		var row uniworkUsageRow
		if err := rows.Scan(&id, &row.meter, &row.delta, &row.key, &row.canonical); err != nil {
			t.Fatal(err)
		}
		snap.usage[id] = row
	}
	rows.Close()

	rows, err = w.pool.Query(ctx,
		`SELECT meter_key, period_start, total, coalesce(notified_80_at::text, '') || '|' || coalesce(notified_100_at::text, ''),
		        to_jsonb(x)::text
		 FROM usage_counters x WHERE organization_id = $1 ORDER BY meter_key, period_start`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var meter, notified string
		var period time.Time
		var row uniworkCounterRow
		if err := rows.Scan(&meter, &period, &row.total, &notified, &row.canonical); err != nil {
			t.Fatal(err)
		}
		row.notified = notified
		snap.counters[uniworkCounterKey(meter, period)] = row
	}
	rows.Close()

	if err := w.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE organization_id = $1`, tn.orgID).Scan(&snap.audit); err != nil {
		t.Fatal(err)
	}
	return snap
}

// uniworkProposalPeriod answers the counter key the tenant's meter is charged
// into right now, exactly as service.meterPeriodStart does: the paid term when
// the subscription has one, else the calendar month in Vietnam time.
func uniworkProposalPeriod(t *testing.T, w *isoWorld, tn *isoTenant, now time.Time) string {
	t.Helper()
	var start, end pgtype.Timestamptz
	if err := w.pool.QueryRow(context.Background(),
		`SELECT current_period_start, current_period_end FROM subscriptions
		 WHERE organization_id = $1 AND status <> 'canceled'`, tn.orgID).Scan(&start, &end); err != nil {
		t.Fatalf("subscription of %s: %v", tn.tag, err)
	}
	if end.Valid {
		return uniworkCounterKey("ai.tokens", start.Time)
	}
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		loc = time.FixedZone("Asia/Ho_Chi_Minh", 7*60*60)
	}
	n := now.In(loc)
	return uniworkCounterKey("ai.tokens", time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, loc))
}

// uniworkProposalRunKey answers the idempotency key of the charge this turn
// made: the run the returned conversation opened, and the model call this turn
// reserved (service/ai_uniwork.go uniworkMeterKey). Reading the run back binds
// the allowance to this turn rather than to any token accounting in the tenant.
func uniworkProposalRunKey(t *testing.T, w *isoWorld, tn *isoTenant, conversationID string) string {
	t.Helper()
	rows, err := w.pool.Query(context.Background(),
		`SELECT id, model_calls FROM ai_uniwork_runs
		 WHERE organization_id = $1 AND conversation_id = $2 ORDER BY id`, tn.orgID, conversationID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var id string
	var calls int
	n := 0
	for rows.Next() {
		if err := rows.Scan(&id, &calls); err != nil {
			t.Fatal(err)
		}
		n++
	}
	if n != 1 {
		t.Fatalf("ai_uniwork_runs rows for conversation %s = %d, want exactly one run", conversationID, n)
	}
	return fmt.Sprintf("uniwork-ai:%s:%d", id, calls)
}

// uniworkProposalCheck measures one case against its baseline: the digest
// classification, the usage rows, the counters, the outbox and audit_events.
// want is the set of permitted tables the turn must have changed.
//
// runKey is the idempotency key of the charge this turn must have made
// (uniwork-ai:<run id>:<model call no>) and periodKey is the counter the
// charge lands in; both are read from the database by the caller, so the
// allowance is bound to this turn and its period, not to any token accounting
// in the tenant.
func uniworkProposalCheck(t *testing.T, tn *isoTenant, before, after uniworkProposalSnapshot, want []string, runKey, periodKey string) {
	t.Helper()
	changed := isoDiff(before.digest, after.digest)
	seen := map[string]bool{}
	for _, name := range changed {
		seen[name] = true
		if !uniworkProposalPermitted[name] {
			t.Errorf("table %s changed in a proposal-only turn; it is not in the permitted accounting set (G712-A1-CONFIRM §1)", name)
		}
	}
	for _, name := range want {
		if !seen[name] {
			t.Errorf("table %s did not change; the turn did not do its accounting", name)
		}
	}
	t.Logf("changed tables: %v", changed)

	// audit_events: zero new rows, whatever the digest says.
	if after.audit != before.audit {
		t.Errorf("audit_events rows = %d, want %d: a proposal-only turn writes no audit row", after.audit, before.audit)
	}

	// usage_events: every pre-existing row byte-identical (the complete row,
	// not a projection), and exactly one new row — this turn's charge, on the
	// ai.tokens meter, under this run's key, for the scripted token delta.
	for id, row := range before.usage {
		if after.usage[id].canonical != row.canonical {
			t.Errorf("usage_events %s = %s, want %s: a pre-existing usage row changed", id, after.usage[id].canonical, row.canonical)
		}
	}
	var newUsage []string
	for id, row := range after.usage {
		if _, ok := before.usage[id]; ok {
			continue
		}
		newUsage = append(newUsage, id)
		if row.meter != "ai.tokens" {
			t.Errorf("new usage_events %s carries meter %q; only ai.tokens may be recorded", id, row.meter)
		}
		if row.key != runKey {
			t.Errorf("new usage_events %s idempotency key = %q, want %q: the charge must be this turn's", id, row.key, runKey)
		}
		if row.delta != uniworkScriptedTokens {
			t.Errorf("new usage_events %s delta = %d, want %d (the scripted input+output tokens)", id, row.delta, uniworkScriptedTokens)
		}
	}
	if len(newUsage) != 1 {
		t.Errorf("new usage_events rows = %d (%v), want exactly this turn's one ai.tokens charge", len(newUsage), newUsage)
	}

	// usage_counters: the one counter of this turn's period moves by exactly
	// the scripted delta; every other counter — other ai.tokens periods
	// included — stays byte-identical, and no counter is added beside it.
	moved := false
	for key, row := range before.counters {
		got, ok := after.counters[key]
		if key != periodKey {
			if !ok || got.canonical != row.canonical {
				t.Errorf("usage_counters %s = %s, want %s: only this turn's period may move", key, got.canonical, row.canonical)
			}
			continue
		}
		moved = true
		if got.total != row.total+uniworkScriptedTokens {
			t.Errorf("usage_counters %s total = %d, want %d (was %d, +%d)", key, got.total, row.total+uniworkScriptedTokens, row.total, uniworkScriptedTokens)
		}
		if got.notified != row.notified {
			t.Errorf("usage_counters %s notified = %q, want %q: a charge that crosses no threshold marks none", key, got.notified, row.notified)
		}
	}
	for key, row := range after.counters {
		if _, ok := before.counters[key]; ok {
			continue
		}
		if key != periodKey {
			t.Errorf("new usage_counters %s; only this turn's period counter may be recorded", key)
			continue
		}
		moved = true
		if row.total != uniworkScriptedTokens {
			t.Errorf("new usage_counters %s total = %d, want %d", key, row.total, uniworkScriptedTokens)
		}
		if row.notified != "|" {
			t.Errorf("new usage_counters %s notified = %q, want no threshold marked", key, row.notified)
		}
	}
	if !moved {
		t.Errorf("usage_counters has no row for this turn's period %s; the turn's charge did not land", periodKey)
	}

	// outbox_events: every pre-existing row byte-identical (the complete row),
	// new rows only the permitted topics.
	for id, row := range before.outbox {
		if after.outbox[id].canonical != row.canonical {
			t.Errorf("outbox_events %s = %s, want %s: a pre-existing outbox row changed", id, after.outbox[id].canonical, row.canonical)
		}
	}
	for id, row := range after.outbox {
		if _, ok := before.outbox[id]; ok {
			continue
		}
		if !uniworkProposalTopics[row.topic] {
			t.Errorf("new outbox_events %s carries topic %q; only ai.usage.updated or quota.threshold may be emitted", id, row.topic)
		}
	}
}

// uniworkSheetFrame seeds the spreadsheet the frame-scope case needs: the
// isolation world ships a DOCX and a Markdown frame document, and the sheets
// module's write tool (propose_operations) is only allowlisted on a
// spreadsheet. It answers the frame AI path and the frame token for it.
func uniworkSheetFrame(t *testing.T, w *isoWorld, tn *isoTenant) (string, string) {
	t.Helper()
	out := w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields:      map[string]string{"title": tn.marker + " Sheet", "visibility": "workspace"},
		filename:    strings.ToLower(tn.marker) + ".xlsx",
		contentType: anchorXLSXMime,
		content:     frameXlsx(t, 0),
	})
	documentID := isoID(t, out, "document")
	minted := w.call(t, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", tn.token, nil)
	return "/api/v1/office-frame/documents/" + documentID + "/ai/uniwork/chat/completions", isoString(t, minted, "token")
}

// uniworkProposalCalls reads the single choice of a non-stream answer and
// answers its tool_calls and finish_reason.
func uniworkProposalCalls(t *testing.T, out map[string]any) ([]map[string]any, string) {
	t.Helper()
	choices, ok := out["choices"].([]any)
	if !ok || len(choices) != 1 {
		t.Fatalf("choices = %v; want exactly one", out["choices"])
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	raw, _ := message["tool_calls"].([]any)
	calls := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		m, _ := c.(map[string]any)
		calls = append(calls, m)
	}
	reason, _ := choice["finish_reason"].(string)
	return calls, reason
}

// uniworkProposalEqual asserts one returned call is the scripted one, with id,
// name and arguments unchanged. Arguments are compared as decoded JSON, so the
// wire's spacing and key order are not the claim.
func uniworkProposalEqual(t *testing.T, calls []map[string]any, want provider.ToolCall) {
	t.Helper()
	if len(calls) != 1 {
		t.Fatalf("tool_calls = %v; want the one proposal %q", calls, want.Name)
	}
	call := calls[0]
	if call["id"] != want.ID {
		t.Errorf("tool_call id = %v, want %q", call["id"], want.ID)
	}
	if call["type"] != "function" {
		t.Errorf("tool_call type = %v, want function", call["type"])
	}
	fn, _ := call["function"].(map[string]any)
	if fn["name"] != want.Name {
		t.Errorf("tool_call name = %v, want %q", fn["name"], want.Name)
	}
	args, _ := fn["arguments"].(string)
	var got, exp any
	if err := json.Unmarshal([]byte(args), &got); err != nil {
		t.Fatalf("arguments %q are not JSON: %v", args, err)
	}
	if err := json.Unmarshal(want.Input, &exp); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, exp) {
		t.Errorf("arguments = %s, want %s", args, string(want.Input))
	}
}

// uniworkProposalDropped answers the x_uniwork dropped_tool_calls list.
func uniworkProposalDropped(t *testing.T, out map[string]any) []map[string]any {
	t.Helper()
	ext, _ := out["x_uniwork"].(map[string]any)
	raw, _ := ext["dropped_tool_calls"].([]any)
	dropped := make([]map[string]any, 0, len(raw))
	for _, d := range raw {
		m, _ := d.(map[string]any)
		dropped = append(dropped, m)
	}
	return dropped
}

// TestAIUniworkWriteCallsAreProposalsOnly is the A1/A3 server claim: a turn
// whose model output carries allowlisted write calls applies nothing. Each
// case posts one turn, asserts the proposal came back untouched with
// finish_reason tool_calls, and then measures the tenant digest, the usage
// rows, the counters, the outbox and audit_events against the baseline.
func TestAIUniworkWriteCallsAreProposalsOnly(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	framePath, frameToken := uniworkSheetFrame(t, w, tn)

	// The docs module's write tool on the tenant's DOCX: R3 takes a document
	// id and derives the module from it, so the same path serves a second
	// document scope with the docs allowlist.
	docsPath := "/api/v1/documents/" + tn.ids["frameDocument"] + "/ai/uniwork/chat/completions"

	accounting := []string{
		"ai_uniwork_conversations", "ai_uniwork_turns", "ai_uniwork_runs",
		"ai_usage_events", "usage_events", "usage_counters",
	}

	cases := []struct {
		name string
		// why records what the case is for, quoted in the report.
		why string
		// path, token and module are the turn's route and credential.
		path, token, module string
		tools               []string
		// calls is the scripted model output.
		calls []provider.ToolCall
		// kept is the proposal the client must get back unchanged.
		kept provider.ToolCall
		// dropped is the call the server must withhold, with its reason.
		droppedName, droppedReason string
		// outbox is the number of new outbox rows the case expects.
		outbox int
		want   []string
	}{{
		name:   "R1 org route, a local spreadsheet file",
		why:    "R1 carries no document, so the allowlist is always view-only (service/ai_uniwork.go:290, viewOnly = !doc.edit). The read tool rides through unchanged and the write tool is withheld view_only, so an R1 turn cannot apply anything.",
		path:   tn.uniworkOrgPath(),
		token:  tn.token,
		module: "sheets",
		tools:  []string{"read_cells", "propose_operations"},
		calls: []provider.ToolCall{
			{ID: "call_a1_r1_read", Name: "read_cells", Input: json.RawMessage(`{"range":"Sheet1!A1:B2"}`)},
			{ID: "call_a1_r1_write", Name: "propose_operations", Input: json.RawMessage(`{"operations":[{"op":"set_cell","sheetId":"sheet-1","address":"A1","value":"42"}],"summary":"ghi A1"}`)},
		},
		kept:        provider.ToolCall{ID: "call_a1_r1_read", Name: "read_cells", Input: json.RawMessage(`{"range":"Sheet1!A1:B2"}`)},
		droppedName: "propose_operations", droppedReason: "view_only",
		outbox: 0,
		want:   accounting,
	}, {
		name:   "R2 frame route, a spreadsheet document",
		why:    "The frame token names a spreadsheet the owner may edit, so propose_operations is allowlisted and must return as a proposal; the document scope supplies the workspace, so the turn's ai.usage.updated reaches the outbox.",
		path:   framePath,
		token:  frameToken,
		module: "sheets",
		tools:  []string{"propose_operations"},
		calls: []provider.ToolCall{
			{ID: "call_a1_r2_write", Name: "propose_operations", Input: json.RawMessage(`{"operations":[{"op":"set_cell","sheetId":"sheet-1","address":"B2","value":"=SUM(A1:A2)"}],"summary":"tổng A1:A2"}`)},
		},
		kept:   provider.ToolCall{ID: "call_a1_r2_write", Name: "propose_operations", Input: json.RawMessage(`{"operations":[{"op":"set_cell","sheetId":"sheet-1","address":"B2","value":"=SUM(A1:A2)"}],"summary":"tổng A1:A2"}`)},
		outbox: 1,
		want:   append(append([]string{}, accounting...), "outbox_events"),
	}, {
		name:   "R3 document route, a DOCX the owner edits",
		why:    "R3 derives the module from the document, so the docs write tool apply_ops is allowlisted and must return as a proposal; this is the case the red mutant (an UPDATE on documents) must break.",
		path:   docsPath,
		token:  tn.token,
		module: "docs",
		tools:  []string{"apply_ops"},
		calls: []provider.ToolCall{
			{ID: "call_a1_r3_write", Name: "apply_ops", Input: json.RawMessage(`{"ops":[{"op":"setFont","target":{"nodeType":"docHeading"},"color":"#FF0000"}],"dryRun":false}`)},
		},
		kept:   provider.ToolCall{ID: "call_a1_r3_write", Name: "apply_ops", Input: json.RawMessage(`{"ops":[{"op":"setFont","target":{"nodeType":"docHeading"},"color":"#FF0000"}],"dryRun":false}`)},
		outbox: 1,
		want:   append(append([]string{}, accounting...), "outbox_events"),
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := uniworkProposalTake(t, w, tn)
			periodKey := uniworkProposalPeriod(t, w, tn, time.Now())
			w.uniworkProvider.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
				return provider.CompletionResponse{
					Text: "", ToolCalls: tc.calls, UsagePresent: true,
					InputTokens: uniworkScriptedIn, OutputTokens: uniworkScriptedOut, StopReason: "tool_calls",
				}
			}

			status, conv, out := uniworkTurn(t, w, tc.path, tc.token, "",
				uniworkModuleQuestion("đề xuất thay đổi", tc.module, tc.tools...))
			if status != 200 {
				t.Fatalf("turn: %d %v; want 200", status, out)
			}
			if conv == "" {
				t.Fatal("turn: no conversation header")
			}

			calls, reason := uniworkProposalCalls(t, out)
			if reason != "tool_calls" {
				t.Errorf("finish_reason = %q, want tool_calls", reason)
			}
			uniworkProposalEqual(t, calls, tc.kept)

			dropped := uniworkProposalDropped(t, out)
			if tc.droppedName == "" {
				if len(dropped) != 0 {
					t.Errorf("x_uniwork.dropped_tool_calls = %v; the write tool is allowlisted here", dropped)
				}
			} else {
				if len(dropped) != 1 || dropped[0]["name"] != tc.droppedName || dropped[0]["reason"] != tc.droppedReason {
					t.Errorf("x_uniwork.dropped_tool_calls = %v; want %s %s", dropped, tc.droppedName, tc.droppedReason)
				}
			}

			// The turn is priced, so the accounting writes are real and the
			// permitted set is exercised, not vacuous.
			usage, _ := out["usage"].(map[string]any)
			total, _ := usage["total_tokens"].(float64)
			if total <= 0 {
				t.Fatalf("usage = %v; want a priced turn", out["usage"])
			}
			// step 0 is the first turn: no tool round was consumed, so no
			// editor ran and no tool result was posted.
			ext, _ := out["x_uniwork"].(map[string]any)
			step, ok := ext["step"].(float64)
			if !ok {
				t.Fatalf("x_uniwork.step = %v; want a numeric 0 (no tool round ran)", ext["step"])
			}
			if step != 0 {
				t.Errorf("x_uniwork.step = %v; want 0 (no tool round ran)", ext["step"])
			}

			// The charge this turn must have made is named by the run it
			// opened for the returned conversation, so the allowance is bound
			// to this turn rather than to any token accounting in the tenant.
			runKey := uniworkProposalRunKey(t, w, tn, conv)

			after := uniworkProposalTake(t, w, tn)
			newRows := 0
			for id := range after.outbox {
				if _, ok := before.outbox[id]; !ok {
					newRows++
				}
			}
			if newRows != tc.outbox {
				t.Errorf("new outbox_events rows = %d, want %d", newRows, tc.outbox)
			}
			uniworkProposalCheck(t, tn, before, after, tc.want, runKey, periodKey)
		})
	}
}
