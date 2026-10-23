package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// proposalWorld is the write world with Ask UNI's actions on: the flag on, the
// ceiling at its default (plan) and the asker, ua, in ask mode.
func proposalWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, ai.ToolContext) {
	t.Helper()
	x, s, tc := askWriteWorld(t)
	s.SetFlags(actionsFlagFake{on: true})
	return x, s, tc
}

// askAnswer stores a conversation of tc's asker titled "Báo cáo quý" with one
// answer, and returns their ids.
func askAnswer(t *testing.T, s *AskUNIService, tc ai.ToolContext, answer string, cites []AskCitation) (convID, msgID string) {
	t.Helper()
	ctx := context.Background()
	conv, err := s.q.AiCreateConversation(ctx, db.AiCreateConversationParams{
		ID: util.NewID(), OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID, UserID: tc.ActorID, Title: "Báo cáo quý",
	})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.q.AiInsertMessage(ctx, db.AiInsertMessageParams{
		ID: util.NewID(), OrganizationID: tc.OrganizationID, ConversationID: conv.ID, Role: "assistant", Content: answer,
		Citations: jsonOrEmptyList(cites), Steps: "[]", Followups: "[]", Mentions: "[]", FileNotes: "[]",
	})
	if err != nil {
		t.Fatal(err)
	}
	return conv.ID, msg.ID
}

