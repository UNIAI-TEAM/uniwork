package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestCarriedOverItems: a meeting with a project sees the converted items
// whose task is still open from the other ENDED meetings of that project in
// its workspace that started before it — soonest due first, no due last.
func TestCarriedOverItems(t *testing.T) {
	s, ua, ub, w, current := summaryTasksFixture(t)
	ctx := context.Background()
	const project, otherProject = "01PRJCARRIEDOVER0000000001", "01PRJCARRIEDOVER0000000002"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	due := func(d string) *string { return &d }

	// newMeeting converts the given titles (title → due, "" for none) and
	// returns the meeting with its tasks by title.
	newMeeting := func(title string, items map[string]string) (db.Meeting, map[string]string) {
		t.Helper()
		m, err := s.CreateInstant(ctx, ua.ID, w.ID, title)
		if err != nil {
			t.Fatal(err)
		}
		proposed := make([]ai.ActionItem, 0, len(items)+1)
		for it := range items {
			proposed = append(proposed, ai.ActionItem{Title: it})
		}
		proposed = append(proposed, ai.ActionItem{Title: title + " chờ"})
		seedSummary(t, s, m, ua.ID, proposed...)
		byTitle := itemsByTitle(t, s, ua.ID, m)
		var convert []ConvertActionItem
		for it, d := range items {
			c := ConvertActionItem{ActionItemID: byTitle[it].Item.ID, AssigneeID: &ub.ID}
			if d != "" {
				c.DueDate = due(d)
			}
			convert = append(convert, c)
		}
		links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", convert)
		if err != nil {
			t.Fatal(err)
		}
		tasks := map[string]string{}
		for i, l := range links {
			for it := range items {
				if byTitle[it].Item.ID == convert[i].ActionItemID {
					tasks[it] = l.TaskID
				}
			}
		}
		return m, tasks
	}
	end := func(m db.Meeting, projectID string, started time.Time) {
		t.Helper()
		exec(`UPDATE meetings SET status = 'ENDED', project_id = $2, actual_start_at = $3, actual_end_at = $3::timestamptz + interval '1 hour' WHERE id = $1`,
			m.ID, projectID, started)
	}

	now := time.Now()
	earlier, earlierTasks := newMeeting("Họp tuần trước", map[string]string{
		"Gửi báo cáo": "2020-01-02", "Đặt phòng": "", "Đã xong": "2030-01-01", "In tài liệu": "2020-01-01",
	})
	end(earlier, project, now.Add(-7*24*time.Hour))
	exec(`UPDATE tasks SET status = 'done' WHERE id = $1`, earlierTasks["Đã xong"])
	// A dismissed item never reaches the list: no task to carry.
	dismissMe := itemsByTitle(t, s, ua.ID, earlier)["Họp tuần trước chờ"].Item.ID
	if err := s.DismissActionItem(ctx, ua.ID, earlier.ID, dismissMe, ""); err != nil {
		t.Fatal(err)
	}

	otherProj, _ := newMeeting("Dự án khác", map[string]string{"Việc dự án khác": ""})
	end(otherProj, otherProject, now.Add(-3*24*time.Hour))
	later, _ := newMeeting("Họp sau", map[string]string{"Việc họp sau": ""})
	end(later, project, now.Add(2*24*time.Hour))
	running, _ := newMeeting("Đang họp", map[string]string{"Việc đang họp": ""})
	exec(`UPDATE meetings SET project_id = $2, actual_start_at = $3 WHERE id = $1`, running.ID, project, now.Add(-time.Hour))
	elsewhere, _ := newMeeting("Workspace khác", map[string]string{"Việc workspace khác": ""})
	end(elsewhere, project, now.Add(-2*24*time.Hour))
	beta, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE meetings SET workspace_id = $2 WHERE id = $1`, elsewhere.ID, beta.Workspace.ID)

	// The current meeting has not started: its schedule (tomorrow) is the cut.
	exec(`UPDATE meetings SET status = 'SCHEDULED', actual_start_at = NULL, starts_at = $2, ends_at = $2::timestamptz + interval '1 hour' WHERE id = $1`,
		current.ID, now.Add(24*time.Hour))

	list, err := s.CarriedOverItems(ctx, ub.ID, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := list.Items
	if len(got) != 0 {
		t.Fatalf("a meeting without a project carries nothing over, got %+v", got)
	}

	exec(`UPDATE meetings SET project_id = $2 WHERE id = $1`, current.ID, project)
	list, err = s.CarriedOverItems(ctx, ub.ID, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	got = list.Items
	if list.Total != len(got) {
		t.Fatalf("total = %d, want %d", list.Total, len(got))
	}
	var titles []string
	for _, it := range got {
		titles = append(titles, it.Task.Title)
		if it.MeetingID != earlier.ID || it.MeetingTitle != "Họp tuần trước" || !it.MeetingStartedAt.Valid {
			t.Fatalf("source meeting of %q: %+v", it.Task.Title, it)
		}
		if it.Task.Done || it.Task.AssigneeID == nil || *it.Task.AssigneeID != ub.ID {
			t.Fatalf("task of %q: %+v", it.Task.Title, it.Task)
		}
	}
	want := []string{"In tài liệu", "Gửi báo cáo", "Đặt phòng"}
	if len(titles) != len(want) || titles[0] != want[0] || titles[1] != want[1] || titles[2] != want[2] {
		t.Fatalf("carried over = %v, want %v", titles, want)
	}
	if !got[0].Task.Overdue || got[2].Task.Overdue || got[2].Task.DueDate != nil {
		t.Fatalf("overdue/due: %+v / %+v", got[0].Task, got[2].Task)
	}
	if got[0].ActionItemID == "" || got[0].Task.ID != earlierTasks["In tài liệu"] {
		t.Fatalf("ids: %+v", got[0])
	}

	// Once the meeting itself has started, its actual start is the cut: the
	// earlier meeting still counts, the one "after" it now does too.
	exec(`UPDATE meetings SET status = 'IN_PROGRESS', actual_start_at = $2 WHERE id = $1`, current.ID, now.Add(3*24*time.Hour))
	list, err = s.CarriedOverItems(ctx, ub.ID, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got = list.Items; len(got) != 4 {
		t.Fatalf("after the actual start, want the later meeting's item too: %+v", got)
	}

	if _, err := s.CarriedOverItems(ctx, "01USRNOTAMEMBEROFTHISWS000", current.ID); err == nil {
		t.Fatal("a non-member read the carried-over items")
	}
}
