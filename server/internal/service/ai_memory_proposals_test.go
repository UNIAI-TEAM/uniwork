package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memDecideWorld is memWorld with the memory service's metrics recorded.
func memDecideWorld(t *testing.T) (*actWorld, *AiMemoryService) {
	t.Helper()
	w, m := memWorld(t)
	m.SetMetrics(w.m)
	return w, m
}

// storeMemoryProposals stores drafts as tc's asker's pending memory rows under
// a fresh answer, the way a turn does, and returns them in position order.
func storeMemoryProposals(t *testing.T, w *actWorld, tc ai.ToolContext, drafts ...askMemoryDraft) []db.AiMemoryProposal {
	t.Helper()
	convID, msgID := askAnswer(t, w.s, tc, "Xong.", nil)
	if err := w.s.insertTurnMemoryProposals(context.Background(), w.s.q, tc.OrganizationID, tc.WorkspaceID, convID, msgID, tc.ActorID, drafts); err != nil {
		t.Fatal(err)
	}
	return memRows(t, w, msgID)
}

func rememberDraft(kind, text string) askMemoryDraft {
	return askMemoryDraft{Action: "remember", Kind: kind, Body: text}
}

func updateDraft(e db.AiMemory, kind, text string) askMemoryDraft {
	return askMemoryDraft{Action: "update", MemoryID: e.ID, Kind: kind, Body: text, BeforeKind: e.Kind, BeforeBody: e.Body}
}

func forgetDraft(e db.AiMemory) askMemoryDraft {
	return askMemoryDraft{Action: "forget", MemoryID: e.ID, BeforeKind: e.Kind, BeforeBody: e.Body}
}