// propose stores rows as the asker's pending proposals of one answer, from
// position 1, the way the agent loop does.
func propose(t *testing.T, s *AskUNIService, tc ai.ToolContext, convID, msgID, mode string, rows ...askDraftRow) []db.AgentActionProposal {
	t.Helper()
	out := []db.AgentActionProposal{}
	runID := util.NewID()
	for i, r := range rows {
		p, err := askProposalParams(tc, convID, msgID, runID, i+1, r, mode, false, s.now())
		if err != nil {
			t.Fatal(err)
		}
		row, err := s.q.AiInsertProposal(context.Background(), p)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return out
}

func proposalRow(t *testing.T, s *AskUNIService, id string) db.AgentActionProposal {
	t.Helper()
	row, err := s.q.AiGetProposal(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func rawJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// auditVia is the metadata.via of the one audit row action wrote for resourceID.
func auditVia(t *testing.T, x *mcpToolWorld, action, resourceID string) map[string]any {
	t.Helper()
	var raw string
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT metadata::jsonb->>'via' FROM audit_events WHERE action = $1 AND resource_id = $2`, action, resourceID).Scan(&raw); err != nil {
		t.Fatalf("%s of %s: %v", action, resourceID, err)
	}
	var via map[string]any
	if err := json.Unmarshal([]byte(raw), &via); err != nil {
		t.Fatal(err)
	}
	return via
}

func proposalAudits(t *testing.T, x *mcpToolWorld, action, proposalID string) int {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND metadata::jsonb->>'proposal_id' = $2`, action, proposalID)
}

// Two clicks of Áp dụng at once run the command once (R13).
func TestApplyProposalRunsTheCommandOnce(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "Đã chuẩn bị.", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Việc chỉ một lần"}`))[0]

	type outcome struct {
		p   AskProposal
		err error
	}
	start, done := make(chan struct{}), make(chan outcome, 2)
	for range 2 {
		go func() {
			<-start
			p, err := s.ApplyProposal(ctx, x.ua.ID, row.ID)
			done <- outcome{p, err}
		}()
	}
	close(start)
	applied, refused := 0, 0
	for range 2 {
		o := <-done
		switch {
		case o.err == nil && o.p.Status == "applied":
			applied++
		case codeOf(o.err) == "proposal_not_pending":
			refused++
		default:
			t.Errorf("an apply came back %+v, %v", o.p, o.err)
		}
	}
	if applied != 1 || refused != 1 {
		t.Fatalf("applied %d, refused %d; want one of each", applied, refused)
	}
	if n := x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = $2`, x.w.ID, "Việc chỉ một lần"); n != 1 {
		t.Fatalf("%d tasks created, want 1", n)
	}
	got := askProposalOf(proposalRow(t, s, row.ID), time.Now())
	if got.Status != "applied" || got.Decision != "confirmed" || !got.CanUndo || got.Result.ObjectID == "" || proposalRow(t, s, row.ID).DecidedBy.String != x.ua.ID {
		t.Fatalf("row = %+v", got)
	}
	if n := proposalAudits(t, x, "ai_proposal.applied", row.ID); n != 1 {
		t.Fatalf("%d ai_proposal.applied rows, want 1", n)
	}
	via := auditVia(t, x, "task.created", got.Result.ObjectID)
	if len(via) != 2 || via["kind"] != "ask_uni" || via["proposal_id"] != row.ID {
		t.Fatalf("task.created via = %v, want {kind: ask_uni, proposal_id: %s}", via, row.ID)
	}
}

// Every refusal leaves the row pending and the business tables as they were;
// a target that changed since the proposal fails the row, writing nothing.
func TestApplyProposalRefusals(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	tasks := func() int { return x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, x.w.ID) }
	before := tasks()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Không được tạo"}`))[0]
	refused := func(name, userID string, want func(error) bool) {
		t.Helper()
		if _, err := s.ApplyProposal(ctx, userID, row.ID); !want(err) {
			t.Errorf("%s: err = %v", name, err)
		}
		if got := proposalRow(t, s, row.ID); got.Status != "pending" {
			t.Errorf("%s: row %s, want pending", name, got.Status)
		}
		if n := tasks(); n != before {
			t.Errorf("%s: %d tasks, want %d", name, n, before)
		}
	}
	code := func(c string) func(error) bool { return func(err error) bool { return codeOf(err) == c } }
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	ceiling := func(v string) {
		t.Helper()
		if err := s.q.SetOrganizationAskWriteCeiling(ctx, db.SetOrganizationAskWriteCeilingParams{Ceiling: v, ActorID: x.ua.ID, ID: x.w.OrganizationID}); err != nil {
			t.Fatal(err)
		}
	}

	notFound := func(err error) bool { return errors.Is(err, ErrNotFound) }
	refused("someone else in the organization", x.ub.ID, notFound)

	exec(`UPDATE agent_action_proposals SET source = 'agent_run' WHERE id = $1`, row.ID)
	refused("a row an agent run proposed", x.ua.ID, notFound)
	exec(`UPDATE agent_action_proposals SET source = 'ask_uni' WHERE id = $1`, row.ID)

	exec(`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, x.w.OrganizationID, x.ua.ID)
	refused("the asker deactivated", x.ua.ID, code("member_deactivated"))
	exec(`UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`, x.w.OrganizationID, x.ua.ID)

	ceiling(AskCeilingOff)
	refused("the ceiling lowered to off", x.ua.ID, code("ai_actions_disabled"))
	ceiling(AskModePlan)

	s.SetFlags(actionsFlagFake{on: false})
	refused("the flag off", x.ua.ID, code("ai_actions_disabled"))
	s.SetFlags(actionsFlagFake{on: true})

	exec(`UPDATE agent_action_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, row.ID)
	refused("past 24 hours", x.ua.ID, code("proposal_expired"))
	if got := askProposalOf(proposalRow(t, s, row.ID), time.Now()); got.Status != "expired" {
		t.Errorf("an expired row reads %s", got.Status)
	}

	// The task changed after the proposal read it: the row fails and the task
	// keeps the other person's change only.
	convID, msgID = askAnswer(t, s, tc, "x", nil)
	upd := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, x.taskID)))[0]
	title := "Đổi bởi B"
	if _, err := s.tasks.Update(ctx, Human(x.ub.ID), x.taskID, UpdateTaskInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	p, err := s.ApplyProposal(ctx, x.ua.ID, upd.ID)
	if codeOf(err) != "revision_conflict" || p.Status != "failed" || p.ErrorCode != "revision_conflict" || p.CanUndo {
		t.Fatalf("stale target: %+v, %v; want a failed row with revision_conflict", p, err)
	}
	if got := proposalRow(t, s, upd.ID); got.Status != "failed" || got.Error.String != "revision_conflict" || got.DecidedBy.String != x.ua.ID {
		t.Fatalf("stale target row: %+v", got)
	}
	task, err := s.tasks.Get(ctx, x.ua.ID, x.taskID)
	if err != nil || task.Status != "todo" || task.Title != title || tasks() != before {
		t.Fatalf("task after the failed row: %s %q, %d tasks, %v", task.Status, task.Title, tasks(), err)
	}
	if n := proposalAudits(t, x, "ai_proposal.applied", upd.ID); n != 0 {
		t.Fatalf("a failed row wrote %d ai_proposal.applied rows", n)
	}
}

