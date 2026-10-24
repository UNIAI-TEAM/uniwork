package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// askWriteWorld is the agent world with ub also in the workspace, to edit and
// comment after the asker.
func askWriteWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, ai.ToolContext) {
	t.Helper()
	x, s, tc := newAgentWorld(t)
	addOrgMember(t, s.q, x.w.OrganizationID, x.ub.ID)
	addWorkspaceMember(t, s.q, x.w.ID, x.ub.ID)
	return x, s, tc
}

func writeToolNamed(t *testing.T, s *AskUNIService, name string) askWriteTool {
	t.Helper()
	for _, tool := range s.askWriteTools() {
		if tool.Name == name {
			return tool
		}
	}
	t.Fatalf("no write tool %q", name)
	return askWriteTool{}
}

func askPrepare(t *testing.T, s *AskUNIService, tc ai.ToolContext, name, args string, earlier ...askDraftRow) askDraftRow {
	t.Helper()
	row, err := writeToolNamed(t, s, name).prepare(context.Background(), tc, json.RawMessage(args), earlier)
	if err != nil {
		t.Fatalf("prepare %s(%s): %v", name, args, err)
	}
	return row
}

func TestAskWriteTaskLevels(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	ctx := context.Background()
	mine := x.taskID // created by ua, assigned to ua
	touched := x.task(t, x.ua.ID, x.w.ID, "Đã có người sửa")
	other := "Tên mới"
	if _, err := s.tasks.Update(ctx, Human(x.ub.ID), touched.ID, UpdateTaskInput{Title: &other}); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, tool, args, want string
	}{
		{"create alone", "create_task", `{"title":"A"}`, askLevel1},
		{"create for me", "create_task", fmt.Sprintf(`{"title":"A2","assignee_id":%q}`, x.ua.ID), askLevel1},
		{"create for someone else", "create_task", fmt.Sprintf(`{"title":"A3","assignee_id":%q}`, x.ub.ID), askLevel2},
		{"create in a project", "create_task", `{"title":"A4","project_id":"p1"}`, askLevel2},
		{"create under a parent", "create_task", fmt.Sprintf(`{"title":"A5","parent_task_id":%q}`, mine), askLevel2},
		{"update status of mine", "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, mine), askLevel1},
		{"update assignee to someone else", "update_task", fmt.Sprintf(`{"task_id":%q,"assignee_id":%q}`, mine, x.ub.ID), askLevel2},
		{"update a task someone else edited", "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, touched.ID), askLevel2},
		{"comment", "add_comment", fmt.Sprintf(`{"task_id":%q,"body":"hi"}`, mine), askLevel2},
	}
	for _, c := range cases {
		if got := askPrepare(t, s, tc, c.tool, c.args).Level; got != c.want {
			t.Errorf("%s: level %s, want %s", c.name, got, c.want)
		}
	}
}

func TestAskWriteTaskPrepareReadsTheTarget(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	cur, err := x.tools.GetTask(context.Background(), x.p, x.w.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	row := askPrepare(t, s, tc, "update_task", fmt.Sprintf(`{"task_id":%q,"status":"done"}`, x.taskID))
	if row.TargetRevision == nil || *row.TargetRevision != cur.Revision || row.TargetKind != "task" || row.TargetID != x.taskID {
		t.Fatalf("target = %s %s rev %v, want task %s rev %d", row.TargetKind, row.TargetID, row.TargetRevision, x.taskID, cur.Revision)
	}
	if row.Preview.Target.Title != cur.Title {
		t.Errorf("target title %q", row.Preview.Target.Title)
	}
	f := row.Preview.Fields
	if len(f) != 1 || f[0].Field != "status" || f[0].Type != "enum" || f[0].From != "Cần làm" || f[0].To != "Hoàn thành" {
		t.Fatalf("fields = %+v", f)
	}
	if _, err := writeToolNamed(t, s, "update_task").prepare(context.Background(), tc, json.RawMessage(`{"task_id":"`+x.taskID+`","bogus":1}`), nil); err == nil {
		t.Error("an unknown field was accepted")
	}
}

func TestAskWriteTaskRowRefs(t *testing.T) {
	_, s, tc := newAgentWorld(t)
	ctx := context.Background()
	created := askPrepare(t, s, tc, "create_task", `{"title":"Sau này"}`)
	row := askPrepare(t, s, tc, "add_comment", `{"task_id":"{{row:1.id}}","body":"chào"}`, created)
	if row.Level != askLevel2 || row.TargetRevision != nil || row.TargetID != "" || !slices.Equal(row.Preview.Refs, []int{1}) || row.Preview.Target.Title != "Sau này" {
		t.Fatalf("row = %+v", row)
	}
	child := askPrepare(t, s, tc, "create_task", `{"title":"Con","parent_task_id":"{{row:1.id}}"}`, created)
	if child.Level != askLevel2 || !slices.Equal(child.Preview.Refs, []int{1}) {
		t.Fatalf("child = %+v", child)
	}
	bad := map[string][]askDraftRow{
		`{"task_id":"{{row:2.id}}","body":"x"}`: {created},
		`{"task_id":"{{row:0.id}}","body":"x"}`: {created},
		`{"task_id":"{{row:1.id}}","body":"x"}`: {{Tool: "update_task"}},
	}
	for args, earlier := range bad {
		if _, err := writeToolNamed(t, s, "add_comment").prepare(ctx, tc, json.RawMessage(args), earlier); !errors.As(err, new(McpInvalidArgs)) {
			t.Errorf("%s: err = %v, want McpInvalidArgs", args, err)
		}
	}
}

func TestAskWriteCommentPreview(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	row := askPrepare(t, s, tc, "add_comment", fmt.Sprintf(`{"task_id":%q,"body":"dòng 1\ndòng 2"}`, x.taskID))
	if row.Preview.Body != "dòng 1\ndòng 2" || row.Preview.Audience.Visibility != "task" || row.Preview.Audience.NotifiesMore {
		t.Fatalf("preview = %+v", row.Preview)
	}
	// ub comments first: the asker's next comment reaches an earlier commenter.
	if _, err := x.tools.AddComment(context.Background(), McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}, mcpAddCommentIn{WorkspaceID: x.w.ID, TaskID: x.taskID, Body: "trước"}); err != nil {
		t.Fatal(err)
	}
	row = askPrepare(t, s, tc, "add_comment", fmt.Sprintf(`{"task_id":%q,"body":"x"}`, x.taskID))
	if !row.Preview.Audience.NotifiesMore {
		t.Errorf("notifies_more false with an earlier commenter")
	}
}

func TestAskWriteTaskApplyAndUndo(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	ctx := context.Background()
	p := principalOf(tc)
	run := func(name, args string) (AskProposalResult, *askInverse, error) {
		row := askPrepare(t, s, tc, name, args)
		return writeToolNamed(t, s, name).apply(ctx, p, row)
	}
	undo := func(inv *askInverse) error {
		t.Helper()
		if inv == nil {
			t.Fatal("no inverse")
		}
		return askInverses[inv.Op](ctx, s, p, inv.Args)
	}

	// create → delete
	res, inv, err := run("create_task", `{"title":"Mới tạo"}`)
	if err != nil || res.ObjectID == "" || inv.Op != "delete_task" {
		t.Fatalf("create: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.GetTask(ctx, x.p, x.w.ID, res.ObjectID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("task still there: %v", err)
	}
	// a created task someone changed cannot be deleted by undo
	res, inv, _ = run("create_task", `{"title":"Mới tạo 2"}`)
	nt := "Đổi tên"
	if _, err := s.tasks.Update(ctx, Human(x.ub.ID), res.ObjectID, UpdateTaskInput{Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if _, err := x.tools.GetTask(ctx, x.p, x.w.ID, res.ObjectID); err != nil {
		t.Fatalf("task was deleted anyway: %v", err)
	}

	// update → update back
	res, inv, err = run("update_task", fmt.Sprintf(`{"task_id":%q,"status":"done","due_date":null,"priority":"high"}`, x.taskID))
	if err != nil || inv == nil || inv.Op != "update_task" || len(res.Changes) != 3 {
		t.Fatalf("update: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	got, _ := x.tools.GetTask(ctx, x.p, x.w.ID, x.taskID)
	if got.Status != "todo" || got.Priority != "none" || got.DueDate == "" {
		t.Fatalf("not restored: %+v", got)
	}
	// update → someone edits → undo refuses and writes nothing
	_, inv, _ = run("update_task", fmt.Sprintf(`{"task_id":%q,"status":"in_progress"}`, x.taskID))
	nt = "Người khác sửa"
	if _, err := s.tasks.Update(ctx, Human(x.ub.ID), x.taskID, UpdateTaskInput{Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if got, _ = x.tools.GetTask(ctx, x.p, x.w.ID, x.taskID); got.Status != "in_progress" {
		t.Fatalf("undo wrote: %s", got.Status)
	}

	// no description → set one → undo clears it again
	bare := x.task(t, x.ua.ID, x.w.ID, "Không mô tả")
	_, inv, err = run("update_task", fmt.Sprintf(`{"task_id":%q,"description":"mới có"}`, bare.ID))
	if err != nil {
		t.Fatal(err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got, _ = x.tools.GetTask(ctx, x.p, x.w.ID, bare.ID); got.Description == nil || *got.Description != "" {
		t.Fatalf("description not cleared: %v", got.Description)
	}
	// a no-op update never becomes a row
	if _, err := writeToolNamed(t, s, "update_task").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"task_id":%q,"priority":"none"}`, bare.ID)), nil); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("no-op err = %v", err)
	}

	// comment → delete comment
	res, inv, err = run("add_comment", fmt.Sprintf(`{"task_id":%q,"body":"xin chào"}`, x.taskID))
	if err != nil || inv.Op != "delete_task_comment" {
		t.Fatalf("comment: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if rows, _ := s.tasks.Comments(ctx, x.ua.ID, x.taskID); len(rows) != 0 {
		t.Fatalf("%d comments left", len(rows))
	}
}

func assertUndoUnavailable(t *testing.T, err error) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "undo_unavailable" || ce.Status != 409 {
		t.Fatalf("err = %v, want undo_unavailable 409", err)
	}
}
