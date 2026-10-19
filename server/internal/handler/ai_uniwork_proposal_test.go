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
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
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

// uniworkProposalSnapshot is the baseline a case is measured against: the
// whole-tenant digest, plus the rows the claim makes a finer promise about.
type uniworkProposalSnapshot struct {
	digest   map[string]string
	outbox   map[string]string // outbox id -> topic|payload
	usage    map[string]string // usage_events id -> meter|delta|idempotency_key
	counters map[string]string // meter|period_start -> total|notified_80|notified_100
	audit    int
}

func uniworkProposalTake(t *testing.T, w *isoWorld, tn *isoTenant) uniworkProposalSnapshot {
	t.Helper()
	ctx := context.Background()
	snap := uniworkProposalSnapshot{
		digest:   w.tenantDigest(t, tn),
		outbox:   map[string]string{},
		usage:    map[string]string{},
		counters: map[string]string{},
	}
	rows, err := w.pool.Query(ctx,
		`SELECT id, topic, payload::text FROM outbox_events WHERE organization_id = $1 ORDER BY id`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, topic, payload string
		if err := rows.Scan(&id, &topic, &payload); err != nil {
			t.Fatal(err)
		}
		snap.outbox[id] = topic + "|" + payload
	}
	rows.Close()

	rows, err = w.pool.Query(ctx,
		`SELECT id, meter_key, delta, coalesce(idempotency_key, '')
		 FROM usage_events WHERE organization_id = $1 ORDER BY id`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, meter, idem string
		var delta int64
		if err := rows.Scan(&id, &meter, &delta, &idem); err != nil {
			t.Fatal(err)
		}
		snap.usage[id] = meter + "|" + idem + "|" + strconv.FormatInt(delta, 10)
	}
	rows.Close()

	rows, err = w.pool.Query(ctx,
		`SELECT meter_key, period_start::text, total, coalesce(notified_80_at::text, ''), coalesce(notified_100_at::text, '')
		 FROM usage_counters WHERE organization_id = $1 ORDER BY meter_key, period_start`, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var meter, period, n80, n100 string
		var total int64
		if err := rows.Scan(&meter, &period, &total, &n80, &n100); err != nil {
			t.Fatal(err)
		}
		snap.counters[meter+"|"+period] = strconv.FormatInt(total, 10) + "|" + n80 + "|" + n100
	}
	rows.Close()

	if err := w.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE organization_id = $1`, tn.orgID).Scan(&snap.audit); err != nil {
		t.Fatal(err)
	}
	return snap
}

// uniworkProposalCheck measures one case against its baseline: the digest
// classification, the usage rows, the counters, the outbox and audit_events.
// want is the set of permitted tables the turn must have changed.
func uniworkProposalCheck(t *testing.T, tn *isoTenant, before, after uniworkProposalSnapshot, want []string) {
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

	// usage_events: pre-existing rows byte-identical, new rows only the
	// ai.tokens meter.
	for id, row := range before.usage {
		if after.usage[id] != row {
			t.Errorf("usage_events %s = %q, want %q: a pre-existing usage row changed", id, after.usage[id], row)
		}
	}
	for id, row := range after.usage {
		if _, ok := before.usage[id]; ok {
			continue
		}
		if !strings.HasPrefix(row, "ai.tokens|") {
			t.Errorf("new usage_events %s = %q; only the ai.tokens meter may be recorded", id, row)
		}
	}

	// usage_counters: only the ai.tokens row for this turn's period may move.
	for key, row := range before.counters {
		got, ok := after.counters[key]
		if ok && got == row {
			continue
		}
		if !strings.HasPrefix(key, "ai.tokens|") {
			t.Errorf("usage_counters %s = %q (was %q); only the ai.tokens meter may move", key, got, row)
		}
	}
	for key := range after.counters {
		if _, ok := before.counters[key]; ok {
			continue
		}
		if !strings.HasPrefix(key, "ai.tokens|") {
			t.Errorf("new usage_counters %s; only the ai.tokens meter may be recorded", key)
		}
	}

	// outbox_events: pre-existing rows byte-identical, new rows only the
	// permitted topics.
	for id, row := range before.outbox {
		if after.outbox[id] != row {
			t.Errorf("outbox_events %s = %q, want %q: a pre-existing outbox row changed", id, after.outbox[id], row)
		}
	}
	for id, row := range after.outbox {
		if _, ok := before.outbox[id]; ok {
			continue
		}
		topic, _, _ := strings.Cut(row, "|")
		if !uniworkProposalTopics[topic] {
			t.Errorf("new outbox_events %s carries topic %q; only ai.usage.updated or quota.threshold may be emitted", id, topic)
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
			w.uniworkProvider.Reply = func(provider.CompletionRequest) provider.CompletionResponse {
				return provider.CompletionResponse{
					Text: "", ToolCalls: tc.calls, UsagePresent: true,
					InputTokens: 1200, OutputTokens: 64, StopReason: "tool_calls",
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
			if step, _ := ext["step"].(float64); step != 0 {
				t.Errorf("x_uniwork.step = %v; want 0 (no tool round ran)", ext["step"])
			}

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
			uniworkProposalCheck(t, tn, before, after, tc.want)
		})
	}
}
