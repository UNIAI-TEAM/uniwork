package notification

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (f *fixture) scheduleMeeting(t *testing.T, title string, startsAt time.Time) db.Meeting {
	t.Helper()
	m, err := f.q.CreateMeeting(f.ctx, db.CreateMeetingParams{
		ID: util.NewID(), WorkspaceID: f.wsID, OrganizationID: f.orgID, Title: title, RoomName: "r-" + title, CreatedBy: f.owner.ID, CreatedByKind: "human",
		Status: "SCHEDULED", MeetingType: "SCHEDULED", HostUserID: f.owner.ID, Timezone: "UTC", AllowJoinRequest: true,
		StartsAt: pgtype.Timestamptz{Time: startsAt, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: startsAt.Add(30 * time.Minute), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func (f *fixture) reminded(t *testing.T, meetingID string) bool {
	t.Helper()
	var ok bool
	if err := f.pool.QueryRow(f.ctx, `SELECT EXISTS (SELECT 1 FROM meeting_reminders WHERE meeting_id = $1)`, meetingID).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}

// Two pods ticking together (a rolling deploy) claim a meeting once between
// them, and every later tick finds nothing left to do: the job does not
// re-process the whole ten-minute window each minute.
func TestMeetingReminderClaimsEachMeetingOnce(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	m := f.scheduleMeeting(t, "Giao ban", now.Add(5*time.Minute))

	var wg sync.WaitGroup
	counts := make([]int, 2)
	errs := make([]error, 2)
	for i := range counts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			counts[i], errs[i] = NewMeetingReminder(f.consumer).RunOnce(f.ctx, now)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if counts[0]+counts[1] != 1 {
		t.Fatalf("concurrent ticks claimed %v, want exactly one claim between them", counts)
	}
	if !f.reminded(t, m.ID) {
		t.Fatal("meeting not marked reminded")
	}
	if n, err := NewMeetingReminder(f.consumer).RunOnce(f.ctx, now.Add(time.Minute)); err != nil || n != 0 {
		t.Fatalf("next tick claimed %d (err %v), want 0", n, err)
	}
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Count != 1 || got[0].Kind != KindMeetingStarting {
		t.Fatalf("host inbox = %+v, want one unmerged meeting_starting", got)
	}
	if !contains(got[0].Params, `"minutes":"5"`) {
		t.Fatalf("params = %s", got[0].Params)
	}
	if evs := f.events(t, TopicCreated); len(evs) != 1 {
		t.Fatalf("notification.created events = %d, want 1", len(evs))
	}
}

// One meeting that fails is logged and left for the next tick; the others
// in the window are still reminded.
func TestMeetingReminderSkipsAFailingMeeting(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	broken := f.scheduleMeeting(t, "Hỏng", now.Add(3*time.Minute))
	fine := f.scheduleMeeting(t, "Ổn", now.Add(4*time.Minute))

	r := NewMeetingReminder(f.consumer)
	list := r.recipients
	r.recipients = func(ctx context.Context, meetingID string) ([]string, error) {
		if meetingID == broken.ID {
			return nil, errors.New("boom")
		}
		return list(ctx, meetingID)
	}
	n, err := r.RunOnce(f.ctx, now)
	if err != nil || n != 1 {
		t.Fatalf("RunOnce = %d, %v; want 1 meeting and no error", n, err)
	}
	if f.reminded(t, broken.ID) || !f.reminded(t, fine.ID) {
		t.Fatalf("reminded: broken=%v fine=%v, want only the healthy meeting", f.reminded(t, broken.ID), f.reminded(t, fine.ID))
	}

	r.recipients = list
	if n, err := r.RunOnce(f.ctx, now.Add(time.Minute)); err != nil || n != 1 {
		t.Fatalf("retry tick = %d, %v; want the failed meeting reminded", n, err)
	}
	if len(f.inbox(t, f.owner.ID)) != 2 {
		t.Fatalf("host inbox = %+v, want both meetings", f.inbox(t, f.owner.ID))
	}
}

// A meeting cancelled between the listing and the claim is not claimed.
func TestMeetingReminderIgnoresAMeetingCancelledMeanwhile(t *testing.T) {
	f := newFixture(t)
	now := time.Now()
	m := f.scheduleMeeting(t, "Huỷ", now.Add(2*time.Minute))
	rows, err := f.q.ListMeetingsDueReminder(f.ctx, db.ListMeetingsDueReminderParams{
		StartsAt: pgtype.Timestamptz{Time: now, Valid: true}, StartsAt_2: pgtype.Timestamptz{Time: now.Add(reminderLead), Valid: true},
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("due meetings = %+v (err %v), want the one scheduled", rows, err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE meetings SET status = 'CANCELLED' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	ok, err := NewMeetingReminder(f.consumer).remind(f.ctx, rows[0], now)
	if err != nil || ok {
		t.Fatalf("remind = %v, %v; want no claim for a cancelled meeting", ok, err)
	}
	if f.reminded(t, m.ID) || len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("cancelled meeting was reminded")
	}
}
