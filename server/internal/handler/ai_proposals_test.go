package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's proposal routes over the real router (ADR 0044, R17). The model is
// a scripted fake provider: no live AI, and the only tool results are the ones
// the loop itself produced.

// propFlags turns the agent on and ask_uni_actions on or off with a switch the
// test flips; every other flag reads as its default.
type propFlags struct{ actions *atomic.Bool }

func (f propFlags) IsEnabled(_ context.Context, key string, def bool) bool {
	switch key {
	case "ask_uni_agent":
		return true
	case "ask_uni_actions":
		return f.actions.Load()
	}
	return def
}

type propWorld struct {
	srv               *httptest.Server
	pool              *pgxpool.Pool
	q                 *db.Queries
	fake              *provider.Fake
	actions           *atomic.Bool
	owner, member     string // bearer tokens
	ownerID, memberID string
	wsID, orgID       string
	conv, msg         string // an answer of the owner's with no row yet
}

func propCall(id, name string, args any) provider.ToolCall {
	raw, _ := json.Marshal(args)
	return provider.ToolCall{ID: id, Name: name, Input: raw}
}

// script makes the fake send each round's calls in turn, then answer; the
// title call is answered apart.
func (w *propWorld) script(answer string, rounds ...[]provider.ToolCall) {
	n := 0
	w.fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if strings.Contains(req.System, "Name this conversation") {
			return provider.CompletionResponse{Text: "Tiêu đề", UsagePresent: true, StopReason: "end_turn"}
		}
		if n < len(rounds) {
			n++
			return provider.CompletionResponse{ToolCalls: rounds[n-1], StopReason: "tool_use", UsagePresent: true, InputTokens: 10, OutputTokens: 5}
		}
		return provider.CompletionResponse{Text: answer, StopReason: "end_turn", UsagePresent: true, InputTokens: 20, OutputTokens: 7}
	}
}

