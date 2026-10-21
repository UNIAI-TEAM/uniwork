package notification

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// addMember registers a third person and adds them to the fixture's
// organization and workspace, the way newFixture adds member.
func (f *fixture) addMember(t *testing.T, email, name string) db.User {
	t.Helper()
	auth := service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := f.register(t, auth, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	return u
}

func assignedTo(title, userID string) service.CreateTaskInput {
	return service.CreateTaskInput{Title: title, AssigneeID: &userID}
}

// createAs creates the inputs in one transaction as the owner, under
// correlation id corr; "" leaves Record to mint one per command.
func (f *fixture) createAs(t *testing.T, corr string, in ...service.CreateTaskInput) []db.Task {
	t.Helper()
	ctx := f.ctx
	if corr != "" {
		ctx = audit.WithRequest(ctx, audit.RequestInfo{CorrelationID: corr})
	}
	tasks, err := f.tasks.CreateManyWith(ctx, f.ownerActor(), f.wsID, in, service.CreateManyOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return tasks
}

// handleCreated hands the task.created event of each task to the consumer,
// in the order of tasks.
func (f *fixture) handleCreated(t *testing.T, tasks []db.Task) {
	t.Helper()
	byTask := map[string]int{}
	evs := f.events(t, "task.created")
	for i, ev := range evs {
		var p map[string]string
		if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
			t.Fatal(err)
		}
		byTask[p["task_id"]] = i
	}
	for _, task := range tasks {
		i, ok := byTask[task.ID]
		if !ok {
			t.Fatalf("no task.created event for %s", task.ID)
		}
		if err := f.consumer.Handle(f.ctx, evs[i]); err != nil {
			t.Fatal(err)
		}
	}
}

func (f *fixture) resetInboxes(t *testing.T, userIDs ...string) {
	t.Helper()
	for _, table := range []string{"notifications", "notification_deliveries"} {
		if _, err := f.pool.Exec(f.ctx, `DELETE FROM `+table+` WHERE user_id = ANY($1)`, userIDs); err != nil {
			t.Fatal(err)
		}
	}
}

func smallestID(tasks []db.Task) string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return slices.Min(ids)
}

