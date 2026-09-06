package notification

import (
	"context"
	"log/slog"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// reminderLead is how far ahead a meeting is announced.
const reminderLead = 10 * time.Minute

// MeetingReminder creates meeting_starting notifications for meetings that
// begin within the next ten minutes. It is not an outbox consumer — nothing
// emits "a meeting is about to start" — so it is the one job here that
// builds drafts itself, and it goes through the same deliver path with a
// synthetic event id so a tick never reminds twice.
type MeetingReminder struct {
	consumer *Consumer
	now      func() time.Time
	log      *slog.Logger
}

// NewMeetingReminder wires the job onto the consumer's delivery path.
func NewMeetingReminder(c *Consumer) *MeetingReminder {
	return &MeetingReminder{consumer: c, now: time.Now, log: slog.Default()}
}

// Run ticks every minute until ctx is done.
func (r *MeetingReminder) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := r.RunOnce(ctx, r.now()); err != nil {
				r.log.Warn("meeting reminder", "err", err)
			}
		}
	}
}

// RunOnce reminds for every scheduled meeting starting in (now, now+10m] and
// returns how many meetings it handled.
func (r *MeetingReminder) RunOnce(ctx context.Context, now time.Time) (int, error) {
	q := r.consumer.q
	meetings, err := q.ListMeetingsStartingBetween(ctx, db.ListMeetingsStartingBetweenParams{
		StartsAt: pgtype.Timestamptz{Time: now, Valid: true}, StartsAt_2: pgtype.Timestamptz{Time: now.Add(reminderLead), Valid: true},
	})
	if err != nil {
		return 0, err
	}
	for _, m := range meetings {
		ws, err := q.GetWorkspaceByID(ctx, m.WorkspaceID)
		if err != nil {
			return 0, err
		}
		userIDs, err := q.ListMeetingReminderRecipients(ctx, m.ID)
		if err != nil {
			return 0, err
		}
		minutes := int(math.Ceil(m.StartsAt.Time.Sub(now).Minutes()))
		params := map[string]string{"meeting": m.Title, "minutes": strconv.Itoa(minutes)}
		var drafts []Draft
		for _, uid := range userIDs {
			if _, err := r.consumer.env.members.RequireMember(ctx, m.WorkspaceID, uid); err != nil {
				continue
			}
			drafts = append(drafts, Draft{
				UserID: uid, OrganizationID: ws.OrganizationID, WorkspaceID: m.WorkspaceID,
				Kind: KindMeetingStarting, GroupKey: "meeting:" + m.ID + ":starting",
				ResourceType: "meeting", ResourceID: m.ID,
				ActorKind: string(audit.KindSystem), ActorID: "meeting_reminder", Params: params,
			})
		}
		if err := r.consumer.deliver(ctx, "reminder:"+m.ID, "", drafts); err != nil {
			return 0, err
		}
	}
	return len(meetings), nil
}
