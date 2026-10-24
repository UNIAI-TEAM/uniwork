package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2153 S2: a link's secret is derived from its id, so its host can copy it
// again from the list; a revoked link and a link made with a random secret list none.
func TestInviteLinkListsADerivedSecretThatResolves(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "L", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "Agency", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	revoked, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "Cũ", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeInviteLink(ctx, ua.ID, m.ID, revoked.Link.ID); err != nil {
		t.Fatal(err)
	}
	raw, err := newInviteSecret()
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := s.q.CreateInviteLink(ctx, db.CreateInviteLinkParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, Name: "Legacy", SecretHash: hashInviteSecret(raw),
		AccessMode: LinkAutoAdmit, ExpiresAt: fresh.Link.ExpiresAt, CreatedBy: ua.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	listed, err := s.ListInviteLinks(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	secrets := map[string]string{}
	for _, l := range listed {
		secrets[l.Link.ID] = l.Secret
	}
	if len(secrets) != 3 || secrets[fresh.Link.ID] != fresh.RawSecret || secrets[revoked.Link.ID] != "" || secrets[legacy.ID] != "" {
		t.Fatalf("listed secrets = %v, want only %s's", secrets, fresh.Link.ID)
	}
	if v, err := s.ResolveInviteLink(ctx, fresh.Link.ID, secrets[fresh.Link.ID], AdmissionContext{}); err != nil || v.LinkState != InviteLinkActive {
		t.Fatalf("copied secret resolves: %+v %v", v, err)
	}
	// Only the host or an admin lists links, secrets included.
	if _, err := s.ListInviteLinks(ctx, ub.ID, m.ID); err == nil {
		t.Fatal("a member who does not host listed the links")
	}
}

// UNI-2153 S3: the neighbours are the uncanceled meetings of the same series
// right before and after, in the same workspace only.
func TestSeriesNeighbors(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	base := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	create := func(title string, at time.Time, previous string) db.Meeting {
		t.Helper()
		m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: title, StartsAt: at, EndsAt: at.Add(time.Hour), FollowUpOf: previous})
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	root := create("Tuần 42", base, "")
	lone := create("Lẻ", base.Add(time.Hour), "")
	w43 := create("Tuần 43", base.Add(7*24*time.Hour), root.ID)
	canceled := create("Tuần 44 (hủy)", base.Add(14*24*time.Hour), w43.ID)
	w45 := create("Tuần 45", base.Add(21*24*time.Hour), w43.ID)
	if err := s.Cancel(ctx, ua.ID, canceled.ID, "dời"); err != nil {
		t.Fatal(err)
	}
	// A row of another workspace carrying the same series id is never returned.
	beta, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Create(ctx, ua.ID, beta.Workspace.ID, CreateMeetingInput{Title: "Khác", StartsAt: base.Add(10 * 24 * time.Hour), EndsAt: base.Add(10*24*time.Hour + time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET series_id = $1 WHERE id = $2`, root.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	reload := func(m db.Meeting) db.Meeting {
		t.Helper()
		got, err := s.q.GetMeeting(ctx, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	for _, c := range []struct {
		name       string
		m          db.Meeting
		prev, next string
	}{
		{"root", root, "", w43.ID},
		{"follower", w43, root.ID, w45.ID},
		{"last skips the canceled one", w45, w43.ID, ""},
		{"canceled still sees its neighbours", canceled, w43.ID, w45.ID},
		{"lone meeting", lone, "", ""},
	} {
		prev, next := s.SeriesNeighbors(ctx, reload(c.m))
		if prev != c.prev || next != c.next {
			t.Errorf("%s: neighbours = (%q, %q), want (%q, %q)", c.name, prev, next, c.prev, c.next)
		}
	}
}

// UNI-2153 S4: a due date read from a loose phrase is marked guessed; one
// read from a written date is not.
func TestActionItemsMarkGuessedDueDates(t *testing.T) {
	s, ua, _, _, m := summaryTasksFixture(t)
	written := civilDay(meetingDueAnchor(m)).AddDate(0, 0, 10)
	dm := fmt.Sprintf("%d/%d", written.Day(), int(written.Month()))
	seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Thứ Hai", Due: "thứ Hai"},
		ai.ActionItem{Title: "Tuần sau", Due: "tuần sau"},
		ai.ActionItem{Title: "Có ngày", Due: "thứ Ba ngày " + dm},
		ai.ActionItem{Title: "Trước ngày", Due: "trước ngày " + dm},
	)
	items := itemsByTitle(t, s, ua.ID, m)
	for title, guessed := range map[string]bool{"Thứ Hai": true, "Tuần sau": true, "Có ngày": false, "Trước ngày": false} {
		it := items[title]
		if it.SuggestedDueDate == nil {
			t.Fatalf("%s: no suggested due date", title)
		}
		if it.SuggestedDueGuessed != guessed {
			t.Errorf("%s (%q -> %s): guessed = %v, want %v", title, it.Item.DueText, *it.SuggestedDueDate, it.SuggestedDueGuessed, guessed)
		}
	}
}

// UNI-2153 S5: a retried create with the same Idempotency-Key replays the
// first meeting instead of making a second one.
func TestMeetingCreateIdempotencyKey(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	in := CreateMeetingInput{Title: "Giao ban", StartsAt: start, EndsAt: start.Add(time.Hour), IdempotencyKey: "k-sched"}
	count := func(topic, id string) (meetingsRows, events int) {
		t.Helper()
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meetings WHERE workspace_id = $1 AND title = $2`, w.ID, in.Title).Scan(&meetingsRows); err != nil {
			t.Fatal(err)
		}
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'meeting_id' = $2`, topic, id).Scan(&events); err != nil {
			t.Fatal(err)
		}
		return
	}

	first, err := s.Create(ctx, ua.ID, w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.Create(ctx, ua.ID, w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID || again.Version != first.Version || !again.StartsAt.Time.Equal(first.StartsAt.Time) {
		t.Fatalf("replay = %+v, want %+v", again, first)
	}
	if rows, events := count("meeting.created", first.ID); rows != 1 || events != 1 {
		t.Fatalf("after a replay: %d meetings, %d meeting.created rows; want 1 and 1", rows, events)
	}
	if _, err := s.Create(ctx, ub.ID, w.ID, in); !codedIs(err, "idempotency_key_reuse") {
		t.Fatalf("another member with the same key: %v", err)
	}
	in.IdempotencyKey = ""
	if _, err := s.Create(ctx, ua.ID, w.ID, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, ua.ID, w.ID, in); err != nil {
		t.Fatal(err)
	}
	if rows, _ := count("meeting.created", first.ID); rows != 3 {
		t.Fatalf("without a key: %d meetings, want 3", rows)
	}

	instant, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, "Họp ngay", "k-instant")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, "Họp ngay", "k-instant")
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != instant.ID || replayed.Status != MeetingInProgress {
		t.Fatalf("instant replay = %s %s, want %s IN_PROGRESS", replayed.ID, replayed.Status, instant.ID)
	}
	var instants, ensures int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meetings WHERE workspace_id = $1 AND title = 'Họp ngay'`, w.ID).Scan(&instants); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'provider.ensure_session' AND payload::jsonb->>'meeting_id' = $1`, instant.ID).Scan(&ensures); err != nil {
		t.Fatal(err)
	}
	if instants != 1 || ensures != 1 {
		t.Fatalf("instant replay: %d meetings, %d ensure rows; want 1 and 1", instants, ensures)
	}
	// The two routes keep separate scopes: the scheduled key does not replay an instant meeting.
	if other, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, "Họp ngay", "k-sched"); err != nil || other.ID == first.ID {
		t.Fatalf("instant with the scheduled route's key: %v %v", other.ID, err)
	}
}
