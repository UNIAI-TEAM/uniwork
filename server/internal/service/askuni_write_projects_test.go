package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"
)

func TestAskWriteProjectApplyAndUndo(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	ctx := context.Background()
	p := principalOf(tc)
	run := func(name, args string) (AskProposalResult, *askInverse, error) {
		return writeToolNamed(t, s, name).apply(ctx, p, askPrepare(t, s, tc, name, args))
	}
	undo := func(inv *askInverse) error {
		t.Helper()
		if inv == nil {
			t.Fatal("no inverse")
		}
		return askInverses[inv.Op](ctx, s, p, inv.Args)
	}
	exists := func(id string) bool {
		_, err := x.tools.GetProject(ctx, p, mcpProjectRef{WorkspaceID: x.w.ID, ProjectID: id})
		return err == nil
	}

	// create → delete while it is empty and untouched
	res, inv, err := run("create_project", `{"title":"Dự án mới","priority":"high"}`)
	if err != nil || res.ObjectID == "" || inv == nil || inv.Op != "delete_project" {
		t.Fatalf("create: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if exists(res.ObjectID) {
		t.Fatal("project still there")
	}

	// a task now lives in it: undo refuses and the project stays whole
	res, inv, _ = run("create_project", `{"title":"Có việc"}`)
	task := x.task(t, x.ua.ID, x.w.ID, "Việc trong dự án")
	pid := res.ObjectID
	pidp := &pid
	if _, err := s.tasks.Update(ctx, Human(x.ua.ID), task.ID, UpdateTaskInput{ProjectID: &pidp}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if !exists(pid) {
		t.Fatal("project deleted anyway")
	}

	// someone renamed it: same
	res, inv, _ = run("create_project", `{"title":"Sẽ bị đổi"}`)
	cur, _ := s.tasks.GetProject(ctx, Human(x.ua.ID), x.w.ID, res.ObjectID)
	nt := "Đã đổi tên"
	if _, err := s.tasks.UpdateProject(ctx, Human(x.ua.ID), x.w.ID, res.ObjectID, UpdateProjectInput{ExpectedRevision: cur.Revision, Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if !exists(res.ObjectID) {
		t.Fatal("project deleted anyway")
	}

	// update → update back, down to empty values
	id := x.project(t, "Gốc")
	_, err = s.tasks.UpdateProject(ctx, Human(x.ua.ID), x.w.ID, id, UpdateProjectInput{ExpectedRevision: x.projectRevision(t, id), Description: strPtr("mô tả cũ")})
	if err != nil {
		t.Fatal(err)
	}
	res, inv, err = run("update_project", fmt.Sprintf(`{"project_id":%q,"title":"Ngọn","description":"","priority":"urgent","lead_id":%q,"due_date":"2026-12-01"}`, id, x.ub.ID))
	if err != nil || inv == nil || inv.Op != "update_project" || len(res.Changes) != 5 {
		t.Fatalf("update: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	got, err := x.tools.GetProject(ctx, p, mcpProjectRef{WorkspaceID: x.w.ID, ProjectID: id})
	if err != nil || got.Title != "Gốc" || got.Priority != "none" || got.LeadID != "" || got.DueDate != "" || got.Description == nil || *got.Description != "mô tả cũ" {
		t.Fatalf("not restored: %+v %v", got, err)
	}
	// a third-party edit after the update: undo refuses and writes nothing
	_, inv, _ = run("update_project", fmt.Sprintf(`{"project_id":%q,"status":"paused"}`, id))
	nt = "Người khác sửa"
	if _, err := s.tasks.UpdateProject(ctx, Human(x.ua.ID), x.w.ID, id, UpdateProjectInput{ExpectedRevision: x.projectRevision(t, id), Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if got, _ = x.tools.GetProject(ctx, p, mcpProjectRef{WorkspaceID: x.w.ID, ProjectID: id}); got.Status != "paused" {
		t.Fatalf("undo wrote: %s", got.Status)
	}
	// a no-op update never becomes a row
	if _, err := writeToolNamed(t, s, "update_project").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"project_id":%q,"status":"paused"}`, id)), nil); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("no-op err = %v", err)
	}
}

func TestAskWriteProjectPreviewNamesTheLead(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	ctx := context.Background()
	row := askPrepare(t, s, tc, "create_project", fmt.Sprintf(`{"title":"Có trưởng nhóm","lead_id":%q}`, x.ub.ID))
	var lead *AskProposalField
	for i := range row.Preview.Fields {
		if row.Preview.Fields[i].Field == "lead_id" {
			lead = &row.Preview.Fields[i]
		}
	}
	name := s.memberNames(ctx, tc)[x.ub.ID]
	if lead == nil || lead.Type != "person" || name == "" || lead.To != name || row.Level != askLevel2 || row.Preview.Audience.Visibility != "workspace" || row.Preview.Target.Title != "Có trưởng nhóm" {
		t.Fatalf("preview = %+v level %s (name %q)", row.Preview, row.Level, name)
	}

	// a title another project already has, in any case or spacing: refused, no row
	x.project(t, "Ra  Mắt")
	for _, args := range []string{`{"title":"ra mắt"}`} {
		_, err := writeToolNamed(t, s, "create_project").prepare(ctx, tc, json.RawMessage(args), nil)
		var te McpToolError
		if !errors.As(err, &te) || te.Code != "duplicate_project_title" {
			t.Fatalf("%s: err = %v, want duplicate_project_title", args, err)
		}
	}
	// so is a rename onto one; keeping its own title is no duplicate
	id := x.project(t, "Khác")
	_, err := writeToolNamed(t, s, "update_project").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"project_id":%q,"title":"RA MẮT"}`, id)), nil)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "duplicate_project_title" {
		t.Fatalf("rename err = %v", err)
	}
	row = askPrepare(t, s, tc, "update_project", fmt.Sprintf(`{"project_id":%q,"title":"khác","priority":"low"}`, id))
	if row.Level != askLevel2 || row.TargetRevision == nil || row.TargetID != id || row.Preview.Target.ID != id {
		t.Fatalf("update row = %+v", row)
	}
}

func TestAskWriteProjectRowRef(t *testing.T) {
	_, s, tc := askWriteWorld(t)
	created := askPrepare(t, s, tc, "create_project", `{"title":"Sau này"}`)
	row := askPrepare(t, s, tc, "update_project", `{"project_id":"{{row:1.id}}","priority":"high"}`, created)
	if row.Level != askLevel2 || row.TargetRevision != nil || row.TargetID != "" || !slices.Equal(row.Preview.Refs, []int{1}) || row.Preview.Target.Title != "Sau này" {
		t.Fatalf("row = %+v", row)
	}
	if _, err := writeToolNamed(t, s, "update_project").prepare(context.Background(), tc, json.RawMessage(`{"project_id":"{{row:1.id}}","priority":"high"}`), []askDraftRow{{Tool: "create_task"}}); !errors.As(err, new(McpInvalidArgs)) {
		t.Fatalf("wrong kind err = %v", err)
	}
}