func memEntry(t *testing.T, m *AiMemoryService, userID, orgID, kind, text string) db.AiMemory {
	t.Helper()
	e, err := m.Create(context.Background(), userID, orgID, kind, text)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func memoryRow(t *testing.T, w *actWorld, id string) db.AiMemoryProposal {
	t.Helper()
	row, err := w.s.q.AiGetMemoryProposal(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// entryBodies is userID's memory in the world's organization as kind:body, in list order.
func entryBodies(t *testing.T, w *actWorld, userID string) []string {
	t.Helper()
	rows, err := w.s.q.AiListMemories(context.Background(), db.AiListMemoriesParams{OrganizationID: w.x.w.OrganizationID, UserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Kind+":"+r.Body)
	}
	return out
}

// memOutsider registers a person who owns an organization of their own.
func memOutsider(t *testing.T, w *actWorld, email, slug string) db.User {
	t.Helper()
	as := NewAuthService(w.s.pool, w.s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, w.s.q, as, email, "Người ngoài")
	if _, err := w.s.orgs.Create(context.Background(), u.ID, "Org "+slug, slug); err != nil {
		t.Fatal(err)
	}
	return u
}

// Applying runs the memory command the row names, as the asker under the
// proposal's via, and settles the row applied (R13, R14).
func TestApplyMemoryProposal(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	city := memEntry(t, m, u, org, "fact", "Tôi làm ở Hà Nội")
	long := memEntry(t, m, u, org, "preference", "Trả lời dài")
	rows := storeMemoryProposals(t, w, w.tc,
		rememberDraft("preference", "Gọi tôi là anh Vinh"),
		updateDraft(city, "fact", "Tôi làm ở Đà Nẵng"),
		forgetDraft(long))

	p, err := m.ApplyProposal(ctx, u, rows[0].ID)
	if err != nil || p.Status != "applied" || p.MemoryID == "" {
		t.Fatalf("apply remember = %+v, %v", p, err)
	}
	made, err := m.q.AiGetMemory(ctx, db.AiGetMemoryParams{ID: p.MemoryID, OrganizationID: org, UserID: u})
	if err != nil || made.Source != "chat" || made.ProposalID.String != rows[0].ID || made.Kind != "preference" || made.Body != "Gọi tôi là anh Vinh" {
		t.Fatalf("entry made = %+v, %v", made, err)
	}
	if r := memoryRow(t, w, rows[0].ID); r.Status != "applied" || !r.DecidedAt.Valid || r.MemoryID.String != made.ID {
		t.Fatalf("row = %+v", r)
	}
	if via := auditVia(t, w.x, audit.ActionAIMemoryCreated, made.ID); via["kind"] != "ask_uni" || via["proposal_id"] != rows[0].ID {
		t.Fatalf("created via %v", via)
	}

	if p, err := m.ApplyProposal(ctx, u, rows[1].ID); err != nil || p.Status != "applied" || p.MemoryID != city.ID {
		t.Fatalf("apply update = %+v, %v", p, err)
	}
	if via := auditVia(t, w.x, audit.ActionAIMemoryUpdated, city.ID); via["kind"] != "ask_uni" || via["proposal_id"] != rows[1].ID {
		t.Fatalf("updated via %v", via)
	}
	if p, err := m.ApplyProposal(ctx, u, rows[2].ID); err != nil || p.Status != "applied" {
		t.Fatalf("apply forget = %+v, %v", p, err)
	}
	if via := auditVia(t, w.x, audit.ActionAIMemoryDeleted, long.ID); via["kind"] != "ask_uni" || via["proposal_id"] != rows[2].ID {
		t.Fatalf("deleted via %v", via)
	}
	if got, want := entryBodies(t, w, u), []string{"preference:Gọi tôi là anh Vinh", "fact:Tôi làm ở Đà Nẵng"}; !slices.Equal(got, want) {
		t.Fatalf("memory = %v, want %v", got, want)
	}
	if want := []string{"applied", "applied", "applied"}; !slices.Equal(w.m.memory, want) {
		t.Fatalf("metrics %v, want %v", w.m.memory, want)
	}
}

// Two clicks of Nhớ at once save one entry; the second answers
// proposal_not_pending with the row as it now stands.
func TestApplyMemoryProposalTwiceRunsOnce(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u := w.x.ua.ID
	row := storeMemoryProposals(t, w, w.tc, rememberDraft("fact", "Tôi thích cà phê"))[0]
	type outcome struct {
		p   AskMemoryProposal
		err error
	}
	out := make([]outcome, 2)
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := m.ApplyProposal(ctx, u, row.ID)
			out[i] = outcome{p, err}
		}()
	}
	wg.Wait()
	ok, refused := 0, 0
	for _, o := range out {
		switch {
		case o.err == nil && o.p.Status == "applied":
			ok++
		case codeOf(o.err) == "proposal_not_pending" && o.p.ID == row.ID && o.p.Status == "applied":
			refused++
		default:
			t.Fatalf("outcome %+v %v", o.p, o.err)
		}
	}
	if ok != 1 || refused != 1 {
		t.Fatalf("ok %d refused %d", ok, refused)
	}
	if got := entryBodies(t, w, u); len(got) != 1 {
		t.Fatalf("memory = %v, want one entry", got)
	}
}

// Every refusal leaves the memory and the row as they were.
func TestApplyMemoryProposalRefusals(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	memEntry(t, m, u, org, "fact", "Tôi làm ở Hà Nội")
	gone := memEntry(t, m, u, org, "fact", "Tôi có một con mèo")
	outsider := memOutsider(t, w, "mem-out@example.com", "org-memout")
	rows := storeMemoryProposals(t, w, w.tc,
		updateDraft(gone, "fact", "Tôi có hai con mèo"),
		rememberDraft("preference", "Trả lời bằng tiếng Việt"))
	forget := storeMemoryProposals(t, w, w.tc, forgetDraft(gone))[0]
	if err := m.Delete(ctx, u, org, gone.ID); err != nil {
		t.Fatal(err)
	}
	remember := rows[1]
	shift := func(interval string) func() {
		return func() {
			if _, err := w.s.pool.Exec(ctx, `UPDATE ai_memory_proposals SET expires_at = expires_at + $2::interval WHERE id = $1`, remember.ID, interval); err != nil {
				t.Fatal(err)
			}
		}
	}
	cases := []struct {
		name        string
		row         db.AiMemoryProposal
		by          string
		setup, undo func()
		code        string // "" is ErrNotFound
	}{
		{"update of a deleted entry", rows[0], u, nil, nil, "ai_memory_not_found"},
		{"forget of a deleted entry", forget, u, nil, nil, "ai_memory_not_found"},
		{"switch off", remember, u, func() { _ = m.SetOn(ctx, u, false) }, func() { _ = m.SetOn(ctx, u, true) }, "ai_memory_off"},
		{"flag off", remember, u, func() { m.SetFlags(memoryFlagFake{on: false}) }, func() { m.SetFlags(memoryFlagFake{on: true}) }, "ai_memory_disabled"},
		{"expired", remember, u, shift("-25 hours"), shift("25 hours"), "proposal_expired"},
		{"a colleague", remember, w.x.ub.ID, nil, nil, ""},
		{"another organization", remember, outsider.ID, nil, nil, ""},
	}
	before := entryBodies(t, w, u)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.setup != nil {
				c.setup()
			}
			if c.undo != nil {
				defer c.undo()
			}
			p, err := m.ApplyProposal(ctx, c.by, c.row.ID)
			switch c.code {
			case "":
				if !errors.Is(err, ErrNotFound) || p.ID != "" {
					t.Fatalf("got %+v, %v; want not found and no row", p, err)
				}
			case "ai_memory_off", "proposal_expired":
				memCode(t, err, c.code)
				if want := map[string]string{"ai_memory_off": "pending", "proposal_expired": "expired"}[c.code]; p.ID != c.row.ID || p.Status != want {
					t.Fatalf("refusal carries %+v, want the row %s", p, want)
				}
			default:
				memCode(t, err, c.code)
			}
			if got := memoryRow(t, w, c.row.ID); got.Status != "pending" || got.DecidedAt.Valid {
				t.Fatalf("row = %+v", got)
			}
			if got := entryBodies(t, w, u); !slices.Equal(got, before) {
				t.Fatalf("memory = %v, want %v", got, before)
			}
		})
	}
	if !slices.Equal(w.m.memory, []string{"expired"}) {
		t.Fatalf("metrics %v, want only expired", w.m.memory)
	}
}

