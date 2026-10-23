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

	refused("someone else in the organization", x.ub.ID, func(err error) bool { return errors.Is(err, ErrNotFound) })

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
func TestApplyPlanStopsAtTheFirstFailure(t *testing.T) {
	x, s, tc := proposalWorld(t)
	ctx := context.Background()
	plan := func(project string) (string, string, []db.AgentActionProposal) {
		t.Helper()
		convID, msgID := askAnswer(t, s, tc, "Kế hoạch", nil)
		p := askPrepare(t, s, tc, "create_project", fmt.Sprintf(`{"title":%q}`, project))
		task := askPrepare(t, s, tc, "create_task", `{"title":"Việc trong dự án","project_id":"{{row:1.id}}"}`, p)
		other := askPrepare(t, s, tc, "create_task", `{"title":"Việc không chọn"}`)
		return convID, msgID, propose(t, s, tc, convID, msgID, AskModePlan, p, task, other)
	}
	statuses := func(ps []AskProposal) string {
		var out []string
		for _, p := range ps {
			out = append(out, fmt.Sprintf("%d:%s", p.Position, p.Status))
		}
		return strings.Join(out, " ")
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