func newPropWorld(t *testing.T) *propWorld {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	fake := &provider.Fake{Reply: ai.FakeReply}
	gw := service.NewAIGateway(pool, q, fake, ai.Options{})
	d.AskUNI = service.NewAskUNIService(pool, q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	actions := &atomic.Bool{}
	actions.Store(true)
	d.AskUNI.SetFlags(propFlags{actions: actions})
	d.AskUNI.SetReadTools(service.NewMcpToolService(q, d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := &propWorld{srv: srv, pool: pool, q: q, fake: fake, actions: actions}
	var wsID string
	w.owner, wsID = registerOrgWorkspace(t, srv, "askprop-owner@example.com", "Owner", "askprop")
	w.wsID = wsID
	w.member, w.memberID = signUp(t, srv, "askprop-member@example.com", "Member")
	w.ownerID = meID(t, srv, w.owner)
	if err := pool.QueryRow(context.Background(), `SELECT organization_id FROM workspaces WHERE id = $1`, wsID).Scan(&w.orgID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, w.memberID); err != nil {
		t.Fatal(err)
	}
	w.script("Xong.")
	w.conv, w.msg, _ = w.turn(t, w.owner, "", "Chào")
	return w
}

func meID(t *testing.T, srv *httptest.Server, token string) string {
	t.Helper()
	res, out := doJSON(t, srv, "GET", "/api/v1/me", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("me: %d %v", res.StatusCode, out)
	}
	return out["user"].(map[string]any)["id"].(string)
}

// turn is one dock turn over the stream route; it answers the conversation,
// the stored answer and the rows of the proposal event (none when the turn
// proposed nothing). events is the frame names in order.
func (w *propWorld) turn(t *testing.T, token, mode, question string) (convID, msgID string, rows []map[string]any) {
	t.Helper()
	body := map[string]any{"question": question, "locale": "vi"}
	if mode != "" {
		body["mode"] = mode
	}
	res := postStream(t, w.srv, w.wsID, token, body)
	if res.StatusCode != 200 {
		t.Fatalf("stream: %d", res.StatusCode)
	}
	frames := collectFrames(readSSE(res.Body))
	names := eventsOf(frames)
	for _, f := range frames {
		switch f.event {
		case "run":
			var run struct {
				ConversationID string `json:"conversation_id"`
			}
			_ = json.Unmarshal([]byte(f.data), &run)
			convID = run.ConversationID
		case "done":
			var done struct{ Message struct{ ID string } }
			_ = json.Unmarshal([]byte(f.data), &done)
			msgID = done.Message.ID
		case "proposal":
			var p struct{ Proposals []map[string]any }
			_ = json.Unmarshal([]byte(f.data), &p)
			rows = p.Proposals
			if i, j := slices.Index(names, "proposal"), slices.Index(names, "citations"); j >= 0 && i > j {
				t.Errorf("proposal event after citations: %v", names)
			}
		case "error":
			t.Fatalf("stream error frame: %s (events %v)", f.data, names)
		}
	}
	if convID == "" || msgID == "" {
		t.Fatalf("stream gave no run or done frame: %v", names)
	}
	return convID, msgID, rows
}

// seed stores a row of the owner's under the world's first answer, as a turn
// would have: the payload is what apply runs.
func (w *propWorld) seed(t *testing.T, position int, tool, payload, status string, targetID string, rev *int64) db.AgentActionProposal {
	t.Helper()
	var rv pgtype.Int8
	if rev != nil {
		rv = pgtype.Int8{Int64: *rev, Valid: true}
	}
	row, err := w.q.AiInsertProposal(context.Background(), db.AiInsertProposalParams{
		ID: util.NewID(), OrganizationID: w.orgID, WorkspaceID: w.wsID, Source: "ask_uni", RunID: util.NewID(),
		ConversationID: pgtype.Text{String: w.conv, Valid: true}, MessageID: pgtype.Text{String: w.msg, Valid: true},
		Position: int32(position), ActionType: tool, TargetKind: "task", TargetID: pgtype.Text{String: targetID, Valid: targetID != ""},
		Payload: payload, Preview: "{}", RiskLevel: "l2", Mode: "ask", TargetRevision: rv, Status: status,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedBy: w.ownerID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func (w *propWorld) createRow(t *testing.T, position int, title string) db.AgentActionProposal {
	t.Helper()
	return w.seed(t, position, "create_task", fmt.Sprintf(`{"title":%q}`, title), "pending", "", nil)
}

func (w *propWorld) call(t *testing.T, token, method, path string, body any) (*http.Response, map[string]any) {
	t.Helper()
	return doJSON(t, w.srv, method, path, token, body)
}

func proposalOf(out map[string]any, key string) map[string]any {
	e, _ := out["error"].(map[string]any)
	f, _ := e["fields"].(map[string]any)
	p, _ := f[key].(map[string]any)
	return p
}

func TestAskUniOnlyTheAskerDecidesAProposal(t *testing.T) {
	w := newPropWorld(t)
	w.script("Đã chuẩn bị.", []provider.ToolCall{
		propCall("c1", "create_task", map[string]any{"title": "Việc một"}),
		propCall("c2", "create_task", map[string]any{"title": "Việc hai"}),
		propCall("c3", "create_task", map[string]any{"title": "Việc ba"}),
	})
	conv, msg, rows := w.turn(t, w.owner, "ask", "Tạo ba việc")
	if len(rows) != 3 || rows[0]["status"] != "pending" || rows[0]["tool"] != "create_task" {
		t.Fatalf("proposal event = %v, want three pending create_task rows", rows)
	}
	id := func(i int) string { return rows[i]["id"].(string) }
	msgPath := "/api/v1/ai/conversations/" + conv + "/messages/" + msg

	attempts := []struct {
		name, method, path string
		body               any
	}{
		{"apply", "POST", "/api/v1/ai/proposals/" + id(0) + "/apply", nil},
		{"reject", "POST", "/api/v1/ai/proposals/" + id(0) + "/reject", nil},
		{"undo", "POST", "/api/v1/ai/proposals/" + id(0) + "/undo", nil},
		{"edit", "PATCH", "/api/v1/ai/proposals/" + id(0), map[string]any{"changes": map[string]any{"title": "Của tôi"}}},
		{"apply all", "POST", msgPath + "/proposals/apply", map[string]any{"proposal_ids": []string{id(0)}}},
		{"document", "POST", msgPath + "/document", nil},
	}
	for _, a := range attempts {
		// Another member of the same organization: the row names nothing.
		res, out := w.call(t, w.member, a.method, a.path, a.body)
		wantError(t, a.name+" by a colleague", res, out, http.StatusNotFound, "not_found")
		// The answer is the one an id that names nothing gets, byte for byte.
		fakePath, fakeBody := a.path, a.body
		raw, _ := json.Marshal(a.body)
		for _, id := range []string{id(0), conv, msg} {
			fake := util.NewID()
			fakePath = strings.ReplaceAll(fakePath, id, fake)
			raw = []byte(strings.ReplaceAll(string(raw), id, fake))
		}
		if a.body != nil {
			_ = json.Unmarshal(raw, &fakeBody)
		}
		_, nothing := w.call(t, w.member, a.method, fakePath, fakeBody)
		got, _ := json.Marshal(out)
		want, _ := json.Marshal(nothing)
		if string(got) != string(want) {
			t.Errorf("%s by a colleague answers %s, an id that names nothing answers %s", a.name, got, want)
		}
		if f, _ := out["error"].(map[string]any)["fields"]; f != nil {
			t.Errorf("%s by a colleague carries fields %v: a refusal names no row", a.name, f)
		}
		// No session at all.
		res, out = w.call(t, "", a.method, a.path, a.body)
		wantError(t, a.name+" without a session", res, out, http.StatusUnauthorized, errorCodeOf(out))
	}
	_, list := w.call(t, w.owner, "GET", "/api/v1/ai/conversations/"+conv+"/messages", nil)
	for _, m := range list["messages"].([]any) {
		for _, p := range m.(map[string]any)["proposals"].([]any) {
			if p.(map[string]any)["status"] != "pending" {
				t.Fatalf("a refused call changed a row: %v", p)
			}
		}
	}

	// The asker: edit, apply, undo one row; reject another; apply the third.
	res, out := w.call(t, w.owner, "PATCH", "/api/v1/ai/proposals/"+id(0), map[string]any{"changes": map[string]any{"title": "Việc một, sửa"}})
	if res.StatusCode != 200 || out["status"] != "pending" {
		t.Fatalf("asker edit: %d %v", res.StatusCode, out)
	}
	res, out = w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+id(0)+"/apply", nil)
	if res.StatusCode != 200 || out["status"] != "applied" || out["decision"] != "confirmed" || out["can_undo"] != true {
		t.Fatalf("asker apply: %d %v", res.StatusCode, out)
	}
	if res, out = w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+id(0)+"/undo", nil); res.StatusCode != 200 || out["status"] != "undone" {
		t.Fatalf("asker undo: %d %v", res.StatusCode, out)
	}
	if res, out = w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+id(1)+"/reject", nil); res.StatusCode != 200 || out["status"] != "rejected" {
		t.Fatalf("asker reject: %d %v", res.StatusCode, out)
	}
	res, out = w.call(t, w.owner, "POST", msgPath+"/proposals/apply", map[string]any{"proposal_ids": []string{id(2)}})
	got, _ := out["proposals"].([]any)
	if res.StatusCode != 200 || len(got) != 3 || got[2].(map[string]any)["status"] != "applied" {
		t.Fatalf("asker apply all: %d %v", res.StatusCode, out)
	}
}

func TestProposalRoutesMapErrors(t *testing.T) {
	w := newPropWorld(t)
	apply := func(id string) (*http.Response, map[string]any) {
		return w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+id+"/apply", nil)
	}
	// proposal_expired
	row := w.createRow(t, 1, "Hết hạn")
	if _, err := w.pool.Exec(context.Background(), `UPDATE agent_action_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, row.ID); err != nil {
		t.Fatal(err)
	}
	res, out := apply(row.ID)
	wantError(t, "an expired row", res, out, http.StatusConflict, "proposal_expired")

	// proposal_not_pending
	row = w.createRow(t, 2, "Đã bỏ")
	if res, out = w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+row.ID+"/reject", nil); res.StatusCode != 200 {
		t.Fatalf("reject: %d %v", res.StatusCode, out)
	}
	res, out = apply(row.ID)
	wantError(t, "a rejected row", res, out, http.StatusConflict, "proposal_not_pending")
	if proposalOf(out, "proposal") != nil {
		t.Error("a refusal before the command ran carries a row")
	}

	// proposal_ref_pending: row 4 names row 3, which is neither chosen nor applied.
	w.createRow(t, 3, "Gốc")
	child := w.seed(t, 4, "add_comment", `{"task_id":"{{row:3.id}}","body":"chào"}`, "pending", "", nil)
	res, out = w.call(t, w.owner, "POST", "/api/v1/ai/conversations/"+w.conv+"/messages/"+w.msg+"/proposals/apply", map[string]any{"proposal_ids": []string{child.ID}})
	wantError(t, "a row naming one that waits", res, out, http.StatusConflict, "proposal_ref_pending")
	if proposalOf(out, "proposals") != nil {
		t.Error("proposal_ref_pending runs nothing, yet carries rows")
	}

	// revision_conflict: the command ran and was refused, so the row failed and
	// the answer carries it, unlike every refusal above.
	_, task := w.call(t, w.owner, "POST", "/api/v1/workspaces/"+w.wsID+"/tasks", map[string]any{"title": "Đã đổi"})
	taskID := task["task"].(map[string]any)["id"].(string)
	stale := int64(999)
	row = w.seed(t, 5, "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, taskID), "pending", taskID, &stale)
	res, out = apply(row.ID)
	wantError(t, "a stale revision", res, out, http.StatusConflict, "revision_conflict")
	if p := proposalOf(out, "proposal"); p == nil || p["status"] != "failed" || p["error_code"] != "revision_conflict" || p["id"] != row.ID {
		t.Fatalf("a failed apply must carry its row in error.fields.proposal, got %v", out)
	}
	// The row is failed for good: a second apply is a refusal without a row.
	res, out = apply(row.ID)
	wantError(t, "a failed row again", res, out, http.StatusConflict, "proposal_not_pending")

	// undo_unavailable: the object changed after the apply.
	row = w.createRow(t, 6, "Sẽ bị sửa")
	res, out = apply(row.ID)
	if res.StatusCode != 200 {
		t.Fatalf("apply: %d %v", res.StatusCode, out)
	}
	made := out["result"].(map[string]any)
	res, upd := w.call(t, w.owner, "PUT", "/api/v1/tasks/"+made["object_id"].(string), map[string]any{"revision": made["revision"], "title": "Người khác sửa"})
	if res.StatusCode != 200 {
		t.Fatalf("edit after apply: %d %v", res.StatusCode, upd)
	}
	res, out = w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+row.ID+"/undo", nil)
	wantError(t, "an undo after a change", res, out, http.StatusConflict, "undo_unavailable")
	if _, back := w.call(t, w.owner, "GET", "/api/v1/ai/conversations/"+w.conv+"/messages", nil); !hasProposal(back, row.ID, "applied") {
		t.Error("a refused undo must leave the row applied")
	}

	// A row of somebody else is a refusal, never a failed row.
	res, out = w.call(t, w.member, "POST", "/api/v1/ai/proposals/"+row.ID+"/apply", nil)
	wantError(t, "a colleague's apply", res, out, http.StatusNotFound, "not_found")
	if proposalOf(out, "proposal") != nil {
		t.Error("a 404 carries a row")
	}

	// Values the service refuses are 400, and a colleague may not set the ceiling.
	res, out = w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-mode", map[string]any{"mode": "yolo"})
	wantError(t, "an unknown mode", res, out, http.StatusBadRequest, "invalid_request")
	res, out = w.call(t, w.owner, "PUT", "/api/v1/orgs/askprop/ai/ask-write-policy", map[string]any{"ceiling": "yolo"})
	wantError(t, "an unknown ceiling", res, out, http.StatusBadRequest, "invalid_request")
	res, out = w.call(t, w.member, "PUT", "/api/v1/orgs/askprop/ai/ask-write-policy", map[string]any{"ceiling": "ask"})
	wantError(t, "a member setting the ceiling", res, out, http.StatusForbidden, "forbidden")
	res, out = w.call(t, w.owner, "PUT", "/api/v1/ai/proposals/"+row.ID, nil)
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("PUT on a proposal = %d %v, want no such route", res.StatusCode, out)
	}
	if t.Failed() {
		return
	}
	res, out = w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-mode", map[string]any{"mode": "plan"})
	if res.StatusCode != 200 || out["mode"] != "plan" {
		t.Fatalf("mode: %d %v", res.StatusCode, out)
	}
	res, out = w.call(t, w.owner, "PUT", "/api/v1/orgs/askprop/ai/ask-write-policy", map[string]any{"ceiling": "auto"})
	if res.StatusCode != 200 || out["ceiling"] != "auto" {
		t.Fatalf("ceiling: %d %v", res.StatusCode, out)
	}
	if res, out = w.call(t, w.member, "GET", "/api/v1/orgs/askprop/ai/ask-write-policy", nil); res.StatusCode != 200 || out["ceiling"] != "auto" {
		t.Fatalf("a member reads the ceiling: %d %v", res.StatusCode, out)
	}
}

func hasProposal(list map[string]any, id, status string) bool {
	msgs, _ := list["messages"].([]any)
	for _, m := range msgs {
		ps, _ := m.(map[string]any)["proposals"].([]any)
		for _, p := range ps {
			if p.(map[string]any)["id"] == id && p.(map[string]any)["status"] == status {
				return true
			}
		}
	}
	return false
}

// Thirty applied rows a minute per person; the thirty-first is 429.
func TestProposalApplyRateLimitIs429(t *testing.T) {
	w := newPropWorld(t)
	for i := 1; i <= 31; i++ {
		row := w.createRow(t, i, fmt.Sprintf("Việc %d", i))
		res, out := w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+row.ID+"/apply", nil)
		if i <= 30 {
			if res.StatusCode != 200 {
				t.Fatalf("apply %d: %d %v", i, res.StatusCode, out)
			}
			continue
		}
		wantError(t, "the thirty-first apply in a minute", res, out, http.StatusTooManyRequests, "ai_write_rate_limited")
	}
}

// The flag is a kill switch: with it off every new route is 403
// ai_actions_disabled (R2), the mode and ceiling routes included.
func TestAskUniActionsOffRefusesEveryRoute(t *testing.T) {
	w := newPropWorld(t)
	row := w.createRow(t, 1, "Chờ")
	rejected := w.createRow(t, 2, "Đã bỏ")
	if res, out := w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+rejected.ID+"/reject", nil); res.StatusCode != 200 {
		t.Fatalf("reject: %d %v", res.StatusCode, out)
	}
	expired := w.createRow(t, 3, "Hết hạn")
	if _, err := w.pool.Exec(context.Background(), `UPDATE agent_action_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired.ID); err != nil {
		t.Fatal(err)
	}
	w.actions.Store(false)
	// A row that is no longer pending, or is past its hour, is no excuse for
	// answering anything but the kill switch (R2).
	for _, id := range []string{rejected.ID, expired.ID} {
		res, out := w.call(t, w.owner, "POST", "/api/v1/ai/proposals/"+id+"/apply", nil)
		wantError(t, "apply of a settled or expired row", res, out, http.StatusForbidden, "ai_actions_disabled")
	}
	// The bad body of a route that names no proposal gets the kill switch too.
	res, out := w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-mode", map[string]any{"mode": "yolo"})
	wantError(t, "a bad mode with the flag off", res, out, http.StatusForbidden, "ai_actions_disabled")
	res, out = w.call(t, w.owner, "PUT", "/api/v1/orgs/askprop/ai/ask-write-policy", map[string]any{"ceiling": "yolo"})
	wantError(t, "a bad ceiling with the flag off", res, out, http.StatusForbidden, "ai_actions_disabled")
	msgPath := "/api/v1/ai/conversations/" + w.conv + "/messages/" + w.msg
	routes := []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/v1/ai/proposals/" + row.ID + "/apply", nil},
		{"POST", "/api/v1/ai/proposals/" + row.ID + "/reject", nil},
		{"POST", "/api/v1/ai/proposals/" + row.ID + "/undo", nil},
		{"PATCH", "/api/v1/ai/proposals/" + row.ID, map[string]any{"changes": map[string]any{"title": "x"}}},
		{"POST", msgPath + "/proposals/apply", map[string]any{"proposal_ids": []string{row.ID}}},
		{"POST", msgPath + "/document", nil},
		{"PUT", "/api/v1/me/ask-uni-mode", map[string]any{"mode": "plan"}},
		{"GET", "/api/v1/orgs/askprop/ai/ask-write-policy", nil},
		{"PUT", "/api/v1/orgs/askprop/ai/ask-write-policy", map[string]any{"ceiling": "ask"}},
	}
	for _, r := range routes {
		res, out := w.call(t, w.owner, r.method, r.path, r.body)
		wantError(t, r.method+" "+r.path, res, out, http.StatusForbidden, "ai_actions_disabled")
	}
	// Nothing ran: the row still waits.
	w.actions.Store(true)
	if _, list := w.call(t, w.owner, "GET", "/api/v1/ai/conversations/"+w.conv+"/messages", nil); !hasProposal(list, row.ID, "pending") {
		t.Error("a refused call changed the row")
	}
}

// The list of messages carries each answer's rows, the list of conversations
// their taint, and the capabilities the write state.
func TestAskUniListsCarryProposalsTaintAndActions(t *testing.T) {
	w := newPropWorld(t)
	w.script("Đã chuẩn bị.", []provider.ToolCall{propCall("c1", "create_task", map[string]any{"title": "Việc mới"})})
	conv, msg, rows := w.turn(t, w.owner, "ask", "Tạo việc")
	if len(rows) != 1 {
		t.Fatalf("proposal event = %v", rows)
	}
	_, list := w.call(t, w.owner, "GET", "/api/v1/ai/conversations/"+conv+"/messages", nil)
	var seen bool
	for _, m := range list["messages"].([]any) {
		m := m.(map[string]any)
		ps := m["proposals"].([]any)
		if m["id"] == msg {
			seen = len(ps) == 1 && ps[0].(map[string]any)["id"] == rows[0]["id"]
		} else if len(ps) != 0 {
			t.Errorf("message %v carries proposals %v", m["id"], ps)
		}
	}
	if !seen {
		t.Errorf("the answer lists no proposals: %v", list)
	}
	_, convs := w.call(t, w.owner, "GET", "/api/v1/workspaces/"+w.wsID+"/ai/conversations", nil)
	for _, c := range convs["conversations"].([]any) {
		if _, ok := c.(map[string]any)["tainted"].(bool); !ok {
			t.Errorf("conversation %v has no tainted flag", c)
		}
	}
	_, caps := w.call(t, w.owner, "GET", "/api/v1/workspaces/"+w.wsID+"/ai/capabilities", nil)
	a, _ := caps["actions"].(map[string]any)
	if a["enabled"] != true || a["ceiling"] != "plan" || a["mode"] != "ask" {
		t.Errorf("capabilities.actions = %v, want enabled, plan ceiling, ask mode", a)
	}
}

// An apply-all that stops on a row whose command was refused is 409 with that
// row's code and every row of the answer in error.fields.proposals; a stop that
// is a refusal, even beside a row that failed earlier, is answered as the
// refusal and names the failed row of an earlier call to nobody.
func TestApplyAllReportsTheRowThatStoppedTheRun(t *testing.T) {
	w := newPropWorld(t)
	_, task := w.call(t, w.owner, "POST", "/api/v1/workspaces/"+w.wsID+"/tasks", map[string]any{"title": "Đích"})
	taskID := task["task"].(map[string]any)["id"].(string)
	stale := int64(999)
	staleRow := func(pos int) db.AgentActionProposal {
		return w.seed(t, pos, "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, taskID), "pending", taskID, &stale)
	}
	all := "/api/v1/ai/conversations/" + w.conv + "/messages/" + w.msg + "/proposals/apply"

	// A stale row inside apply-all: the row failed in this run.
	s1, later := staleRow(1), w.createRow(t, 2, "Sau")
	res, out := w.call(t, w.owner, "POST", all, map[string]any{"proposal_ids": []string{s1.ID, later.ID}})
	wantError(t, "a stale row in apply-all", res, out, http.StatusConflict, "revision_conflict")
	rows, _ := out["error"].(map[string]any)["fields"].(map[string]any)["proposals"].([]any)
	if len(rows) != 2 || rows[0].(map[string]any)["status"] != "failed" || rows[0].(map[string]any)["error_code"] != "revision_conflict" || rows[1].(map[string]any)["status"] != "pending" {
		t.Fatalf("error.fields.proposals = %v, want the failed row then the one left pending", rows)
	}

	// The failed row of that call, then a later row refused: the answer is the
	// refusal, not the earlier failure.
	expired := w.createRow(t, 3, "Hết hạn")
	if _, err := w.pool.Exec(context.Background(), `UPDATE agent_action_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, expired.ID); err != nil {
		t.Fatal(err)
	}
	res, out = w.call(t, w.owner, "POST", all, map[string]any{"proposal_ids": []string{later.ID, expired.ID}})
	wantError(t, "a refusal beside an earlier failure", res, out, http.StatusConflict, "proposal_expired")
	if f := out["error"].(map[string]any)["fields"]; f != nil {
		t.Errorf("a refusal carries fields %v, want none", f)
	}
}