// Memory is not one of Ask UNI's write actions: with them off and the ceiling
// off, a memory proposal still applies.
func TestApplyMemoryProposalWithActionsOff(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	w.s.SetFlags(withActions{agentFlagFake{org: w.x.w.OrganizationID}, false})
	w.setCeiling(t, AskCeilingOff)
	scriptCalls(w.fake, "Xong.", []provider.ToolCall{toolCall("c1", "propose_memory", memRemember)})
	res := w.ask(t, ctx, AskInput{}, nil)
	if len(res.MemoryProposals) != 1 {
		t.Fatalf("memory proposals %+v", res.MemoryProposals)
	}
	if p, err := m.ApplyProposal(ctx, w.x.ua.ID, res.MemoryProposals[0].ID); err != nil || p.Status != "applied" {
		t.Fatalf("apply = %+v, %v", p, err)
	}
	if got := entryBodies(t, w, w.x.ua.ID); !slices.Equal(got, []string{"preference:Gọi tôi là anh Vinh"}) {
		t.Fatalf("memory = %v", got)
	}
}

// Auto mode applies an untainted level-1 write row and never a memory row
// (spec §5.5).
func TestMemoryProposalNeverAutoApplies(t *testing.T) {
	ctx := context.Background()
	w, _ := memDecideWorld(t)
	w.setCeiling(t, AskModeAuto)
	scriptCalls(w.fake, "Đã làm phần việc riêng.", []provider.ToolCall{
		toolCall("c1", "create_task", `{"title":"Tự làm việc A"}`),
		toolCall("c2", "propose_memory", memRemember),
	})
	res := w.ask(t, ctx, AskInput{Mode: AskModeAuto}, nil)
	rows := rowsOf(t, w, res.ConversationID)
	if len(rows) != 1 || rows[0].Status != proposalApplied || rows[0].Decision.String != AskModeAuto || rows[0].Tainted {
		t.Fatalf("write rows %+v", rows)
	}
	mem := memRows(t, w, res.Message.ID)
	if len(mem) != 1 || mem[0].Status != "pending" || mem[0].DecidedAt.Valid {
		t.Fatalf("memory rows %+v", mem)
	}
	if got := entryBodies(t, w, w.x.ua.ID); len(got) != 0 {
		t.Fatalf("memory = %v", got)
	}
}

