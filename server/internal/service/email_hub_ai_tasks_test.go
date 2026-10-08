package service

import (
	"context"
	"errors"
	"testing"
	"time"

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