// A plan runs its rows in order and stops at the first that fails; in plan
// mode the rows left out are rejected in the same call (R13).
// proposePlan stores a plan-mode answer: row 1 creates the project, row 2 a
// task in it ({{row:1.id}}), row 3 a task of its own.
func proposePlan(t *testing.T, s *AskUNIService, tc ai.ToolContext, project string) (string, string, []db.AgentActionProposal) {
	t.Helper()
	convID, msgID := askAnswer(t, s, tc, "Kế hoạch", nil)
	p := askPrepare(t, s, tc, "create_project", fmt.Sprintf(`{"title":%q}`, project))
	task := askPrepare(t, s, tc, "create_task", `{"title":"Việc trong dự án","project_id":"{{row:1.id}}"}`, p)
	other := askPrepare(t, s, tc, "create_task", `{"title":"Việc không chọn"}`)
	return convID, msgID, propose(t, s, tc, convID, msgID, AskModePlan, p, task, other)
}

func statuses(ps []AskProposal) string {
	var out []string
	for _, p := range ps {
		out = append(out, fmt.Sprintf("%d:%s", p.Position, p.Status))
	}
	return strings.Join(out, " ")
}

func TestApplyPlanStopsAtTheFirstFailure(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	plan := func(project string) (string, string, []db.AgentActionProposal) {
		t.Helper()
		return proposePlan(t, s, tc, project)
	}
	titled := func(title string) int {
		return x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = $2`, x.w.ID, title)
	}

	convID, msgID, rows := plan("Dự án trùng")
	// The task row waits for the project its {{row:1.id}} names.
	if _, err := s.ApplyProposal(ctx, x.ua.ID, rows[1].ID); codeOf(err) != "proposal_ref_pending" {
		t.Fatalf("the task row first: %v, want proposal_ref_pending", err)
	}
	if got := proposalRow(t, s, rows[1].ID); got.Status != "pending" {
		t.Fatalf("the task row after proposal_ref_pending: %s", got.Status)
	}
	// Someone takes the title before the plan is approved.
	if _, err := s.tasks.CreateProject(ctx, Human(x.ub.ID), x.w.ID, CreateProjectInput{Title: "Dự án trùng"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ApplyMessageProposals(ctx, x.ua.ID, convID, msgID, []string{rows[1].ID, rows[0].ID})
	if codeOf(err) != "duplicate_project_title" || statuses(got) != "1:failed 2:pending 3:rejected" {
		t.Fatalf("plan with a taken title: %s, %v", statuses(got), err)
	}
	if titled("Việc trong dự án") != 0 || titled("Việc không chọn") != 0 {
		t.Fatal("a row after the failure, or one left out, wrote a task")
	}
	if r := proposalRow(t, s, rows[2].ID); r.Decision.String != "plan" || r.DecidedBy.String != x.ua.ID || proposalAudits(t, x, "ai_proposal.rejected", rows[2].ID) != 1 {
		t.Fatalf("the row left out: %+v", r)
	}

	convID, msgID, rows = plan("Dự án mới")
	got, err = s.ApplyMessageProposals(ctx, x.ua.ID, convID, msgID, []string{rows[0].ID, rows[1].ID})
	if err != nil || statuses(got) != "1:applied 2:applied 3:rejected" || got[0].Decision != "plan" || got[1].Decision != "plan" {
		t.Fatalf("plan: %s, %v", statuses(got), err)
	}
	task, err := s.tasks.Get(ctx, x.ua.ID, got[1].Result.ObjectID)
	if err != nil || task.ProjectID.String != got[0].Result.ObjectID {
		t.Fatalf("the task is in project %q, want the new one %q (%v)", task.ProjectID.String, got[0].Result.ObjectID, err)
	}
	// The stored row keeps the reference; only the run used the real id.
	if !strings.Contains(proposalRow(t, s, rows[1].ID).Payload, "{{row:1.id}}") {
		t.Fatal("the stored payload lost its {{row:1.id}}")
	}
	// An id of another answer is not this answer's to apply.
	_, otherMsg, others := plan("Dự án khác")
	if _, err := s.ApplyMessageProposals(ctx, x.ua.ID, convID, msgID, []string{others[0].ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a row of answer %s through answer %s: %v, want ErrNotFound", otherMsg, msgID, err)
	}
}

// A row left applying by a crash reads unknown after two minutes, and nothing
// runs it again (R3).
func TestStuckApplyReadsUnknown(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Kẹt"}`))[0]
	if _, err := s.pool.Exec(ctx, `UPDATE agent_action_proposals SET status = 'applying', updated_at = now() - interval '3 minutes' WHERE id = $1`, row.ID); err != nil {
		t.Fatal(err)
	}
	m, err := s.MessageProposals(ctx, tc.OrganizationID, []string{msgID})
	if err != nil || len(m[msgID]) != 1 || m[msgID][0].Status != "unknown" {
		t.Fatalf("stuck row reads %+v, %v; want unknown", m, err)
	}
	fresh := proposalRow(t, s, row.ID)
	if got := askProposalOf(fresh, fresh.UpdatedAt.Time.Add(time.Minute)).Status; got != "applying" {
		t.Fatalf("a row applying for a minute reads %s", got)
	}
	if _, err := s.ApplyProposal(ctx, x.ua.ID, row.ID); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("apply of a stuck row: %v, want proposal_not_pending", err)
	}
	if n := x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = 'Kẹt'`, x.w.ID); n != 0 {
		t.Fatalf("%d tasks from a stuck row", n)
	}
}

// An edit runs the tool's checks again on the merged arguments; a refused edit
// leaves the row as it was (R13).
func TestEditProposalRevalidates(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Tên cũ"}`))[0]

	p, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"title": rawJSON("Tên mới")})
	if err != nil || p.Status != "pending" || p.Preview.Target.Title != "Tên mới" || p.Level != askLevel1 {
		t.Fatalf("title edit: %+v, %v", p, err)
	}
	if got := proposalRow(t, s, row.ID); !strings.Contains(got.Payload, "Tên mới") {
		t.Fatalf("payload after the edit: %s", got.Payload)
	}
	// An edit can change the level: someone else as the assignee asks first.
	if p, err = s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"assignee_id": rawJSON(x.ub.ID)}); err != nil || p.Level != askLevel2 {
		t.Fatalf("assignee edit: %+v, %v", p, err)
	}

	before := proposalRow(t, s, row.ID)
	uc := registerVerified(t, s.q, NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "edit-c@example.com", "C")
	if _, err := s.orgs.Create(ctx, uc.ID, "Org C", "org-edit-c"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"assignee_id": rawJSON(uc.ID)}); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("assignee from another organization: %v, want McpInvalidArgs", err)
	}
	if _, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"bogus": rawJSON(1)}); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("unknown field: %v, want McpInvalidArgs", err)
	}
	if _, err := s.EditProposal(ctx, x.ub.ID, row.ID, map[string]json.RawMessage{"title": rawJSON("của B")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's edit: %v, want ErrNotFound", err)
	}
	after := proposalRow(t, s, row.ID)
	if after.Payload != before.Payload || after.Preview != before.Preview || after.RiskLevel != before.RiskLevel || !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
		t.Fatalf("a refused edit changed the row:\n%+v\n%+v", before, after)
	}

	r, err := s.RejectProposal(ctx, x.ua.ID, row.ID)
	if err != nil || r.Status != "rejected" || proposalAudits(t, x, "ai_proposal.rejected", row.ID) != 1 {
		t.Fatalf("reject: %+v, %v", r, err)
	}
	if _, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"title": rawJSON("muộn")}); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("edit of a rejected row: %v, want proposal_not_pending", err)
	}
	if _, err := s.RejectProposal(ctx, x.ua.ID, row.ID); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("second reject: %v, want proposal_not_pending", err)
	}
}

