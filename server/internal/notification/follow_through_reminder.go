package notification

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	followThroughTick = 15 * time.Minute
	// pendingItemsAfter is how long after its end a meeting with items nobody
	// assigned nudges its clerks; pendingItemsWindow how long it keeps trying
	// (a host who is not a member any more is never reached).
	pendingItemsAfter  = 24 * time.Hour
	pendingItemsWindow = 6 * 24 * time.Hour
	// taskDueHour is the local hour from which a due or overdue task reminds,
	// so nobody is told at midnight; taskOverdueDays bounds how stale an
	// overdue task may be and still remind, so the first run after a deploy
	// does not unload months of old tasks at once.
	taskDueHour     = 8
	taskOverdueDays = 7
	// taskStageOverdue marks the overdue notice of meeting_task_due; the
	// due-today one carries no stage.
	taskStageOverdue = "overdue"
)

// FollowThroughReminder keeps a meeting's commitments from slipping silently
// (follow-2): a day after a meeting ends with items nobody assigned, its host
// and secretaries hear how many are left, and a task the meeting handed out
// reminds its assignee on the day it is due and once when it is overdue.
// Like MeetingReminder it is not an outbox consumer - nothing emits "a day
// passed" - so it builds drafts itself and hands them to the consumer's
// delivery path, whose notification_deliveries ledger and once-per-group
// claim make every notice one-shot across ticks and pods.
type FollowThroughReminder struct {
	consumer *Consumer
	now      func() time.Time
	log      *slog.Logger
}

// NewFollowThroughReminder wires the job onto the consumer's delivery path.
func NewFollowThroughReminder(c *Consumer) *FollowThroughReminder {
	return &FollowThroughReminder{consumer: c, now: time.Now, log: slog.Default()}
}

// Run ticks every fifteen minutes until ctx is done.
func (r *FollowThroughReminder) Run(ctx context.Context) {
	t := time.NewTicker(followThroughTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.RunOnce(ctx, r.now()); err != nil {
				r.log.Warn("follow-through reminder", "err", err)
			}
		}
	}
}

// RunOnce sends every notice due at now. One meeting or task that fails is
// logged and retried on the next tick; only failing a list fails the tick.
func (r *FollowThroughReminder) RunOnce(ctx context.Context, now time.Time) error {
	if err := r.pendingItems(ctx, now); err != nil {
		return err
	}
	return r.tasksDue(ctx, now)
}

// systemEvent stands in for the outbox row a rule would get: the system is
// the actor, so nobody is excluded as "you did this yourself".
func systemEvent() outbox.Row {
	return outbox.Row{ActorKind: pgtype.Text{String: string(audit.KindSystem), Valid: true},
		ActorID: pgtype.Text{String: "meeting_follow_through", Valid: true}}
}

func (r *FollowThroughReminder) pendingItems(ctx context.Context, now time.Time) error {
	c := r.consumer
	rows, err := c.q.ListMeetingsWithPendingItems(ctx, db.ListMeetingsWithPendingItemsParams{
		EndedAfter:  pgtype.Timestamptz{Time: now.Add(-pendingItemsAfter - pendingItemsWindow), Valid: true},
		EndedBefore: pgtype.Timestamptz{Time: now.Add(-pendingItemsAfter), Valid: true},
	})
	if err != nil {
		return err
	}
	for _, m := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.nudgeClerks(ctx, m); err != nil {
			r.log.Warn("follow-through reminder: meeting skipped", "meeting_id", m.ID, "err", err)
		}
	}
	return nil
}

func (r *FollowThroughReminder) nudgeClerks(ctx context.Context, m db.ListMeetingsWithPendingItemsRow) error {
	c := r.consumer
	ps, err := c.q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return err
	}
	rc := newRecipients(ctx, c.env, systemEvent(), m.WorkspaceID)
	rc.add(m.HostUserID)
	for _, pt := range ps {
		if pt.IsSecretary && pt.Status == "ACTIVE" && pt.UserID.Valid {
			rc.add(pt.UserID.String)
		}
	}
	ds, err := rc.drafts(m.OrganizationID, KindMeetingActionItemsPending, "meeting:"+m.ID+":pending_items",
		"meeting", m.ID, map[string]string{"meeting": m.Title, "count": strconv.Itoa(int(m.Pending))})
	if err != nil {
		return err
	}
	for i := range ds {
		ds[i].OncePerGroup = true
	}
	return c.deliver(ctx, "meeting_pending_items:"+m.ID, "", ds)
}

func (r *FollowThroughReminder) tasksDue(ctx context.Context, now time.Time) error {
	c := r.consumer
	// Every zone is within a day of UTC: the window covers "today" anywhere.
	day := now.UTC()
	rows, err := c.q.ListMeetingTasksDue(ctx, db.ListMeetingTasksDueParams{
		DueFrom: pgtype.Date{Time: day.AddDate(0, 0, -taskOverdueDays-1), Valid: true},
		DueTo:   pgtype.Date{Time: day.AddDate(0, 0, 1), Valid: true},
	})
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, t := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if seen[t.TaskID] {
			continue // one task handed out by two items reminds once
		}
		seen[t.TaskID] = true
		if err := r.remindTask(ctx, t, now); err != nil {
			r.log.Warn("follow-through reminder: task skipped", "task_id", t.TaskID, "err", err)
		}
	}
	return nil
}

func (r *FollowThroughReminder) remindTask(ctx context.Context, t db.ListMeetingTasksDueRow, now time.Time) error {
	local := now.In(meetingZone(t.Timezone))
	if local.Hour() < taskDueHour {
		return nil
	}
	today := local.Format("2006-01-02")
	due := t.DueDate.Time.Format("2006-01-02")
	params := map[string]string{"task": t.TaskTitle, "meeting": t.MeetingTitle}
	eventID, group := "meeting_task_due:"+t.TaskID+":"+due, "task:"+t.TaskID+":due:"+due
	switch {
	case due == today:
	case due < today && due >= local.AddDate(0, 0, -taskOverdueDays).Format("2006-01-02"):
		params["stage"] = taskStageOverdue
		eventID, group = "meeting_task_overdue:"+t.TaskID, "task:"+t.TaskID+":overdue"
	default:
		return nil
	}
	c := r.consumer
	rc := newRecipients(ctx, c.env, systemEvent(), t.WorkspaceID)
	rc.add(t.AssigneeID)
	ds, err := rc.drafts(t.OrganizationID, KindMeetingTaskDue, group, "task", t.TaskID, params)
	if err != nil {
		return err
	}
	for i := range ds {
		ds[i].OncePerGroup = true
	}
	return c.deliver(ctx, eventID, "", ds)
}

// meetingZone reads a user's IANA zone, the product's home zone when it is
// empty or unknown (the digest's fallback).
func meetingZone(tz string) *time.Location {
	if loc, err := time.LoadLocation(tz); err == nil && tz != "" {
		return loc
	}
	loc, _ := time.LoadLocation("Asia/Ho_Chi_Minh")
	return loc
}
