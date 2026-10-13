package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Tasks created from an email thread summary carry the thread as their
// origin; the Work Graph projects that as ORIGINATED_FROM (C-11 §9.1 V3).
// Only the mailbox owner may create them.
func TestCreateTasksFromThreadSummaryKeepsTheOrigin(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	svc.Tasks = NewTaskService(pool, q, svc.ws, nil)
	account := seedEmailHubAccount(t, q, testEmailHubBox(t), user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, account.ID, ws.OrganizationID)

	tasks, err := svc.CreateTasksFromThreadSummary(ctx, Human(user.ID), ws.ID, account.ID, thread.ID,
		[]SummaryTaskItem{{Title: "Gửi báo giá"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].OriginType.String != "email_thread" || tasks[0].OriginID.String != thread.ID {
		t.Fatalf("origin = %+v / %+v", tasks[0].OriginType, tasks[0].OriginID)
	}
}

// Another member of the workspace cannot create tasks from someone else's
// mailbox, even with the right ids.
func TestCreateTasksFromThreadSummaryRefusesOtherMembers(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	svc.Tasks = NewTaskService(pool, q, svc.ws, nil)
	account := seedEmailHubAccount(t, q, testEmailHubBox(t), user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, account.ID, ws.OrganizationID)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	other := registerVerified(t, q, as, "eh-other@example.com", "Khác")
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: ws.OrganizationID, UserID: other.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID, UserID: other.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.CreateTasksFromThreadSummary(ctx, Human(other.ID), ws.ID, account.ID, thread.ID,
		[]SummaryTaskItem{{Title: "Không được"}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("other member err = %v, want ErrNotFound", err)
	}
}

// The confirm dialog is the human decision (ADR 0010): an item sent without
// assignee_id or due_date stays unassigned and undated, even when the AI's
// owner text names a member and its due text parses. The AI text survives in
// the description.
func TestCreateTasksFromThreadSummaryKeepsTheHumanChoice(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	svc.Tasks = NewTaskService(pool, q, svc.ws, nil)
	account := seedEmailHubAccount(t, q, testEmailHubBox(t), user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, account.ID, ws.OrganizationID)

	tasks, err := svc.CreateTasksFromThreadSummary(ctx, Human(user.ID), ws.ID, account.ID, thread.ID,
		[]SummaryTaskItem{{Title: "Gửi báo giá", Owner: "EH User", DueSpoken: "thu sau"}})
	if err != nil {
		t.Fatal(err)
	}
	got := tasks[0]
	if got.AssigneeID.Valid || got.DueDate.Valid {
		t.Fatalf("assignee = %+v, due = %+v; want both empty", got.AssigneeID, got.DueDate)
	}
	for _, want := range []string{"Người phụ trách (AI): EH User", "Hạn (AI): thu sau"} {
		if !strings.Contains(got.Description, want) {
			t.Fatalf("description %q lacks %q", got.Description, want)
		}
	}
}

func TestCreateTasksFromThreadSummaryIsAtomicAndRetryable(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	svc.Tasks = NewTaskService(pool, q, svc.ws, nil)
	account := seedEmailHubAccount(t, q, testEmailHubBox(t), user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, account.ID, ws.OrganizationID)

	items := []SummaryTaskItem{
		{Title: "Gọi khách hàng"},
		{Title: "Gửi báo giá"},
		{Title: "Chốt hợp đồng", Priority: "invalid"},
	}
	created, err := svc.CreateTasksFromThreadSummary(ctx, Human(user.ID), ws.ID, account.ID, thread.ID, items)
	if err == nil {
		t.Fatal("expected the third item to fail")
	}
	if len(created) != 0 {
		t.Fatalf("failed batch returned %d partial tasks", len(created))
	}
	assertEmailSummaryTaskBatchState(t, ctx, svc.Tasks, q, ws, 0)

	items[2].Priority = "low"
	created, err = svc.CreateTasksFromThreadSummary(ctx, Human(user.ID), ws.ID, account.ID, thread.ID, items)
	if err != nil {
		t.Fatalf("valid retry: %v", err)
	}
	if len(created) != len(items) {
		t.Fatalf("created %d tasks, want %d", len(created), len(items))
	}
	for i, task := range created {
		if task.Title != items[i].Title {
			t.Fatalf("task %d title = %q, want %q", i, task.Title, items[i].Title)
		}
	}
	assertEmailSummaryTaskBatchState(t, ctx, svc.Tasks, q, ws, len(items))
}

func assertEmailSummaryTaskBatchState(
	t *testing.T,
	ctx context.Context,
	tasks *TaskService,
	q *db.Queries,
	ws db.Workspace,
	want int,
) {
	t.Helper()
	rows, err := tasks.List(ctx, ws.CreatedBy, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != want {
		t.Fatalf("persisted tasks = %d, want %d", len(rows), want)
	}
	audits, err := q.ListAuditEvents(ctx, db.ListAuditEventsParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    pgtype.Text{String: ws.ID, Valid: true},
		Action:         pgtype.Text{String: "task.created", Valid: true},
		LimitN:         100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(audits) != want {
		t.Fatalf("task.created audits = %d, want %d", len(audits), want)
	}
}