// Undo runs once, as the asker and through the proposal; a target someone
// changed since keeps the row applied (R14).
func TestUndoProposal(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Sẽ hoàn tác"}`))[0]
	p, err := s.ApplyProposal(ctx, x.ua.ID, row.ID)
	if err != nil || !p.CanUndo {
		t.Fatalf("apply: %+v, %v", p, err)
	}
	if _, err := s.UndoProposal(ctx, x.ub.ID, row.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's undo: %v, want ErrNotFound", err)
	}
	u, err := s.UndoProposal(ctx, x.ua.ID, row.ID)
	if err != nil || u.Status != "undone" || u.CanUndo {
		t.Fatalf("undo: %+v, %v", u, err)
	}
	if _, err := s.reads.GetTask(ctx, principalOf(tc), x.w.ID, p.Result.ObjectID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the task after undo: %v, want not found", err)
	}
	if got := proposalRow(t, s, row.ID); got.UndoneBy.String != x.ua.ID || proposalAudits(t, x, "ai_proposal.undone", row.ID) != 1 {
		t.Fatalf("undone row: %+v", got)
	}
	if _, err := s.UndoProposal(ctx, x.ua.ID, row.ID); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("second undo: %v, want proposal_not_pending", err)
	}
	if _, err := s.ApplyProposal(ctx, x.ua.ID, row.ID); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("apply after undo: %v, want proposal_not_pending", err)
	}

	convID, msgID = askAnswer(t, s, tc, "x", nil)
	upd := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, x.taskID)))[0]
	if _, err := s.ApplyProposal(ctx, x.ua.ID, upd.ID); err != nil {
		t.Fatal(err)
	}
	title := "B sửa sau"
	if _, err := s.tasks.Update(ctx, Human(x.ub.ID), x.taskID, UpdateTaskInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UndoProposal(ctx, x.ua.ID, upd.ID); codeOf(err) != "undo_unavailable" {
		t.Fatalf("undo after another's edit: %v, want undo_unavailable", err)
	}
	got := askProposalOf(proposalRow(t, s, upd.ID), time.Now())
	task, _ := s.tasks.Get(ctx, x.ua.ID, x.taskID)
	if got.Status != "applied" || got.ErrorCode != "undo_unavailable" || task.Status != "done" || proposalRow(t, s, upd.ID).UndoneBy.Valid {
		t.Fatalf("after a refused undo: row %+v, task %s", got, task.Status)
	}
	if proposalAudits(t, x, "ai_proposal.undone", upd.ID) != 0 {
		t.Fatal("a refused undo wrote ai_proposal.undone")
	}
}

