package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func resolveSubscriberTarget(actor Actor, in SubscribeTaskInput) (actorType, actorID string, err error) {
	actorType = "member"
	if actor.Kind == audit.KindAgent {
		actorType = "agent"
	}
	actorID = actor.ID
	requestedID := strings.TrimSpace(in.UserID)
	if requestedID == "" {
		return actorType, actorID, nil
	}
	requestedType := strings.TrimSpace(in.UserType)
	if requestedType == "" {
		requestedType = actorType
	}
	if requestedID != actorID || requestedType != actorType {
		return "", "", ErrForbidden
	}
	return actorType, actorID, nil
}

// ListTaskSubscribers lists watchers on a task.
func (s *TaskService) ListTaskSubscribers(ctx context.Context, actor Actor, taskID string) ([]db.TaskSubscriber, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskSubscribers(ctx, db.ListTaskSubscribersParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
}

// autoSubscribeTaskAssignee follows the task for its current direct assignee.
// Automatic rules never revive an explicit opt-out; only SubscribeTask may do
// that. The caller owns q's transaction so assignment and subscription commit
// together.
func autoSubscribeTaskAssignee(ctx context.Context, q *db.Queries, task db.Task) (bool, error) {
	if !task.AssigneeID.Valid || !task.AssigneeType.Valid {
		return false, nil
	}
	n, err := q.AutoSubscribeTaskActor(ctx, db.AutoSubscribeTaskActorParams{
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		TaskID:         task.ID,
		ActorType:      task.AssigneeType.String,
		ActorID:        task.AssigneeID.String,
		Reason:         "assignee",
	})
	return n > 0, err
}

func taskSubscriptionEvent(task db.Task) audit.Event {
	return audit.Event{Topic: "task.subscribed", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}
}

// SubscribeTask adds a manual subscriber.
func (s *TaskService) SubscribeTask(ctx context.Context, actor Actor, taskID string, in SubscribeTaskInput) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	actorType, actorID, err := resolveSubscriberTarget(actor, in)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.SubscribeToTaskExplicitly(ctx, db.SubscribeToTaskExplicitlyParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID, TaskID: taskID,
		ActorType: actorType, ActorID: actorID, Reason: "manual",
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return tx.Commit(ctx)
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskSubscribed,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"actor_type": actorType, "actor_id": actorID},
	}, audit.Event{Topic: "task.subscribed", Payload: map[string]string{
		"task_id": taskID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UnsubscribeTask removes a subscriber from one task.
func (s *TaskService) UnsubscribeTask(ctx context.Context, actor Actor, taskID string, in SubscribeTaskInput) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	actorType, actorID, err := resolveSubscriberTarget(actor, in)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.unsubscribeOneTx(ctx, s.q.WithTx(tx), actor, task, taskID, actorType, actorID, "task"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) unsubscribeOneTx(ctx context.Context, q *db.Queries, actor Actor, task db.Task, taskID, actorType, actorID, scope string) error {
	n, err := q.OptOutTaskSubscriber(ctx, db.OptOutTaskSubscriberParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		ActorType: actorType, ActorID: actorID, OptOutScope: optText(&scope),
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskUnsubscribed,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"actor_type": actorType, "actor_id": actorID},
	}, audit.Event{Topic: "task.unsubscribed", Payload: map[string]string{
		"task_id": taskID, "workspace_id": task.WorkspaceID,
	}})
}

// UnsubscribeTaskSubtree leaves the task and every descendant in one transaction.
func (s *TaskService) UnsubscribeTaskSubtree(ctx context.Context, actor Actor, taskID string, in SubscribeTaskInput) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	actorType, actorID, err := resolveSubscriberTarget(actor, in)
	if err != nil {
		return err
	}
	ids, err := s.q.ListDescendantTaskIDs(ctx, db.ListDescendantTaskIDsParams{
		RootID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	for _, id := range ids {
		if err := s.unsubscribeOneTx(ctx, q, actor, task, id, actorType, actorID, "subtree"); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// CommentSubTaskPreview is stubbed (source-context / agent surface).
func (s *TaskService) CommentSubTaskPreview(ctx context.Context, actor Actor, commentID string) error {
	if _, err := s.loadComment(ctx, actor, commentID); err != nil {
		return err
	}
	return collaborationUnavailable("source_context_not_ready", "sub-task preview chưa khả dụng")
}

// CreateCommentSubTasks is stubbed.
func (s *TaskService) CreateCommentSubTasks(ctx context.Context, actor Actor, commentID string) error {
	if _, err := s.loadComment(ctx, actor, commentID); err != nil {
		return err
	}
	return collaborationUnavailable("source_context_not_ready", "tạo sub-task từ comment chưa khả dụng")
}

// PreviewCommentTriggers is stubbed (agent mention preview).
func (s *TaskService) PreviewCommentTriggers(ctx context.Context, actor Actor, taskID string) error {
	if _, err := s.authorizeActor(ctx, actor, taskID); err != nil {
		return err
	}
	return collaborationUnavailable("agent_trigger_not_ready", "trigger preview chưa khả dụng")
}
