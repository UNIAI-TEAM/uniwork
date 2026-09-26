package backfill

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The tests seed with raw SQL (no fixture layer exists in testutil) so each
// statement stays minimal: only the columns the scan reads plus the NOT NULLs
// the schema demands.
func insertUser(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'x', $3)`,
		id, id+"@example.com", "U "+id); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
}

func insertOrg(t *testing.T, pool *pgxpool.Pool, org, ws, by string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO organizations (id, slug, name, created_by) VALUES ($1, $2, $3, $4)`,
		org, "org-"+org, "Org "+org, by); err != nil {
		t.Fatalf("seed org %s: %v", org, err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO workspaces (id, slug, name, created_by, organization_id) VALUES ($1, $2, $3, $4, $5)`,
		ws, "ws-"+ws, "Ws "+ws, by, org); err != nil {
		t.Fatalf("seed ws %s: %v", ws, err)
	}
}

func insertAttachment(t *testing.T, pool *pgxpool.Pool, id, org, ws, taskID, key string, staged, withFile bool) {
	t.Helper()
	// Staged rows (task_id and comment_id NULL) break the attachments_check
	// the 192 down migration re-adds; testutil truncates at start, so the
	// last test's rows must not survive. Runs while the lock is still held.
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM attachments`); err != nil {
			t.Logf("cleanup attachments: %v", err)
		}
	})
	ctx := context.Background()
	var expires *time.Time
	if staged {
		e := time.Now().Add(time.Hour)
		expires = &e
	}
	var task *string
	if !staged {
		task = &taskID
	}
	var fileID *string
	if withFile {
		f := "fil_existing_" + id
		fileID = &f
	}
	if _, err := pool.Exec(ctx, `INSERT INTO attachments
		(id, organization_id, workspace_id, task_id, uploader_type, uploader_id,
		 object_key, filename, content_type, size_bytes, expires_at, file_id)
		VALUES ($1,$2,$3,$4,'member',$5,$6,'doc.pdf','application/pdf',10,$7,$8)`,
		id, org, ws, task, "user-1", nilIfEmpty(key), expires, fileID); err != nil {
		t.Fatalf("seed attachment %s: %v", id, err)
	}
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func attKey(ws, id string) string {
	return fmt.Sprintf("workspaces/%s/attachments/%s/doc.pdf", ws, id)
}

func planAttachments(t *testing.T, q *db.Queries) *Report {
	t.Helper()
	rep, err := New(q, nil).Plan(context.Background(), Options{Cohorts: []string{CohortTaskAttachments}, IncludeItems: true})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if len(rep.Cohorts) != 1 {
		t.Fatalf("cohorts = %d, want 1", len(rep.Cohorts))
	}
	return rep
}

func itemByID(cr CohortReport, id string) Item {
	for _, it := range cr.Items {
		if it.SourceID == id {
			return it
		}
	}
	return Item{}
}

// The M1 happy path plus the full class vocabulary in one pass: bound rows
// verify, staged rows verify unclaimed, an existing file_id is skipped, and
// each unsafe shape lands in its reason bucket.
func TestPlanAttachmentsClassification(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertOrg(t, pool, "org-2", "ws-2", "user-1")

	insertAttachment(t, pool, "att-ok", "org-1", "ws-1", "task-1", attKey("ws-1", "att-ok"), false, false)
	insertAttachment(t, pool, "att-staged", "org-1", "ws-1", "task-1", attKey("ws-1", "att-staged"), true, false)
	insertAttachment(t, pool, "att-done", "org-1", "ws-1", "task-1", attKey("ws-1", "att-done"), false, true)
	insertAttachment(t, pool, "att-nokey", "org-1", "ws-1", "task-1", "", false, false)
	insertAttachment(t, pool, "att-wsmismatch", "org-1", "ws-1", "task-1", attKey("ws-2", "att-wsmismatch"), false, false)
	insertAttachment(t, pool, "att-shape", "org-1", "ws-1", "task-1", "avatars/x.png", false, false)
	// Duplicate locator in the same scope: verifies, dedupes to one object.
	insertAttachment(t, pool, "att-dup1", "org-1", "ws-1", "task-1", "workspaces/ws-1/attachments/att-dup1/doc.pdf", false, false)
	insertAttachment(t, pool, "att-dup2", "org-1", "ws-1", "task-2", "workspaces/ws-1/attachments/att-dup1/doc.pdf", false, false)

	rep := planAttachments(t, q)
	cr := rep.Cohorts[0]

	if cr.RowsSeen != 8 {
		t.Fatalf("rows_seen = %d, want 8", cr.RowsSeen)
	}
	if got := itemByID(cr, "att-ok"); got.Class != ClassVerified || !got.Claimed || got.Purpose != "task_attachment" {
		t.Fatalf("att-ok = %+v", got)
	}
	if got := itemByID(cr, "att-staged"); got.Class != ClassVerified || got.Claimed {
		t.Fatalf("att-staged = %+v, want verified unclaimed", got)
	}
	if got := itemByID(cr, "att-done"); got.Class != ClassAlreadyApplied {
		t.Fatalf("att-done = %+v", got)
	}
	if got := itemByID(cr, "att-nokey"); got.Class != ClassUnresolved || got.Reason != "no_locator" {
		t.Fatalf("att-nokey = %+v", got)
	}
	if got := itemByID(cr, "att-wsmismatch"); got.Class != ClassHeld || got.Reason != "workspace_mismatch" {
		t.Fatalf("att-wsmismatch = %+v", got)
	}
	if got := itemByID(cr, "att-shape"); got.Class != ClassHeld || got.Reason != "unrecognized_key_shape" {
		t.Fatalf("att-shape = %+v", got)
	}
	for _, id := range []string{"att-dup1", "att-dup2"} {
		if got := itemByID(cr, id); got.Class != ClassVerified || !got.SharedLocator {
			t.Fatalf("%s = %+v, want verified shared", id, got)
		}
	}
	if cr.Verified != 4 || cr.Held != 2 || cr.Unresolved != 1 || cr.AlreadyApplied != 1 {
		t.Fatalf("counts = %+v", cr)
	}
	if cr.DistinctObjects != 3 || cr.DuplicateRefs != 1 {
		t.Fatalf("dedup: distinct=%d dup=%d, want 3/1", cr.DistinctObjects, cr.DuplicateRefs)
	}
}