// Tạo tài liệu writes the answer as the asker's private page, its [S#] made
// internal links, once per answer (R16).
func TestSaveAnswerAsDocument(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	s.SetDocuments(x.docs(t))
	href := "/org-alpha/alpha/tasks/" + x.taskID
	convID, msgID := askAnswer(t, s, tc, "Việc chính là [S1], còn [S7] thì không có.", []AskCitation{
		{SourceID: "S1", Kind: "task", Title: "Chuẩn bị báo cáo quý", Href: href, ObjectID: x.taskID},
	})
	p, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convID, msgID)
	if err != nil || p.Status != "applied" || p.Decision != "answer" || p.Tool != "create_document" || !p.CanUndo || p.MessageID != msgID {
		t.Fatalf("save: %+v, %v", p, err)
	}
	doc := x.docRow(t, p.Result.ObjectID)
	md := x.pageMarkdown(t, doc.ID)
	if doc.Title != "Báo cáo quý" || doc.Visibility != documentVisibilityRestricted || doc.ParentID.Valid {
		t.Fatalf("document %q, visibility %s, parent %v", doc.Title, doc.Visibility, doc.ParentID)
	}
	if !strings.Contains(md, "[Chuẩn bị báo cáo quý]("+href+")") || strings.Contains(md, "[S") {
		t.Fatalf("markdown = %q", md)
	}
	via := auditVia(t, x, "document.created", doc.ID)
	if via["proposal_id"] != p.ID {
		t.Fatalf("document.created via = %v", via)
	}
	pages := x.docRows(t)
	again, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convID, msgID)
	if err != nil || again.ID != p.ID || x.docRows(t) != pages {
		t.Fatalf("second save: %+v, %v, %d pages (was %d)", again, err, x.docRows(t), pages)
	}

	tcB := ai.ToolContext{ActorID: x.ub.ID, OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID}
	convB, msgB := askAnswer(t, s, tcB, "của B", nil)
	if _, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convB, msgB); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another's answer: %v, want ErrNotFound", err)
	}
	if _, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convID, msgB); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another's answer under my conversation: %v, want ErrNotFound", err)
	}
	if x.docRows(t) != pages {
		t.Fatal("a refused save wrote a page")
	}
}

// A plan whose chosen row needs a row neither chosen nor applied, or one that
// chooses nothing, is refused before anything runs or is rejected.
func TestApplyPlanRefusesBeforeRunning(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID, rows := proposePlan(t, s, tc, "Dự án phụ thuộc")
	still := func(name string) {
		t.Helper()
		m, err := s.MessageProposals(ctx, tc.OrganizationID, []string{msgID})
		if err != nil || statuses(m[msgID]) != "1:pending 2:pending 3:pending" {
			t.Fatalf("%s: rows %s, %v", name, statuses(m[msgID]), err)
		}
		if n := x.count(t, `SELECT count(*) FROM audit_events WHERE action LIKE 'ai_proposal.%'`); n != 0 {
			t.Fatalf("%s: %d ai_proposal audit rows", name, n)
		}
	}
	if _, err := s.ApplyMessageProposals(ctx, x.ua.ID, convID, msgID, []string{rows[1].ID}); codeOf(err) != "proposal_ref_pending" {
		t.Fatalf("the task without its project: %v, want proposal_ref_pending", err)
	}
	still("a missing dependency")
	if _, err := s.ApplyMessageProposals(ctx, x.ua.ID, convID, msgID, nil); !errors.As(err, new(ValidationError)) {
		t.Fatalf("no rows chosen: %v, want a validation error", err)
	}
	still("nothing chosen")
}