// Approving a plan applies and rejects the answer's write rows; its memory
// rows stay pending (spec §5.5).
func TestPlanApprovalLeavesMemoryProposals(t *testing.T) {
	ctx := context.Background()
	w, _ := memDecideWorld(t)
	w.setCeiling(t, AskModePlan)
	scriptCalls(w.fake, "Kế hoạch đây.", []provider.ToolCall{
		toolCall("c1", "create_task", `{"title":"Bước một"}`),
		toolCall("c2", "create_task", `{"title":"Bước hai"}`),
		toolCall("c3", "propose_memory", memRemember),
	})
	res := w.ask(t, ctx, AskInput{Mode: AskModePlan}, nil)
	rows := rowsOf(t, w, res.ConversationID)
	if len(rows) != 2 || rows[0].Mode != AskModePlan {
		t.Fatalf("write rows %+v", rows)
	}
	ps, err := w.s.ApplyMessageProposals(ctx, w.x.ua.ID, res.ConversationID, res.Message.ID, []string{rows[0].ID})
	if err != nil || statuses(ps) != "1:applied 2:rejected" {
		t.Fatalf("plan = %s, %v", statuses(ps), err)
	}
	mem := memRows(t, w, res.Message.ID)
	if len(mem) != 1 || mem[0].Status != "pending" || mem[0].DecidedAt.Valid {
		t.Fatalf("memory rows %+v", mem)
	}
}

