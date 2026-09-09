package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *TaskService) resolveSubscriberTarget(ctx context.Context, actor Actor, task db.Task, in SubscribeTaskInput) (actorType, actorID string, err error) {
	actorType = "member"
	actorID = actor.ID
	if strings.TrimSpace(in.UserID) != "" {
		actorID = strings.TrimSpace(in.UserID)
		if strings.TrimSpace(in.UserType) == "agent" {
			actorType = "agent"
			if _, err := s.ws.RequireAgentMember(ctx, task.WorkspaceID, actorID); err != nil {
				return "", "", err
			}
		} else {
			if _, err := s.ws.RequireMember(ctx, task.WorkspaceID, actorID); err != nil {
				return "", "", err
			}
		}
	} else if actor.Kind == audit.KindAgent {
		actorType = "agent"
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

// SubscribeTask adds a manual subscriber.
func (s *TaskService) SubscribeTask(ctx context.Context, actor Actor, taskID string, in SubscribeTaskInput) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	actorType, actorID, err := s.resolveSubscriberTarget(ctx, actor, task, in)
	if err != nil {
		return err
	}
	existing, err := s.q.ListTaskSubscribers(ctx, db.ListTaskSubscribersParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if err != nil {
		return err
	}
	for _, sub := range existing {
		if sub.ActorType == actorType && sub.ActorID == actorID && sub.Reason == "manual" {
			return nil // already subscribed — skip audit/outbox
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.UpsertTaskSubscriber(ctx, db.UpsertTaskSubscriberParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID, TaskID: taskID,
		ActorType: actorType, ActorID: actorID, Reason: "manual",
	}); err != nil {
		return err
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
	actorType, actorID, err := s.resolveSubscriberTarget(ctx, actor, task, in)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.unsubscribeOneTx(ctx, s.q.WithTx(tx), actor, task, taskID, actorType, actorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) unsubscribeOneTx(ctx context.Context, q *db.Queries, actor Actor, task db.Task, taskID, actorType, actorID string) error {
	n, err := q.DeleteTaskSubscriber(ctx, db.DeleteTaskSubscriberParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		ActorType: actorType, ActorID: actorID,
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
	actorType, actorID, err := s.resolveSubscriberTarget(ctx, actor, task, in)
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
		if err := s.unsubscribeOneTx(ctx, q, actor, task, id, actorType, actorID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GetTaskTimeline is stubbed until activity projection is ported.
func (s *TaskService) GetTaskTimeline(ctx context.Context, actor Actor, taskID string) error {
	if _, err := s.authorizeActor(ctx, actor, taskID); err != nil {
		return err
	}
	return collaborationUnavailable("timeline_not_ready", "timeline chưa khả dụng")
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