// The claim is pinned to the row as read: an edit in between means the run
// does not happen, so no command runs arguments the card no longer shows.
func TestApplyClaimPinsTheRowAsRead(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Tên đã đọc"}`))[0]
	titled := func(title string) int {
		return x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = $2`, x.w.ID, title)
	}
	stale := proposalRow(t, s, row.ID)
	if _, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{"title": rawJSON("Tên đã sửa")}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.applyRow(ctx, x.ua.ID, stale, "confirmed"); codeOf(err) != "proposal_not_pending" {
		t.Fatalf("apply of the row as read before the edit: %v, want proposal_not_pending", err)
	}
	if got := proposalRow(t, s, row.ID); got.Status != "pending" || !strings.Contains(got.Payload, "Tên đã sửa") || titled("Tên đã đọc")+titled("Tên đã sửa") != 0 {
		t.Fatalf("after the refused claim: %s %s, %d tasks", got.Status, got.Payload, titled("Tên đã đọc")+titled("Tên đã sửa"))
	}
	if _, err := s.ApplyProposal(ctx, x.ua.ID, row.ID); err != nil || titled("Tên đã sửa") != 1 {
		t.Fatalf("apply of the edited row: %v, %d tasks", err, titled("Tên đã sửa"))
	}
}

func claimAs(t *testing.T, s *AskUNIService, row db.AgentActionProposal, from, to string) db.AgentActionProposal {
	t.Helper()
	got, err := s.q.AiClaimProposal(context.Background(), db.AiClaimProposalParams{ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: from, ToStatus: to})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// A command that runs out of time still settles its row: failed for an apply,
// back to applied for an undo. Neither is left applying or undoing.
func TestClaimedRowSettlesAfterItsDeadline(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	rows := propose(t, s, tc, convID, msgID, AskModeAsk,
		askPrepare(t, s, tc, "create_task", `{"title":"Hết giờ"}`), askPrepare(t, s, tc, "create_task", `{"title":"Hoàn tác hết giờ"}`))
	wait := func(ctx context.Context, _ McpPrincipal, _ askDraftRow) (AskProposalResult, *askInverse, error) {
		<-ctx.Done()
		return AskProposalResult{}, nil, ctx.Err()
	}
	claimed := claimAs(t, s, rows[0], "pending", "applying")
	p, err := s.runClaimed(ctx, x.ua.ID, claimed, "confirmed", draftOfRow(claimed), wait, 20*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) || p.Status != "failed" || p.ErrorCode != askApplyFailed || proposalRow(t, s, rows[0].ID).Status != "failed" {
		t.Fatalf("apply past its deadline: %+v, %v; want a failed row", p, err)
	}

	if _, err := s.ApplyProposal(ctx, x.ua.ID, rows[1].ID); err != nil {
		t.Fatal(err)
	}
	undoing := claimAs(t, s, proposalRow(t, s, rows[1].ID), "applied", "undoing")
	u, err := s.finishUndo(ctx, x.ua.ID, undoing, func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }, 20*time.Millisecond)
	if got := proposalRow(t, s, rows[1].ID); !errors.Is(err, context.DeadlineExceeded) || u.Status != "applied" || got.Status != "applied" || got.UndoneBy.Valid {
		t.Fatalf("undo past its deadline: %+v, %v; row %s", u, err, got.Status)
	}
}

// A command that panics is caught: the row stays claimed (it reads unknown
// later) and the caller gets an error, not a dead process.
func TestProposalCommandPanicIsCaught(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	rows := propose(t, s, tc, convID, msgID, AskModeAsk,
		askPrepare(t, s, tc, "create_task", `{"title":"Hoảng"}`), askPrepare(t, s, tc, "create_task", `{"title":"Hoảng khi hoàn tác"}`))
	boom := func(context.Context, McpPrincipal, askDraftRow) (AskProposalResult, *askInverse, error) {
		panic("boom")
	}
	claimed := claimAs(t, s, rows[0], "pending", "applying")
	if _, err := s.runClaimed(ctx, x.ua.ID, claimed, "confirmed", draftOfRow(claimed), boom, time.Second); !errors.Is(err, errAskPanicked) {
		t.Fatalf("apply that panics: %v, want errAskPanicked", err)
	}
	got := proposalRow(t, s, rows[0].ID)
	if got.Status != "applying" || askProposalOf(got, time.Now().Add(3*time.Minute)).Status != "unknown" {
		t.Fatalf("a panicked apply left the row %s", got.Status)
	}

	if _, err := s.ApplyProposal(ctx, x.ua.ID, rows[1].ID); err != nil {
		t.Fatal(err)
	}
	undoing := claimAs(t, s, proposalRow(t, s, rows[1].ID), "applied", "undoing")
	if _, err := s.finishUndo(ctx, x.ua.ID, undoing, func(context.Context) error { panic("boom") }, time.Second); !errors.Is(err, errAskPanicked) {
		t.Fatalf("undo that panics: %v, want errAskPanicked", err)
	}
	if got := proposalRow(t, s, rows[1].ID); got.Status != "undoing" {
		t.Fatalf("a panicked undo left the row %s", got.Status)
	}
}

// Only the id fields a tool declares take a row's id; a title that reads
// {{row:9.id}} is text. A comment is audited under its task with its id in
// the metadata, also when the task was a row of the same answer.
func TestRowRefsOnlyInIDFields(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	for _, tool := range s.askWriteTools() {
		if _, ok := askIDFields[tool.Name]; !ok {
			t.Errorf("write tool %s declares no id fields", tool.Name)
		}
	}
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	created := askPrepare(t, s, tc, "create_task", `{"title":"{{row:9.id}}"}`)
	comment := askPrepare(t, s, tc, "add_comment", `{"task_id":"{{row:1.id}}","body":"chào"}`, created)
	rows := propose(t, s, tc, convID, msgID, AskModeAsk, created, comment)
	task, err := s.ApplyProposal(ctx, x.ua.ID, rows[0].ID)
	if err != nil || x.count(t, `SELECT count(*) FROM tasks WHERE id = $1 AND title = '{{row:9.id}}'`, task.Result.ObjectID) != 1 {
		t.Fatalf("a title that reads like a reference: %+v, %v", task, err)
	}
	c, err := s.ApplyProposal(ctx, x.ua.ID, rows[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	var kind, id, commentID string
	if err := s.pool.QueryRow(ctx, `SELECT resource_type, resource_id, metadata::jsonb->>'comment_id' FROM audit_events WHERE action = 'ai_proposal.applied' AND metadata::jsonb->>'proposal_id' = $1`, rows[1].ID).Scan(&kind, &id, &commentID); err != nil {
		t.Fatal(err)
	}
	if kind != "task" || id != task.Result.ObjectID || commentID != c.Result.ObjectID {
		t.Fatalf("comment audited as %s %s comment %s; want task %s comment %s", kind, id, commentID, task.Result.ObjectID, c.Result.ObjectID)
	}
}

// Bỏ qua, Sửa and Hoàn tác stop with the flag off or the ceiling off, like
// Áp dụng; the rows stay as they were.
func TestDecisionsNeedAnOpenGate(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	rows := propose(t, s, tc, convID, msgID, AskModeAsk,
		askPrepare(t, s, tc, "create_task", `{"title":"Chờ"}`), askPrepare(t, s, tc, "create_task", `{"title":"Đã áp dụng"}`))
	if _, err := s.ApplyProposal(ctx, x.ua.ID, rows[1].ID); err != nil {
		t.Fatal(err)
	}
	pending, applied := proposalRow(t, s, rows[0].ID), proposalRow(t, s, rows[1].ID)
	ceiling := func(v string) {
		t.Helper()
		if err := s.q.SetOrganizationAskWriteCeiling(ctx, db.SetOrganizationAskWriteCeilingParams{Ceiling: v, ActorID: x.ua.ID, ID: x.w.OrganizationID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []struct {
		name       string
		shut, open func()
	}{
		{"flag off", func() { s.SetFlags(actionsFlagFake{on: false}) }, func() { s.SetFlags(actionsFlagFake{on: true}) }},
		{"ceiling off", func() { ceiling(AskCeilingOff) }, func() { ceiling(AskModePlan) }},
	} {
		c.shut()
		if _, err := s.RejectProposal(ctx, x.ua.ID, rows[0].ID); codeOf(err) != "ai_actions_disabled" {
			t.Errorf("%s: reject %v", c.name, err)
		}
		if _, err := s.EditProposal(ctx, x.ua.ID, rows[0].ID, map[string]json.RawMessage{"title": rawJSON("Khác")}); codeOf(err) != "ai_actions_disabled" {
			t.Errorf("%s: edit %v", c.name, err)
		}
		if _, err := s.UndoProposal(ctx, x.ua.ID, rows[1].ID); codeOf(err) != "ai_actions_disabled" {
			t.Errorf("%s: undo %v", c.name, err)
		}
		c.open()
	}
	if got := proposalRow(t, s, rows[0].ID); got.Status != "pending" || !got.UpdatedAt.Time.Equal(pending.UpdatedAt.Time) {
		t.Errorf("the pending row changed: %+v", got)
	}
	if got := proposalRow(t, s, rows[1].ID); got.Status != "applied" || !got.UpdatedAt.Time.Equal(applied.UpdatedAt.Time) {
		t.Errorf("the applied row changed: %+v", got)
	}
}

// An edit cannot move a row: the workspace and the revision are the server's.
func TestEditCannotRetargetTheWorkspace(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	other, err := s.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	row := propose(t, s, tc, convID, msgID, AskModeAsk, askPrepare(t, s, tc, "create_task", `{"title":"Ở đâu"}`))[0]
	if _, err := s.EditProposal(ctx, x.ua.ID, row.ID, map[string]json.RawMessage{
		"workspace_id": rawJSON(other.Workspace.ID), "revision": rawJSON(99), "title": rawJSON("Ở đây"),
	}); err != nil {
		t.Fatal(err)
	}
	var args map[string]json.RawMessage
	if err := json.Unmarshal([]byte(proposalRow(t, s, row.ID).Payload), &args); err != nil {
		t.Fatal(err)
	}
	if _, has := args["revision"]; has || string(args["workspace_id"]) != string(rawJSON(x.w.ID)) {
		t.Fatalf("stored arguments after the edit: %v", args)
	}
	if _, err := s.ApplyProposal(ctx, x.ua.ID, row.ID); err != nil {
		t.Fatal(err)
	}
	here := x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = 'Ở đây'`, x.w.ID)
	there := x.count(t, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, other.Workspace.ID)
	if here != 1 || there != 0 {
		t.Fatalf("task in the row's workspace %d, in the other %d", here, there)
	}
}