// Only the asker decides a memory proposal: anyone else, an organization
// owner or admin included, is told the row names nothing (R13).
func TestOnlyTheAskerDecidesAMemoryProposal(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	org := w.x.w.OrganizationID
	as := NewAuthService(w.s.pool, w.s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	admin := registerVerified(t, w.s.q, as, "mem-admin@example.com", "Admin")
	addOrgMemberRole(t, w.s.q, org, admin.ID, "admin")
	colleague := registerVerified(t, w.s.q, as, "mem-colleague@example.com", "Colleague")
	addOrgMember(t, w.s.q, org, colleague.ID)
	addWorkspaceMember(t, w.s.q, w.x.w.ID, colleague.ID)
	outsider := memOutsider(t, w, "mem-outsider@example.com", "org-memoutsider")
	asker := w.x.ub // a plain member; ua owns the organization
	tc := ai.ToolContext{ActorID: asker.ID, OrganizationID: org, WorkspaceID: w.x.w.ID}
	row := storeMemoryProposals(t, w, tc, rememberDraft("fact", "Tôi là người hỏi"))[0]
	text := "Của người khác"
	commands := map[string]func(userID string) (AskMemoryProposal, error){
		"apply":  func(u string) (AskMemoryProposal, error) { return m.ApplyProposal(ctx, u, row.ID) },
		"reject": func(u string) (AskMemoryProposal, error) { return m.RejectProposal(ctx, u, row.ID) },
		"undo":   func(u string) (AskMemoryProposal, error) { return m.UndoProposal(ctx, u, row.ID) },
		"edit":   func(u string) (AskMemoryProposal, error) { return m.EditProposal(ctx, u, row.ID, nil, &text) },
	}
	for who, u := range map[string]string{"owner": w.x.ua.ID, "admin": admin.ID, "colleague": colleague.ID, "outsider": outsider.ID} {
		for name, run := range commands {
			if p, err := run(u); !errors.Is(err, ErrNotFound) || p.ID != "" {
				t.Errorf("%s by the %s = %+v, %v; want not found", name, who, p, err)
			}
		}
	}
	got := memoryRow(t, w, row.ID)
	if got.Status != "pending" || got.Body.String != "Tôi là người hỏi" || !got.UpdatedAt.Time.Equal(row.UpdatedAt.Time) {
		t.Fatalf("row changed: %+v", got)
	}
	if n := w.x.count(t, `SELECT count(*) FROM ai_memories WHERE organization_id = $1`, org); n != 0 {
		t.Fatalf("%d entries saved", n)
	}
	if p, err := m.ApplyProposal(ctx, asker.ID, row.ID); err != nil || p.Status != "applied" {
		t.Fatalf("asker apply = %+v, %v", p, err)
	}
}

// Bỏ qua settles the row rejected with an audit row that names no text.
func TestRejectMemoryProposal(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u := w.x.ua.ID
	row := storeMemoryProposals(t, w, w.tc, rememberDraft("fact", "Mật khẩu wifi là cam-quyt-42"))[0]
	p, err := m.RejectProposal(ctx, u, row.ID)
	if err != nil || p.Status != "rejected" {
		t.Fatalf("reject = %+v, %v", p, err)
	}
	if got := memoryRow(t, w, row.ID); got.Status != "rejected" || !got.DecidedAt.Valid {
		t.Fatalf("row = %+v", got)
	}
	var meta, changes string
	if err := w.s.pool.QueryRow(ctx, `SELECT metadata, changes FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionAIMemoryProposalRejected, row.ID).Scan(&meta, &changes); err != nil {
		t.Fatal(err)
	}
	for _, word := range []string{"cam-quyt", "wifi", "Mật khẩu"} {
		if strings.Contains(meta+changes, word) {
			t.Fatalf("audit row carries %q: %s %s", word, meta, changes)
		}
	}
	if p, err := m.RejectProposal(ctx, u, row.ID); codeOf(err) != "proposal_not_pending" || p.Status != "rejected" {
		t.Fatalf("second reject = %+v, %v", p, err)
	}
	if got := entryBodies(t, w, u); len(got) != 0 {
		t.Fatalf("memory = %v", got)
	}
	// A row past its expiry is still rejected, as P3's reject allows.
	old := storeMemoryProposals(t, w, w.tc, rememberDraft("fact", "Tôi dậy lúc sáu giờ"))[0]
	if _, err := w.s.pool.Exec(ctx, `UPDATE ai_memory_proposals SET expires_at = now() - interval '1 hour' WHERE id = $1`, old.ID); err != nil {
		t.Fatal(err)
	}
	if p, err := m.RejectProposal(ctx, u, old.ID); err != nil || p.Status != "rejected" {
		t.Fatalf("reject expired = %+v, %v", p, err)
	}
	if n := w.x.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionAIMemoryProposalRejected, old.ID); n != 1 {
		t.Fatalf("%d audit rows for the expired reject", n)
	}
	if !slices.Equal(w.m.memory, []string{"rejected", "rejected"}) {
		t.Fatalf("metrics %v", w.m.memory)
	}
}

// An asker who left the workspace no longer decides their rows: the workspace
// gate refuses every command and the row stays as it was (R13).
func TestMemoryProposalNeedsTheWorkspace(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	asker := w.x.ub
	tc := ai.ToolContext{ActorID: asker.ID, OrganizationID: w.x.w.OrganizationID, WorkspaceID: w.x.w.ID}
	row := storeMemoryProposals(t, w, tc, rememberDraft("fact", "Tôi ở nhóm thiết kế"))[0]
	if _, err := w.s.pool.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.x.w.ID, asker.ID); err != nil {
		t.Fatal(err)
	}
	text := "Tôi ở nhóm khác"
	for name, run := range map[string]func() (AskMemoryProposal, error){
		"apply":  func() (AskMemoryProposal, error) { return m.ApplyProposal(ctx, asker.ID, row.ID) },
		"reject": func() (AskMemoryProposal, error) { return m.RejectProposal(ctx, asker.ID, row.ID) },
		"undo":   func() (AskMemoryProposal, error) { return m.UndoProposal(ctx, asker.ID, row.ID) },
		"edit":   func() (AskMemoryProposal, error) { return m.EditProposal(ctx, asker.ID, row.ID, nil, &text) },
	} {
		if p, err := run(); !errors.Is(err, ErrForbidden) || p.ID != "" {
			t.Errorf("%s = %+v, %v; want forbidden and no row", name, p, err)
		}
	}
	if got := memoryRow(t, w, row.ID); got.Status != "pending" || got.Body.String != "Tôi ở nhóm thiết kế" || !got.UpdatedAt.Time.Equal(row.UpdatedAt.Time) {
		t.Fatalf("row changed: %+v", got)
	}
}

// Sửa changes a pending row's kind and text, checked as new input, and writes
// no audit row; apply then saves the edited text.
func TestEditMemoryProposal(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	pet := memEntry(t, m, u, org, "fact", "Tôi có một con mèo")
	rows := storeMemoryProposals(t, w, w.tc,
		rememberDraft("preference", "Gọi tôi là anh Vinh"),
		rememberDraft("fact", "Tôi ở Huế"),
		forgetDraft(pet))
	audits := w.x.count(t, `SELECT count(*) FROM audit_events`)
	kind, text := "fact", "  Gọi tôi là Vinh  "
	p, err := m.EditProposal(ctx, u, rows[0].ID, &kind, &text)
	if err != nil || p.Status != "pending" || p.Kind != "fact" || p.Text != "Gọi tôi là Vinh" {
		t.Fatalf("edit = %+v, %v", p, err)
	}
	if n := w.x.count(t, `SELECT count(*) FROM audit_events`); n != audits {
		t.Fatalf("edit wrote %d audit rows", n-audits)
	}
	if p, err := m.ApplyProposal(ctx, u, rows[0].ID); err != nil || p.Text != "Gọi tôi là Vinh" {
		t.Fatalf("apply = %+v, %v", p, err)
	}
	if got, want := entryBodies(t, w, u), []string{"fact:Tôi có một con mèo", "fact:Gọi tôi là Vinh"}; !slices.Equal(got, want) {
		t.Fatalf("memory = %v, want %v", got, want)
	}
	if p, err := m.EditProposal(ctx, u, rows[0].ID, nil, &text); codeOf(err) != "proposal_not_pending" || p.Status != "applied" {
		t.Fatalf("edit applied = %+v, %v", p, err)
	}
	long := strings.Repeat("a", 301)
	var invalid ValidationError
	if _, err := m.EditProposal(ctx, u, rows[1].ID, nil, &long); !errors.As(err, &invalid) {
		t.Fatalf("301 runes = %v, want 400", err)
	}
	if _, err := m.EditProposal(ctx, u, rows[2].ID, nil, &text); !errors.As(err, &invalid) {
		t.Fatalf("edit of a forget = %v, want 400", err)
	}
	if got := memoryRow(t, w, rows[1].ID); got.Body.String != "Tôi ở Huế" || got.Status != "pending" {
		t.Fatalf("refused edit changed the row: %+v", got)
	}
}

// Hoàn tác runs the inverse of an applied row once, unless the entry changed
// since it was applied.
func TestUndoMemoryProposal(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	city := memEntry(t, m, u, org, "fact", "Tôi làm ở Hà Nội")
	emoji := memEntry(t, m, u, org, "preference", "Không dùng emoji")
	rows := storeMemoryProposals(t, w, w.tc,
		rememberDraft("fact", "Tôi thích trà"),
		updateDraft(city, "fact", "Tôi làm ở Đà Nẵng"),
		forgetDraft(emoji))
	for _, r := range rows {
		if _, err := m.ApplyProposal(ctx, u, r.ID); err != nil {
			t.Fatal(err)
		}
	}
	made := memoryRow(t, w, rows[0].ID).MemoryID.String
	for _, r := range rows {
		if p, err := m.UndoProposal(ctx, u, r.ID); err != nil || p.Status != "undone" {
			t.Fatalf("undo %s = %+v, %v", r.Action, p, err)
		}
	}
	if got, want := entryBodies(t, w, u), []string{"preference:Không dùng emoji", "fact:Tôi làm ở Hà Nội"}; !slices.Equal(got, want) {
		t.Fatalf("memory = %v, want %v", got, want)
	}
	if via := auditVia(t, w.x, audit.ActionAIMemoryDeleted, made); via["kind"] != "ask_uni" || via["proposal_id"] != rows[0].ID {
		t.Fatalf("undo via %v", via)
	}
	if p, err := m.UndoProposal(ctx, u, rows[0].ID); codeOf(err) != "proposal_not_pending" || p.Status != "undone" {
		t.Fatalf("second undo = %+v, %v", p, err)
	}

	again := storeMemoryProposals(t, w, w.tc, rememberDraft("fact", "Tôi đi làm bằng xe buýt"))[0]
	p, err := m.ApplyProposal(ctx, u, again.ID)
	if err != nil {
		t.Fatal(err)
	}
	bike := "Tôi đi làm bằng xe đạp"
	if _, err := m.Update(ctx, u, org, p.MemoryID, nil, &bike); err != nil {
		t.Fatal(err)
	}
	p, err = m.UndoProposal(ctx, u, again.ID)
	memCode(t, err, "undo_unavailable")
	if p.Status != "applied" || memoryRow(t, w, again.ID).Status != "applied" {
		t.Fatalf("refused undo = %+v", p)
	}
	if got := entryBodies(t, w, u); !slices.Contains(got, "fact:"+bike) {
		t.Fatalf("memory = %v", got)
	}
	if n := strings.Count(strings.Join(w.m.memory, ","), "undone"); n != 3 {
		t.Fatalf("metrics %v, want three undone", w.m.memory)
	}
}

// A manual delete, which takes no owner lock, that commits between undo's
// guard and its inverse reads as undo_unavailable with the row.
func TestUndoMemoryProposalLosesARaceToADelete(t *testing.T) {
	ctx := context.Background()
	w, m := memDecideWorld(t)
	u := w.x.ua.ID
	row := storeMemoryProposals(t, w, w.tc, rememberDraft("fact", "Tôi thích mưa"))[0]
	p, err := m.ApplyProposal(ctx, u, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	// An open transaction deletes the entry and holds its row lock: undo's
	// guard still reads the entry, and its own delete waits for this commit.
	tx, err := w.s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM ai_memories WHERE id = $1`, p.MemoryID); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		p   AskMemoryProposal
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		p, err := m.UndoProposal(ctx, u, row.ID)
		done <- outcome{p, err}
	}()
	for start := time.Now(); w.x.count(t, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`) == 0; {
		if time.Since(start) > 5*time.Second {
			t.Fatal("undo never waited on the deleted entry")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	o := <-done
	memCode(t, o.err, "undo_unavailable")
	if o.p.ID != row.ID || o.p.Status != "applied" || memoryRow(t, w, row.ID).Status != "applied" {
		t.Fatalf("refused undo = %+v", o.p)
	}
}
