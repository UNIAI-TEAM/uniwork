package service

import (
	"context"
	"errors"
	"testing"
)

func hasTaskSubscriber(t *testing.T, s *TaskService, actor Actor, taskID, actorType, actorID string) bool {
	t.Helper()
	subscribers, err := s.ListTaskSubscribers(context.Background(), actor, taskID)
	if err != nil {
		t.Fatalf("list task subscribers: %v", err)
	}
	for _, subscriber := range subscribers {
		if subscriber.ActorType == actorType && subscriber.ActorID == actorID {
			return true
		}
	}
	return false
}

func TestTaskSubscriptionCannotChangeAnotherActor(t *testing.T) {
	s, _, creator, other, workspace := taskFixture(t)
	addOrgMember(t, s.q, workspace.OrganizationID, other.ID)
	addWorkspaceMember(t, s.q, workspace.ID, other.ID)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(creator.ID), workspace.ID, CreateTaskInput{Title: "Self only"})
	if err != nil {
		t.Fatal(err)
	}
	in := SubscribeTaskInput{UserID: other.ID, UserType: "member"}
	if err := s.SubscribeTask(ctx, Human(creator.ID), task.ID, in); !errors.Is(err, ErrForbidden) {
		t.Fatalf("subscribe another actor: want forbidden, got %v", err)
	}
	if err := s.UnsubscribeTask(ctx, Human(creator.ID), task.ID, in); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unsubscribe another actor: want forbidden, got %v", err)
	}
}

func TestTaskAssignmentAutoSubscribesAssignee(t *testing.T) {
	t.Run("on create", func(t *testing.T) {
		s, _, creator, assignee, workspace := taskFixture(t)
		addOrgMember(t, s.q, workspace.OrganizationID, assignee.ID)
		addWorkspaceMember(t, s.q, workspace.ID, assignee.ID)

		task, err := s.Create(context.Background(), Human(creator.ID), workspace.ID, CreateTaskInput{
			Title:      "Assigned on create",
			AssigneeID: &assignee.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if !hasTaskSubscriber(t, s, Human(creator.ID), task.ID, "member", assignee.ID) {
			t.Fatal("assignee should automatically follow a task assigned during creation")
		}
	})

	t.Run("on update", func(t *testing.T) {
		s, _, creator, assignee, workspace := taskFixture(t)
		addOrgMember(t, s.q, workspace.OrganizationID, assignee.ID)
		addWorkspaceMember(t, s.q, workspace.ID, assignee.ID)

		task, err := s.Create(context.Background(), Human(creator.ID), workspace.ID, CreateTaskInput{
			Title: "Assigned later",
		})
		if err != nil {
			t.Fatal(err)
		}
		assigneeID := &assignee.ID
		if _, err := s.Update(context.Background(), Human(creator.ID), task.ID, UpdateTaskInput{
			AssigneeID: &assigneeID,
		}); err != nil {
			t.Fatal(err)
		}
		if !hasTaskSubscriber(t, s, Human(creator.ID), task.ID, "member", assignee.ID) {
			t.Fatal("new assignee should automatically follow a task assigned during update")
		}
	})
}

func TestTaskSubscriptionOptOutPersistsUntilExplicitSubscribe(t *testing.T) {
	s, _, creator, assignee, workspace := taskFixture(t)
	addOrgMember(t, s.q, workspace.OrganizationID, assignee.ID)
	addWorkspaceMember(t, s.q, workspace.ID, assignee.ID)
	ctx := context.Background()

	task, err := s.Create(ctx, Human(creator.ID), workspace.ID, CreateTaskInput{
		Title:      "Persistent opt-out",
		AssigneeID: &assignee.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Seed the active subscription explicitly so this contract remains focused
	// on opt-out persistence even while auto-subscribe is still the RED behavior.
	if err := s.SubscribeTask(ctx, Human(assignee.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.UnsubscribeTask(ctx, Human(assignee.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}

	assigned, err := s.Get(ctx, creator.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !assigned.AssigneeID.Valid || assigned.AssigneeID.String != assignee.ID {
		t.Fatalf("unfollow changed assignee: %+v", assigned.AssigneeID)
	}

	var nobody *string
	if _, err := s.Update(ctx, Human(creator.ID), task.ID, UpdateTaskInput{AssigneeID: &nobody}); err != nil {
		t.Fatal(err)
	}
	assigneeID := &assignee.ID
	if _, err := s.Update(ctx, Human(creator.ID), task.ID, UpdateTaskInput{AssigneeID: &assigneeID}); err != nil {
		t.Fatal(err)
	}
	if hasTaskSubscriber(t, s, Human(creator.ID), task.ID, "member", assignee.ID) {
		t.Fatal("assignment auto-follow should not resurrect an explicit opt-out")
	}

	if err := s.SubscribeTask(ctx, Human(assignee.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if !hasTaskSubscriber(t, s, Human(creator.ID), task.ID, "member", assignee.ID) {
		t.Fatal("explicit follow should restore a previously opted-out assignee")
	}
}

func TestTaskFollowAndUnfollowNeverChangeAssignee(t *testing.T) {
	s, _, creator, assignee, workspace := taskFixture(t)
	addOrgMember(t, s.q, workspace.OrganizationID, assignee.ID)
	addWorkspaceMember(t, s.q, workspace.ID, assignee.ID)
	ctx := context.Background()

	task, err := s.Create(ctx, Human(creator.ID), workspace.ID, CreateTaskInput{
		Title:      "Assignment is independent",
		AssigneeID: &assignee.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SubscribeTask(ctx, Human(assignee.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.UnsubscribeTask(ctx, Human(assignee.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}

	got, err := s.Get(ctx, creator.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.AssigneeID.Valid || got.AssigneeID.String != assignee.ID {
		t.Fatalf("follow/unfollow changed assignee: %+v", got.AssigneeID)
	}
}

func TestTaskSubtreeOptOutSurvivesSingleTaskOptOutAndReparent(t *testing.T) {
	s, _, creator, assignee, workspace := taskFixture(t)
	addOrgMember(t, s.q, workspace.OrganizationID, assignee.ID)
	addWorkspaceMember(t, s.q, workspace.ID, assignee.ID)
	ctx := context.Background()

	root, err := s.Create(ctx, Human(creator.ID), workspace.ID, CreateTaskInput{Title: "Opted-out tree"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UnsubscribeTaskSubtree(ctx, Human(assignee.ID), root.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.UnsubscribeTask(ctx, Human(assignee.ID), root.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}

	child, err := s.Create(ctx, Human(creator.ID), workspace.ID, CreateTaskInput{
		Title:      "Assigned before reparent",
		AssigneeID: &assignee.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !hasTaskSubscriber(t, s, Human(creator.ID), child.ID, "member", assignee.ID) {
		t.Fatal("assigned task should initially be followed")
	}
	if _, err := s.SetParent(ctx, Human(creator.ID), child.ID, &root.ID); err != nil {
		t.Fatal(err)
	}
	if hasTaskSubscriber(t, s, Human(creator.ID), child.ID, "member", assignee.ID) {
		t.Fatal("subtree opt-out should suppress an auto-followed task moved into the tree")
	}

	if err := s.SubscribeTask(ctx, Human(assignee.ID), child.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if !hasTaskSubscriber(t, s, Human(creator.ID), child.ID, "member", assignee.ID) {
		t.Fatal("explicit follow should override an ancestor subtree opt-out for this task")
	}
}