func params(t *testing.T, n db.Notification) map[string]string {
	t.Helper()
	var p map[string]string
	if err := json.Unmarshal([]byte(n.Params), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// One task created for the member: one task_assigned, the creator hears nothing.
func TestRuleTaskCreatedNotifiesTheAssignee(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, f.ownerActor(), f.wsID, assignedTo("Viết spec", f.member.ID))
	if err != nil {
		t.Fatal(err)
	}
	f.handleCreated(t, []db.Task{task})
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindTaskAssigned || got[0].GroupKey != "task:"+task.ID+":assigned" ||
		got[0].ResourceType != "task" || got[0].ResourceID != task.ID {
		t.Fatalf("member inbox = %+v", got)
	}
	if p := params(t, got[0]); p["task"] != "Viết spec" || p["actor"] != "Chủ Nhóm" {
		t.Fatalf("params = %+v", p)
	}
	if n := len(f.inbox(t, f.owner.ID)); n != 0 {
		t.Fatalf("owner inbox = %d rows", n)
	}
}

// Assigning yourself, or an agent, notifies nobody.
func TestRuleTaskCreatedSkipsSelfAndAgentAssignees(t *testing.T) {
	f := newFixture(t)
	agent, err := f.q.CreateAgent(f.ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: f.orgID, Name: "bot", Handle: "bot",
		OwnerUserID: f.owner.ID, AutonomyPolicy: "{}", CreatedBy: f.owner.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceAgentMember(f.ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: f.wsID, AgentID: agent.ID, OrganizationID: f.orgID, CreatedBy: f.owner.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	toAgent := assignedTo("Cho bot", agent.ID)
	toAgent.AssigneeKind = "agent"
	tasks := f.createAs(t, "corr-skip", assignedTo("Tự làm", f.owner.ID), toAgent)
	f.handleCreated(t, tasks)
	for _, u := range []string{f.owner.ID, f.member.ID} {
		if n := len(f.inbox(t, u)); n != 0 {
			t.Fatalf("inbox of %s = %d rows", u, n)
		}
	}
}

// One creation that hands the member three tasks is one tasks_assigned row;
// member2's single task stays a task_assigned. Order and redelivery do not
// change the outcome.
func TestRuleTaskCreatedGroupsOneTransaction(t *testing.T) {
	f := newFixture(t)
	member2 := f.addMember(t, "member2@example.com", "Thành Viên Hai")
	tasks := f.createAs(t, "corr-batch",
		assignedTo("Một", f.member.ID), assignedTo("Hai", f.member.ID),
		assignedTo("Ba", member2.ID), assignedTo("Bốn", f.member.ID))
	var mine []db.Task
	for _, task := range tasks {
		if task.AssigneeID.String == f.member.ID {
			mine = append(mine, task)
		}
	}
	check := func(pass string) {
		t.Helper()
		got := f.inbox(t, f.member.ID)
		if len(got) != 1 || got[0].Kind != KindTasksAssigned || got[0].GroupKey != "tasks:"+smallestID(mine)+":assigned" ||
			got[0].ResourceType != "task" || got[0].ResourceID != smallestID(mine) || params(t, got[0])["count"] != "3" ||
			params(t, got[0])["meeting"] != "" {
			t.Fatalf("%s: member inbox = %+v", pass, got)
		}
		got2 := f.inbox(t, member2.ID)
		if len(got2) != 1 || got2[0].Kind != KindTaskAssigned || got2[0].ResourceID != tasks[2].ID {
			t.Fatalf("%s: member2 inbox = %+v", pass, got2)
		}
	}
	f.handleCreated(t, tasks)
	check("in order")

	f.resetInboxes(t, f.member.ID, member2.ID)
	reversed := slices.Clone(tasks)
	slices.Reverse(reversed)
	f.handleCreated(t, reversed)
	check("reversed")

	for _, task := range mine {
		if task.ID == smallestID(mine) {
			f.handleCreated(t, []db.Task{task})
		}
	}
	check("redelivered")
}

// Two creations under one correlation id (one MCP call, two commands) are
// two transactions and two notifications.
func TestRuleTaskCreatedKeepsTransactionsApart(t *testing.T) {
	f := newFixture(t)
	first := f.createAs(t, "corr-same", assignedTo("A1", f.member.ID), assignedTo("A2", f.member.ID))
	second := f.createAs(t, "corr-same", assignedTo("B1", f.member.ID), assignedTo("B2", f.member.ID))
	f.handleCreated(t, append(first, second...))
	got := f.inbox(t, f.member.ID)
	if len(got) != 2 {
		t.Fatalf("member inbox = %+v", got)
	}
	for _, n := range got {
		if n.Kind != KindTasksAssigned || params(t, n)["count"] != "2" {
			t.Fatalf("row = %+v", n)
		}
	}
}

// Tasks a meeting produced point the notification at the meeting.
func TestRuleTaskCreatedPointsAMeetingBatchAtTheMeeting(t *testing.T) {
	f := newFixture(t)
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, "Họp tuần")
	if err != nil {
		t.Fatal(err)
	}
	in := []service.CreateTaskInput{assignedTo("Việc 1", f.member.ID), assignedTo("Việc 2", f.member.ID)}
	for i := range in {
		in[i].OriginType, in[i].OriginID = "meeting", &m.ID
	}
	f.handleCreated(t, f.createAs(t, "corr-meeting", in...))
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindTasksAssigned || got[0].ResourceType != "meeting" || got[0].ResourceID != m.ID {
		t.Fatalf("member inbox = %+v", got)
	}
	// The sentence names the meeting the tasks came from.
	if p := params(t, got[0]); p["meeting"] != "Họp tuần" {
		t.Fatalf("params = %v", p)
	}
	// The push link lands on the assignee's own tasks, as the inbox does.
	url, err := ResourceURL(f.ctx, f.q, "https://app.test", got[0])
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://app.test/notif-org/notif-ws/my-tasks"; url != want {
		t.Fatalf("url = %q, want %q", url, want)
	}
}

// Without a request correlation id Record mints one per command, so each
// task is its own group and is told on its own.
func TestRuleTaskCreatedOneCommandPerCorrelationIsOnePerTask(t *testing.T) {
	f := newFixture(t)
	f.handleCreated(t, f.createAs(t, "", assignedTo("X", f.member.ID), assignedTo("Y", f.member.ID)))
	got := f.inbox(t, f.member.ID)
	if len(got) != 2 || got[0].Kind != KindTaskAssigned || got[1].Kind != KindTaskAssigned {
		t.Fatalf("member inbox = %+v", got)
	}
}

// The leader speaks for the group: once it is gone nobody is promoted, so
// the batch is never told twice.
func TestRuleTaskCreatedLeaderDeletedSendsNothing(t *testing.T) {
	f := newFixture(t)
	tasks := f.createAs(t, "corr-gone", assignedTo("P", f.member.ID), assignedTo("Q", f.member.ID))
	if err := f.tasks.Delete(f.ctx, f.owner.ID, smallestID(tasks)); err != nil {
		t.Fatal(err)
	}
	f.handleCreated(t, tasks)
	if got := f.inbox(t, f.member.ID); len(got) != 0 {
		t.Fatalf("member inbox = %+v", got)
	}
}

// The group is what the transaction created, read from its audit rows: a
// leader reassigned before delivery still speaks for the batch, to the
// person it was created for.
func TestRuleTaskCreatedGroupsByTheCreatedAssignee(t *testing.T) {
	f := newFixture(t)
	member2 := f.addMember(t, "member2@example.com", "Thành Viên Hai")
	tasks := f.createAs(t, "corr-moved", assignedTo("M1", f.member.ID), assignedTo("M2", f.member.ID))
	f.assign(t, smallestID(tasks), member2.ID)
	f.handleCreated(t, tasks)
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindTasksAssigned || params(t, got[0])["count"] != "2" {
		t.Fatalf("member inbox = %+v", got)
	}
	if got := f.inbox(t, member2.ID); len(got) != 0 {
		t.Fatalf("member2 inbox = %+v", got)
	}
}

// The onboarding welcome task is assigned to the person it is seeded for,
// with the system as actor; they did not get it from anybody.
func TestRuleTaskCreatedSkipsTheWelcomeTask(t *testing.T) {
	f := newFixture(t)
	onb := service.NewOnboardingService(f.q, f.ws, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	task, created, err := onb.SeedWelcomeTask(f.ctx, f.member.ID, f.wsID)
	if err != nil || !created {
		t.Fatalf("seed = %v, created %v", err, created)
	}
	f.handleCreated(t, []db.Task{task})
	if got := f.inbox(t, f.member.ID); len(got) != 0 {
		t.Fatalf("member inbox = %+v", got)
	}
}

// Created assigned, then moved away and back: the created and the updated
// notices share the group key, so the person still has one unread row.
func TestRuleTaskCreatedSharesTheAssignedGroupWithUpdates(t *testing.T) {
	f := newFixture(t)
	member2 := f.addMember(t, "member2@example.com", "Thành Viên Hai")
	task, err := f.tasks.Create(f.ctx, f.ownerActor(), f.wsID, assignedTo("Đi rồi về", f.member.ID))
	if err != nil {
		t.Fatal(err)
	}
	f.handleCreated(t, []db.Task{task})
	f.assign(t, task.ID, member2.ID)
	f.handleLast(t, "task.updated")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].GroupKey != "task:"+task.ID+":assigned" || got[0].ReadAt.Valid || got[0].Count != 2 {
		t.Fatalf("member inbox = %+v", got)
	}
}
