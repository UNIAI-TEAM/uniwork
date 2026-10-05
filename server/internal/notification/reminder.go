package notification

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// reminderLead is how far ahead a meeting is announced.
const reminderLead = 10 * time.Minute

// MeetingReminder creates meeting_starting notifications for meetings that
// begin within the next ten minutes. It is not an outbox consumer — nothing
// emits "a meeting is about to start" — so it is the one job here that
// builds drafts itself.
//
// Each meeting is reminded once: its meeting_reminders row is the claim,
// inserted in the transaction that writes all of the meeting's
// notifications, so a later tick (or a second pod ticking at the same time)
// skips it, and a failure rolls the claim back to retry on the next tick.
// The synthetic event id still goes through notification_deliveries, which
// keeps a pod running the previous version (no claim) from reminding twice
// during a rolling deploy.
type MeetingReminder struct {
	consumer *Consumer
	now      func() time.Time
	log      *slog.Logger
	// recipients lists who hears about a meeting; a field so a test can
	// make one meeting fail.
	recipients func(ctx context.Context, meetingID string) ([]string, error)
}

// NewMeetingReminder wires the job onto the consumer's delivery path.
func NewMeetingReminder(c *Consumer) *MeetingReminder {
	return &MeetingReminder{consumer: c, now: time.Now, log: slog.Default(), recipients: c.q.ListMeetingReminderRecipients}
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

// RunOnce reminds for every scheduled, not yet reminded meeting starting in
// (now, now+10m] and returns how many meetings it claimed. A meeting that
// fails is logged and left unclaimed for the next tick; only failing to
// list the window fails the tick.
func (r *MeetingReminder) RunOnce(ctx context.Context, now time.Time) (int, error) {
	meetings, err := r.consumer.q.ListMeetingsDueReminder(ctx, db.ListMeetingsDueReminderParams{
		StartsAt: pgtype.Timestamptz{Time: now, Valid: true}, StartsAt_2: pgtype.Timestamptz{Time: now.Add(reminderLead), Valid: true},
	})
	if err != nil {
		return 0, err
	}
	claimed := 0
	for _, m := range meetings {
		if ctx.Err() != nil {
			return claimed, ctx.Err()
		}
		ok, err := r.remind(ctx, m, now)
		if err != nil {
			r.log.Warn("meeting reminder: meeting skipped", "meeting_id", m.ID, "err", err)
			continue
		}
		if ok {
			claimed++
		}
	}
	return claimed, nil
}

// remind claims one meeting and writes its notifications in a single
// transaction. It reports false when another tick holds or already made
// the claim, or the meeting is no longer scheduled.
func (r *MeetingReminder) remind(ctx context.Context, m db.ListMeetingsDueReminderRow, now time.Time) (bool, error) {
	c := r.consumer
	userIDs, err := r.recipients(ctx, m.ID)
	if err != nil {
		return false, err
	}
	members := make([]string, 0, len(userIDs))
	for _, uid := range userIDs {
		if _, err := c.env.members.RequireMember(ctx, m.WorkspaceID, uid); err != nil {
			continue
		}
		members = append(members, uid)
	}
	matrices, err := loadMatrices(ctx, c.q, members)
	if err != nil {
		return false, err
	}
	inApp := make([]string, 0, len(members))
	for _, uid := range members {
		if matrices[uid].For(KindMeetingStarting).InApp {
			inApp = append(inApp, uid)
		}
	}
	minutes := int(math.Ceil(m.StartsAt.Time.Sub(now).Minutes()))
	params, err := json.Marshal(map[string]string{"meeting": m.Title, "minutes": strconv.Itoa(minutes)})
	if err != nil {
		return false, err
	}

	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	n, err := q.ClaimMeetingReminder(ctx, m.ID)
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil
	}
	rows, err := r.write(ctx, q, m, string(params), inApp)
	if err != nil {
		return false, err
	}
	events := make([]audit.Event, 0, 2*len(rows))
	for _, row := range rows {
		payload := map[string]string{"notification_id": row.ID, "user_id": row.UserID}
		events = append(events, audit.Event{Topic: TopicCreated, Payload: payload, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID})
		// A merged row is one the person has not looked at yet; pushing
		// again would be the spam the merge exists to prevent.
		if row.Count == 1 && matrices[row.UserID].For(KindMeetingStarting).Push {
			events = append(events, audit.Event{Topic: TopicPush, Payload: payload, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID})
		}
	}
	if len(events) > 0 {
		if err := c.recorder.Emit(ctx, q, audit.System("notification"), events...); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	if c.metrics != nil {
		for _, row := range rows {
			if row.Count > 1 {
				c.metrics.IncNotificationMerged()
			} else {
				c.metrics.IncNotificationCreated(KindMeetingStarting)
			}
		}
	}
	return true, nil
}

// write records the deliveries and upserts the notifications for every
// user the reminder has not reached yet, one statement each.
func (r *MeetingReminder) write(ctx context.Context, q *db.Queries, m db.ListMeetingsDueReminderRow, params string, userIDs []string) ([]db.Notification, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	fresh, err := q.InsertNotificationDeliveries(ctx, db.InsertNotificationDeliveriesParams{EventID: "reminder:" + m.ID, UserIds: userIDs})
	if err != nil || len(fresh) == 0 {
		return nil, err
	}
	ids := make([]string, len(fresh))
	for i := range fresh {
		ids[i] = util.NewID()
	}
	return q.UpsertNotificationsForUsers(ctx, db.UpsertNotificationsForUsersParams{
		Ids: ids, UserIds: fresh, OrganizationID: m.OrganizationID,
		WorkspaceID: optText(m.WorkspaceID), Kind: KindMeetingStarting, GroupKey: "meeting:" + m.ID + ":starting",
		ResourceType: "meeting", ResourceID: m.ID,
		ActorKind: string(audit.KindSystem), ActorID: "meeting_reminder",
		TitleKey: TitleKey(KindMeetingStarting), Params: params,
	})
}
