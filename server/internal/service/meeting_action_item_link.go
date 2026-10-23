package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// LinkActionItem makes a pending item track a task that already exists in
// the meeting's workspace instead of creating one (follow-5): the open task
// the duplicate guard names when last week's commitment comes up again. The
// item then counts as converted, as if the meeting had handed it out. Same
// locks as a conversion, so it never lands on an item a regenerated summary
// is replacing or one a concurrent conversion took.
func (s *MeetingService) LinkActionItem(ctx context.Context, userID, meetingID, itemID, taskID string) error {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return Invalid("cần task_id")
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		rows, err := lockActionItems(ctx, q, m, []string{itemID})
		if err != nil {
			return err
		}
		// GetTask is by-id: a task of another workspace or tenant is not found.
		task, err := q.GetTask(ctx, taskID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (task.OrganizationID != m.OrganizationID || task.WorkspaceID != m.WorkspaceID)) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if actionItemStatus(rows[0].MeetingActionItem, rows[0].TaskLive) != ActionItemPending {
			return errActionItemNotPending([]string{itemID})
		}
		actor := Human(userID)
		if err := q.ConvertMeetingActionItem(ctx, db.ConvertMeetingActionItemParams{
			OrganizationID: m.OrganizationID, ID: itemID, TaskID: strText(task.ID), ConvertedBy: strText(actor.ID),
		}); err != nil {
			return err
		}
		// action_item.converted: the clients refresh the item, its counts
		// and the carried-over lists exactly as for a conversion.
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, Actor: actor,
			Action: audit.ActionMeetingActionItemLinked, ResourceType: "meeting_action_item", ResourceID: itemID,
			Metadata: map[string]any{"meeting_id": m.ID, "task_id": task.ID},
		}, audit.Event{Topic: "action_item.converted", Payload: map[string]string{
			"meeting_id": m.ID, "workspace_id": m.WorkspaceID,
		}})
	})
}
