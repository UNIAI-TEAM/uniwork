package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// follow-4: scheduling the next meeting of one links the two in a series -
// the first meeting's id - whatever meeting of the series it follows; a
// meeting of another workspace, or none, is not found.
func TestFollowUpMeetingJoinsTheSeries(t *testing.T) {
	s, ua, _, w, _ := summaryTasksFixture(t)
	ctx := context.Background()
	at := time.Now().Add(48 * time.Hour)
	schedule := func(title, after string) (string, string, error) {
		m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: title, StartsAt: at, EndsAt: at.Add(time.Hour), FollowUpOf: after})
		return m.ID, m.SeriesID.String, err
	}
	first, series, err := schedule("Giao ban tuần 1", "")
	if err != nil || series != "" {
		t.Fatalf("a first meeting: series %q, %v", series, err)
	}
	second, series, err := schedule("Giao ban tuần 2", first)
	if err != nil || series != first {
		t.Fatalf("the next meeting: series %q, want %q (%v)", series, first, err)
	}
	if _, series, err = schedule("Giao ban tuần 3", second); err != nil || series != first {
		t.Fatalf("after the second: series %q, want %q (%v)", series, first, err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = 'meeting.created' AND changes::jsonb->'series_id'->>'to' = $1`, first); n != 2 {
		t.Fatalf("audited series rows = %d", n)
	}

	beta, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Create(ctx, ua.ID, beta.Workspace.ID, CreateMeetingInput{Title: "Ngoài", StartsAt: at, EndsAt: at.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	for _, after := range []string{other.ID, "01NOSUCHMEETING00000000000"} {
		if _, _, err := schedule("Lạc", after); !errors.Is(err, ErrNotFound) {
			t.Fatalf("follow-up of %s: %v", after, err)
		}
	}
}

// follow-4: carry-over chains along the series as well as the project, only
// over the last 90 days, and says how many there are beyond the page.
func TestCarriedOverItemsFollowTheSeries(t *testing.T) {
	s, ua, ub, w, _ := summaryTasksFixture(t)
	ctx := context.Background()
	now := time.Now()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	held := func(title, after string, started time.Time, items ...string) string {
		t.Helper()
		m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: title, StartsAt: started, EndsAt: started.Add(time.Hour), FollowUpOf: after})
		if err != nil {
			t.Fatal(err)
		}
		proposed := make([]ai.ActionItem, 0, len(items))
		for _, it := range items {
			proposed = append(proposed, ai.ActionItem{Title: it})
		}
		seedSummary(t, s, m, ua.ID, proposed...)
		var convert []ConvertActionItem
		for _, it := range itemsByTitle(t, s, ua.ID, m) {
			convert = append(convert, ConvertActionItem{ActionItemID: it.Item.ID, AssigneeID: &ub.ID})
		}
		if len(convert) > 0 {
			if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", convert); err != nil {
				t.Fatal(err)
			}
		}
		exec(`UPDATE meetings SET status = 'ENDED', actual_start_at = $2, actual_end_at = $2::timestamptz + interval '1 hour' WHERE id = $1`, m.ID, started)
		return m.ID
	}
	old := held("Giao ban quý trước", "", now.Add(-120*24*time.Hour), "Việc quá cũ")
	lastWeek := held("Giao ban tuần trước", old, now.Add(-7*24*time.Hour), "Gửi báo cáo", "Chốt ngân sách")
	unrelated := held("Họp khác", "", now.Add(-3*24*time.Hour), "Việc họp khác")
	_ = unrelated
	current, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Giao ban tuần này", StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour), FollowUpOf: lastWeek})
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.CarriedOverItems(ctx, ub.ID, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]bool{}
	for _, it := range got.Items {
		titles[it.Task.Title] = true
		if it.MeetingID != lastWeek {
			t.Fatalf("carried from %s: %+v", it.MeetingID, it)
		}
	}
	if len(got.Items) != 2 || !titles["Gửi báo cáo"] || !titles["Chốt ngân sách"] || got.Total != 2 {
		t.Fatalf("carried over = %+v (total %d), want last week's two, not the old or the unrelated meeting's", got.Items, got.Total)
	}

	defer func(n int32) { carriedOverLimit = n }(carriedOverLimit)
	carriedOverLimit = 1
	got, err = s.CarriedOverItems(ctx, ub.ID, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Total != 2 {
		t.Fatalf("a page of one: %d items, total %d", len(got.Items), got.Total)
	}
}