// "Tạo tài liệu" tries again on a page row that failed or expired unapplied,
// drafted anew from the answer; an undone one stays undone. A direct apply of
// that row records decision answer.
func TestSaveAnswerAsDocumentRetries(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	s.SetDocuments(x.docs(t))
	pageRow := func(msgID, convID string, at time.Time) db.AgentActionProposal {
		t.Helper()
		p, err := askProposalParams(tc, convID, msgID, util.NewID(), askAnswerPosition, askPrepare(t, s, tc, "create_document", `{"title":"Cũ","content":"cũ"}`), AskModeAsk, false, at)
		if err != nil {
			t.Fatal(err)
		}
		row, err := s.q.AiInsertProposal(ctx, p)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	saved := func(convID, msgID, rowID, want string) AskProposal {
		t.Helper()
		p, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convID, msgID)
		if err != nil || p.ID != rowID || p.Status != "applied" || p.Decision != "answer" || !p.ExpiresAt.After(time.Now()) {
			t.Fatalf("save: %+v, %v", p, err)
		}
		if md := x.pageMarkdown(t, p.Result.ObjectID); !strings.Contains(md, want) || x.docRow(t, p.Result.ObjectID).Title != "Báo cáo quý" {
			t.Fatalf("page %q from the answer %q", md, want)
		}
		return p
	}

	convID, msgID := askAnswer(t, s, tc, "Lần một", nil)
	failed := pageRow(msgID, convID, time.Now())
	if _, err := s.pool.Exec(ctx, `UPDATE agent_action_proposals SET status = 'failed', error = 'apply_failed', decision = 'answer', decided_by = $2 WHERE id = $1`, failed.ID, x.ua.ID); err != nil {
		t.Fatal(err)
	}
	saved(convID, msgID, failed.ID, "Lần một")

	convID, msgID = askAnswer(t, s, tc, "Lần hai", nil)
	expired := pageRow(msgID, convID, time.Now().Add(-25*time.Hour))
	p := saved(convID, msgID, expired.ID, "Lần hai")

	if _, err := s.UndoProposal(ctx, x.ua.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	pages := x.docRows(t)
	if again, err := s.SaveAnswerAsDocument(ctx, x.ua.ID, convID, msgID); err != nil || again.ID != p.ID || again.Status != "undone" || x.docRows(t) != pages {
		t.Fatalf("save after undo: %+v, %v", again, err)
	}

	convID, msgID = askAnswer(t, s, tc, "Lần ba", nil)
	direct := pageRow(msgID, convID, time.Now())
	if d, err := s.ApplyProposal(ctx, x.ua.ID, direct.ID); err != nil || d.Decision != "answer" {
		t.Fatalf("direct apply of the page row: %+v, %v", d, err)
	}
}
