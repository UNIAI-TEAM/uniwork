package backfill

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M2 dedupe across purposes: a task attachment and a comment attachment naming
// the same object mint one files row and ONE receipt session (the unique
// index caps sessions per file). Verify must accept that session for both
// references — purpose is the first writer's fact, not the file's.
func TestVerifySharedLocatorCrossPurposeIsConsistent(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	ctx := context.Background()
	key := "workspaces/ws-1/attachments/att-shared/file.pdf"
	insertAttachment(t, pool, "att-plain", "org-1", "ws-1", "task-1", key, false, false)
	// Comment-bound twin: same locator, different resolved purpose.
	if _, err := pool.Exec(ctx, `INSERT INTO attachments
		(id, organization_id, workspace_id, task_id, comment_id, uploader_type, uploader_id,
		 object_key, filename, content_type, size_bytes)
		VALUES ('att-cmt','org-1','ws-1',NULL,'cmt-1','member','user-1',$1,'file.pdf','application/pdf',10)`, key); err != nil {
		t.Fatalf("seed comment attachment: %v", err)
	}

	fs := &fakeStat{}
	fs.seed("local", "", key, 10)
	eng := applyEngine(pool, fs)
	if _, err := eng.Apply(ctx, ApplyOptions{Options: Options{Cohorts: []string{CohortTaskAttachments}}}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if got := countRows(t, pool, "files"); got != 1 {
		t.Fatalf("files = %d, want 1", got)
	}
	if got := countRows(t, pool, "file_upload_sessions"); got != 1 {
		t.Fatalf("sessions = %d, want 1 (one receipt per file)", got)
	}

	vrep, err := eng.Verify(ctx, VerifyOptions{Options: Options{
		Cohorts: []string{CohortTaskAttachments}, IncludeItems: true,
	}})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	for _, id := range []string{"att-plain", "att-cmt"} {
		if got := itemByID(vrep.Cohorts[0], id); got.Verdict != verdictConsistent {
			t.Fatalf("%s verdict %q, want consistent", id, got.Verdict)
		}
	}
}

// locator_mismatch is the post-apply tamper signal: the business row's locator
// column was edited after apply wrote the files row. The item stays
// already_applied but verify must flag it.
func TestVerifyLocatorMismatchOnTamperedKey(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertAttachment(t, pool, "att-t", "org-1", "ws-1", "task-1", attKey("ws-1", "att-t"), false, false)

	fs := &fakeStat{}
	fs.seed("local", "", attKey("ws-1", "att-t"), 4)
	eng := applyEngine(pool, fs)
	ctx := context.Background()
	if _, err := eng.Apply(ctx, ApplyOptions{Options: Options{Cohorts: []string{CohortTaskAttachments}}}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// Someone edits the legacy locator after apply — the files row still names
	// the object the run wrote.
	if _, err := pool.Exec(ctx,
		`UPDATE attachments SET object_key='workspaces/ws-1/attachments/att-t/other.pdf' WHERE id='att-t'`); err != nil {
		t.Fatal(err)
	}
	vrep, err := eng.Verify(ctx, VerifyOptions{Options: Options{
		Cohorts: []string{CohortTaskAttachments}, IncludeItems: true,
	}})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got := itemByID(vrep.Cohorts[0], "att-t"); got.Verdict != verdictLocatorMismatch {
		t.Fatalf("verdict = %q, want locator_mismatch", got.Verdict)
	}
}

// A row carrying file_id whose own locator contradicts it (held-class
// evidence) is the anomaly unexpected_reference exists to name.
func TestVerifyUnexpectedReferenceOnHeldRow(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertOrg(t, pool, "org-2", "ws-2", "user-1")
	// Key embeds ws-2 but the row belongs to ws-1 — held, AND it carries a
	// file_id nobody can account for.
	insertAttachment(t, pool, "att-weird", "org-1", "ws-1", "task-1", attKey("ws-2", "att-weird"), false, true)

	eng := applyEngine(pool, &fakeStat{})
	plan, err := eng.Plan(context.Background(), Options{Cohorts: []string{CohortTaskAttachments}, IncludeItems: true})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	got := itemByID(plan.Cohorts[0], "att-weird")
	if got.Class != ClassHeld || got.FileID == "" {
		t.Fatalf("plan = %+v, want held with file_id evidence", got)
	}
	vrep, err := eng.Verify(context.Background(), VerifyOptions{Options: Options{
		Cohorts: []string{CohortTaskAttachments}, IncludeItems: true,
	}})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got := itemByID(vrep.Cohorts[0], "att-weird"); got.Verdict != verdictUnexpectedReference {
		t.Fatalf("verdict = %q, want unexpected_reference", got.Verdict)
	}
}

// A claimed session on the file that names a different scope is
// session_scope_mismatch — distinct from having no claimed session at all.
func TestVerifySessionScopeMismatch(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertOrg(t, pool, "org-2", "ws-2", "user-1")
	insertAttachment(t, pool, "att-s", "org-1", "ws-1", "task-1", attKey("ws-1", "att-s"), false, false)

	fs := &fakeStat{}
	fs.seed("local", "", attKey("ws-1", "att-s"), 4)
	eng := applyEngine(pool, fs)
	ctx := context.Background()
	if _, err := eng.Apply(ctx, ApplyOptions{Options: Options{Cohorts: []string{CohortTaskAttachments}}}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// Rewrite the session's workspace so the receipt covers another scope.
	if _, err := pool.Exec(ctx,
		`UPDATE file_upload_sessions SET workspace_id='ws-2'`); err != nil {
		t.Fatal(err)
	}
	vrep, err := eng.Verify(ctx, VerifyOptions{Options: Options{
		Cohorts: []string{CohortTaskAttachments}, IncludeItems: true,
	}})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got := itemByID(vrep.Cohorts[0], "att-s"); got.Verdict != verdictSessionScopeMismatch {
		t.Fatalf("verdict = %q, want session_scope_mismatch", got.Verdict)
	}
}

// FS-native rows carry file_id with no legacy locator — plan must report
// already_applied and verify consistent, not flag them as anomalies.
func TestVerifyFSNativeRowsAreApplied(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	ctx := context.Background()
	// A bound FS-native attachment and a still-staged one (expires_at set).
	for _, tc := range []struct {
		id     string
		staged bool
	}{
		{"att-fs", false},
		{"att-fs-staged", true},
	} {
		expires := any(nil)
		if tc.staged {
			expires = time.Now().Add(time.Hour)
		}
		task := any("task-1")
		if tc.staged {
			task = nil
		}
		if _, err := pool.Exec(ctx, `INSERT INTO attachments
			(id, organization_id, workspace_id, task_id, uploader_type, uploader_id,
			 filename, content_type, size_bytes, expires_at, file_id)
			VALUES ($1,'org-1','ws-1',$2,'member','user-1','x.pdf','application/pdf',1,$3,$4)`,
			tc.id, task, expires, "fil_"+tc.id); err != nil {
			t.Fatalf("seed %s: %v", tc.id, err)
		}
	}
	rep, err := New(db.New(pool), nil).Plan(ctx, Options{Cohorts: []string{CohortTaskAttachments}, IncludeItems: true})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for _, id := range []string{"att-fs", "att-fs-staged"} {
		if got := itemByID(rep.Cohorts[0], id); got.Class != ClassAlreadyApplied {
			t.Fatalf("%s = %+v, want already_applied (FS-native)", id, got)
		}
	}
}

// verify --run must name a live apply run: a typo'd id or a rolled-back run
// refuses loudly instead of printing a misleading report.
func TestVerifyRefusesUnknownAndRolledBackRuns(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertAttachment(t, pool, "att-r", "org-1", "ws-1", "task-1", attKey("ws-1", "att-r"), false, false)
	fs := &fakeStat{}
	fs.seed("local", "", attKey("ws-1", "att-r"), 4)
	eng := applyEngine(pool, fs)
	ctx := context.Background()

	if _, err := eng.Verify(ctx, VerifyOptions{RunID: "01M3NOPE"}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("unknown run err = %v", err)
	}
	rep, err := eng.Apply(ctx, ApplyOptions{Options: Options{Cohorts: []string{CohortTaskAttachments}}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if _, err := eng.Rollback(ctx, rep.RunID); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if _, err := eng.Verify(ctx, VerifyOptions{
		Options: Options{Cohorts: []string{CohortTaskAttachments}},
		RunID:   rep.RunID,
	}); err == nil || !strings.Contains(err.Error(), "rolled back") {
		t.Fatalf("rolled-back run err = %v", err)
	}
}

// Rollback restores an adopted pre-existing pending row to its as-was state
// instead of leaving it ready — the snapshot rides in the item's details.
func TestRollbackRestoresAdoptedPendingFile(t *testing.T) {
	pool := testutil.DB(t)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertAttachment(t, pool, "att-p", "org-1", "ws-1", "task-1", attKey("ws-1", "att-p"), false, false)
	ctx := context.Background()
	// A pending files row already claims the locator — e.g. an interrupted
	// upload the legacy row's key collides with.
	if _, err := pool.Exec(ctx, `INSERT INTO files
		(id, organization_id, storage, object_key, original_filename, status)
		VALUES ('fil-pend','org-1','local',$1,'original.pdf','pending')`, attKey("ws-1", "att-p")); err != nil {
		t.Fatalf("seed pending file: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM files`); err != nil {
			t.Logf("cleanup files: %v", err)
		}
	})

	fs := &fakeStat{}
	fs.seed("local", "", attKey("ws-1", "att-p"), 4)
	eng := applyEngine(pool, fs)
	rep, err := eng.Apply(ctx, ApplyOptions{Options: Options{Cohorts: []string{CohortTaskAttachments}}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM files WHERE id='fil-pend'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "ready" {
		t.Fatalf("adopted file status %q, want ready", status)
	}

	if _, err := eng.Rollback(ctx, rep.RunID); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	var readyAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, ready_at FROM files WHERE id='fil-pend'`).Scan(&status, &readyAt); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || readyAt != nil {
		t.Fatalf("restored file status=%q ready_at=%v, want pending/NULL", status, readyAt)
	}
	var fid *string
	if err := pool.QueryRow(ctx, `SELECT file_id FROM attachments WHERE id='att-p'`).Scan(&fid); err != nil {
		t.Fatal(err)
	}
	if fid != nil {
		t.Fatalf("file_id survived rollback: %v", *fid)
	}
}
