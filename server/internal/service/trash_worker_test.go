package service

import (
	"context"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// trashWorkerClock is a sweep clock just past the 30 days of anything trashed
// during the test.
func trashWorkerClock() func() time.Time {
	now := time.Now().Add(trashRetention + time.Hour)
	return func() time.Time { return now }
}

func trashedProject(t *testing.T, s *TaskService, ua db.User, w db.Workspace, title string) db.Project {
	t.Helper()
	ctx := context.Background()
	p, err := s.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.TrashProject(ctx, Human(ua.ID), w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPurgeExpiredRemovesOnlyRowsPastTheirDate(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	// A batch of parent and child: both expire, the sweep may reach either first.
	parent := trashTestTask(t, s, ua, w, "", "Hết hạn")
	child := trashTestTask(t, s, ua, w, parent.ID, "Con hết hạn")
	if _, err := s.Trash(ctx, actor, parent.ID); err != nil {
		t.Fatal(err)
	}
	fresh := trashTestTask(t, s, ua, w, "", "Chưa hết hạn")
	if _, err := s.Trash(ctx, actor, fresh.ID); err != nil {
		t.Fatal(err)
	}
	live := trashTestTask(t, s, ua, w, "", "Còn sống")

	old, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án hết hạn"})
	if err != nil {
		t.Fatal(err)
	}
	// A task of the expired project lives on, unlinked.
	orphan := projectTrashTask(t, s, ua, w, old.ID, "Task của dự án hết hạn")
	if err := s.TrashProject(ctx, actor, w.ID, old.ID); err != nil {
		t.Fatal(err)
	}
	kept := trashedProject(t, s, ua, w, "Dự án chưa hết hạn")

	worker := NewTrashWorker(s.pool, s.q, s, trashWorkerClock())
	later := worker.now().Add(trashRetention)
	if _, err := s.pool.Exec(ctx, `UPDATE tasks SET purge_after = $1 WHERE id = $2`, later, fresh.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE projects SET purge_after = $1 WHERE id = $2`, later, kept.ID); err != nil {
		t.Fatal(err)
	}

	tasks, projects, err := worker.PurgeExpired(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if tasks != 2 || projects != 1 {
		t.Fatalf("purged %d tasks and %d projects, want 2 and 1", tasks, projects)
	}
	for _, id := range []string{parent.ID, child.ID} {
		if n := projectRows(t, s, `SELECT count(*) FROM tasks WHERE id = $1`, id); n != 0 {
			t.Fatalf("expired task %s still there", id)
		}
	}
	if row := rawTask(t, s, fresh.ID); !row.TrashedAt.Valid {
		t.Fatalf("task not yet expired left the trash: %+v", row.TrashedAt)
	}
	if _, err := s.Get(ctx, ua.ID, live.ID); err != nil {
		t.Fatalf("live task: %v", err)
	}
	if n := projectRows(t, s, `SELECT count(*) FROM projects WHERE id = $1`, old.ID); n != 0 {
		t.Fatal("expired project still there")
	}
	if p := rawProject(t, s, w, kept.ID); !p.TrashedAt.Valid {
		t.Fatal("project not yet expired left the trash")
	}
	if row := rawTask(t, s, orphan.ID); row.TrashedAt.Valid || row.ProjectID.Valid || row.TrashedProjectID.Valid {
		t.Fatalf("task of the purged project = trashed %v project %v trashed_project %v, want live and unlinked",
			row.TrashedAt.Valid, row.ProjectID, row.TrashedProjectID)
	}
}

// Review Focus 3: a restore that commits after the sweep read its page and
// before it locked the row wins; the sweep sees the row restored under its
// lock and leaves it.
func TestPurgeSkipsRowRestoredUnderLock(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	task := trashTestTask(t, s, ua, w, "", "Khôi phục giữa chừng")
	if _, err := s.Trash(ctx, actor, task.ID); err != nil {
		t.Fatal(err)
	}
	p := trashedProject(t, s, ua, w, "Dự án khôi phục giữa chừng")

	worker := NewTrashWorker(s.pool, s.q, s, trashWorkerClock())
	worker.afterPage = func(kind string) {
		var err error
		switch kind {
		case "task":
			_, err = s.Restore(ctx, actor, task.ID)
		case "project":
			err = s.RestoreProject(ctx, actor, w.ID, p.ID)
		}
		if err != nil {
			t.Errorf("restore %s: %v", kind, err)
		}
	}
	tasks, projects, err := worker.PurgeExpired(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if tasks != 0 || projects != 0 {
		t.Fatalf("purged %d tasks and %d projects, want none", tasks, projects)
	}
	if _, err := s.Get(ctx, ua.ID, task.ID); err != nil {
		t.Fatalf("restored task: %v", err)
	}
	if got := rawProject(t, s, w, p.ID); got.TrashedAt.Valid {
		t.Fatal("restored project is back in the trash")
	}
	if n := auditRows(t, s, "task.deleted", task.ID) + auditRows(t, s, "project.deleted", p.ID); n != 0 {
		t.Fatalf("delete audit rows = %d, want 0", n)
	}
}

func TestPurgeUsesTheSystemActor(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task := trashTestTask(t, s, ua, w, "", "Dọn bởi hệ thống")
	if _, err := s.Trash(ctx, Human(ua.ID), task.ID); err != nil {
		t.Fatal(err)
	}
	p := trashedProject(t, s, ua, w, "Dự án dọn bởi hệ thống")

	if _, _, err := NewTrashWorker(s.pool, s.q, s, trashWorkerClock()).PurgeExpired(ctx); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ action, id, job string }{
		{"task.deleted", task.ID, "tasks.purge"},
		{"project.deleted", p.ID, "projects.purge"},
	} {
		var kind, actorID string
		if err := s.pool.QueryRow(ctx,
			`SELECT actor_kind, actor_id FROM audit_events WHERE action = $1 AND resource_id = $2`,
			c.action, c.id).Scan(&kind, &actorID); err != nil {
			t.Fatalf("%s audit row: %v", c.action, err)
		}
		if kind != "system" || actorID != c.job {
			t.Fatalf("%s actor = %s/%s, want system/%s", c.action, kind, actorID, c.job)
		}
	}
}