// A second tenant's row pointing at a key that embeds ws-1 cannot verify —
// the key's own workspace evidence contradicts the row — so it lands held
// (workspace_mismatch) and is never merged into the first tenant's file.
func TestPlanAttachmentsCrossScopeShare(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertOrg(t, pool, "org-2", "ws-2", "user-1")

	insertAttachment(t, pool, "att-a", "org-1", "ws-1", "task-1", attKey("ws-1", "att-a"), false, false)
	// Same physical key, a second tenant's row whose workspace differs from
	// the one the key itself names.
	insertAttachment(t, pool, "att-b", "org-2", "ws-2", "task-2", attKey("ws-1", "att-a"), false, false)

	rep := planAttachments(t, q)
	cr := rep.Cohorts[0]
	if got := itemByID(cr, "att-a"); got.Class != ClassVerified {
		t.Fatalf("att-a = %+v, want verified", got)
	}
	if got := itemByID(cr, "att-b"); got.Class != ClassHeld || got.Reason != "workspace_mismatch" {
		t.Fatalf("att-b = %+v, want held workspace_mismatch", got)
	}
	if cr.Verified != 1 || cr.Held != 1 {
		t.Fatalf("counts = %+v", cr)
	}
}

// The shared-locator pass itself: two verified items on one locator with
// different resolved scopes are held on both sides — never merged.
func TestMarkSharedLocatorsHoldsConflicts(t *testing.T) {
	rep := &Report{Command: "plan", Cohorts: []CohortReport{{
		Name: CohortTaskAttachments,
		Items: []Item{
			{Cohort: CohortTaskAttachments, SourceID: "a", Class: ClassVerified,
				ObjectKey: "k", OrganizationID: "o1", WorkspaceID: "w1"},
			{Cohort: CohortTaskAttachments, SourceID: "b", Class: ClassVerified,
				ObjectKey: "k", OrganizationID: "o2", WorkspaceID: "w2"},
			{Cohort: CohortTaskAttachments, SourceID: "c", Class: ClassVerified,
				ObjectKey: "k", OrganizationID: "o2", WorkspaceID: "w2"},
			{Cohort: CohortTaskAttachments, SourceID: "d", Class: ClassVerified,
				ObjectKey: "other", OrganizationID: "o1", WorkspaceID: "w1"},
		},
	}}}
	markSharedLocators(rep)
	retally(&rep.Cohorts[0])
	cr := rep.Cohorts[0]
	for _, id := range []string{"a", "b", "c"} {
		if got := itemByID(cr, id); got.Class != ClassHeld || got.Reason != "cross_scope_shared_locator" {
			t.Fatalf("%s = %+v, want held cross_scope_shared_locator", id, got)
		}
	}
	if got := itemByID(cr, "d"); got.Class != ClassVerified {
		t.Fatalf("d = %+v, want verified", got)
	}
	if cr.Held != 3 || cr.Verified != 1 || cr.SharedLocators != 1 || cr.DistinctObjects != 1 {
		t.Fatalf("counts = %+v", cr)
	}
}

// plan is read-only: rerunning yields the same verdicts and the table is
// untouched — this is the determinism the report contract requires.
func TestPlanIsDeterministicAndReadOnly(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertAttachment(t, pool, "att-ok", "org-1", "ws-1", "task-1", attKey("ws-1", "att-ok"), false, false)

	r1 := planAttachments(t, q)
	r2 := planAttachments(t, q)
	if r1.Cohorts[0].RowsSeen != r2.Cohorts[0].RowsSeen || r1.Cohorts[0].Verified != r2.Cohorts[0].Verified {
		t.Fatalf("plan not deterministic: %+v vs %+v", r1.Cohorts[0], r2.Cohorts[0])
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM file_backfill_runs`).Scan(&n); err != nil {
		t.Fatalf("count runs: %v", err)
	}
	if n != 0 {
		t.Fatalf("plan wrote %d run rows, want 0", n)
	}
}
