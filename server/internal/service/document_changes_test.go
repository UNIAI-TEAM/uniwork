package service

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// G5-01a acceptance (G5-A01) on the test database: a cold-start snapshot is
// stable across pages under concurrent writers, a swept or expired snapshot
// answers 410 and never a short page, a foreign cursor answers 400 without
// naming the scope, and office_sync_feed off answers office_capability_off.

type changeWorld struct {
	f   *docPermFixture
	tn  docTenant
	svc *DocumentChangesService
	now time.Time
}

func newChangeWorld(t *testing.T, slug string, flags *featureflag.Service) *changeWorld {
	t.Helper()
	f := newDocPermFixture(t)
	w := &changeWorld{f: f, tn: f.tenant(t, slug), now: time.Now()}
	w.svc = NewDocumentChangesService(f.svc, flags, config.Config{
		JWTSecret: "change-feed-test-secret-0123456789", DesktopAuthDeploymentIDs: []string{"dep-test"},
	})
	w.svc.SetClock(func() time.Time { return w.now })
	return w
}

func (w *changeWorld) docs(t *testing.T, n int, visibility string) []db.Document {
	t.Helper()
	out := make([]db.Document, n)
	for i := range out {
		out[i] = w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: visibility, createdBy: w.tn.member.ID})
	}
	return out
}

func (w *changeWorld) list(t *testing.T, user, cursor string, limit int) (DocumentChangePage, error) {
	t.Helper()
	return w.svc.List(w.f.ctx, Human(user), w.tn.wsA, DocumentChangeListInput{Cursor: cursor, Limit: limit})
}

// drain pages from a cold start until the last page, calling between after
// every page but the last.
func (w *changeWorld) drain(t *testing.T, user string, limit int, between func(page int)) ([]DocumentChange, DocumentChangePage) {
	t.Helper()
	var all []DocumentChange
	cursor := ""
	for i := 0; ; i++ {
		page, err := w.list(t, user, cursor, limit)
		if err != nil {
			t.Fatalf("page %d: %v", i, err)
		}
		if page.Phase != "snapshot" || page.NextCursor == "" {
			t.Fatalf("page %d = %+v", i, page)
		}
		all = append(all, page.Changes...)
		if !page.HasMore {
			return all, page
		}
		if len(page.Changes) != limit {
			t.Fatalf("page %d holds %d rows with more to come, want %d", i, len(page.Changes), limit)
		}
		if between != nil {
			between(i)
		}
		cursor = page.NextCursor
		if i > 100 {
			t.Fatal("feed never ended")
		}
	}
}

func TestDocumentChangesSnapshotIsStableUnderConcurrentWriters(t *testing.T) {
	w := newChangeWorld(t, "chgstable", nil)
	docs := w.docs(t, 7, "workspace")
	want := map[string]int64{}
	for _, d := range docs {
		want[d.ID] = d.Revision
	}
	var afterOpen []string
	all, last := w.drain(t, w.tn.member.ID, 2, func(page int) {
		if page != 0 {
			return
		}
		// Writers between page 1 and page 2: bump every revision, archive one
		// document, add a new one. None of it may show in this snapshot.
		if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET revision = revision + 10 WHERE workspace_id = $1`, w.tn.wsA); err != nil {
			t.Fatal(err)
		}
		if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, docs[6].ID); err != nil {
			t.Fatal(err)
		}
		afterOpen = append(afterOpen, w.docs(t, 1, "workspace")[0].ID)
	})
	seen := map[string]bool{}
	for _, c := range all {
		if seen[c.DocumentID] {
			t.Errorf("document %s delivered twice", c.DocumentID)
		}
		seen[c.DocumentID] = true
		rev, ok := want[c.DocumentID]
		if !ok {
			t.Errorf("document %s is not in the snapshot taken at open", c.DocumentID)
			continue
		}
		if c.Revision != rev {
			t.Errorf("document %s revision = %d, want the value at open %d", c.DocumentID, c.Revision, rev)
		}
		if c.Kind == "" {
			t.Errorf("document %s has no kind", c.DocumentID)
		}
	}
	if len(seen) != len(want) {
		t.Fatalf("snapshot delivered %d documents, want %d", len(seen), len(want))
	}
	for _, id := range afterOpen {
		if seen[id] {
			t.Errorf("document %s created after the snapshot opened was delivered", id)
		}
	}
	// The last page hands out a feed cursor whose high-water mark excludes
	// every commit after the snapshot: G5-01b continues from it. The check is
	// a real concurrent transaction (BE-F1-2): its xid8 is fixed before the
	// snapshot opens, so the mark must not see it.
	claims, err := w.svc.codec.verify(last.NextCursor, changeCursorScope{
		deployment: "dep-test", userID: w.tn.member.ID, organization: w.tn.orgID, workspace: w.tn.wsA,
	}, w.now)
	if err != nil || claims.Phase != changeCursorPhaseFeed || claims.HighWater == "" {
		t.Fatalf("last cursor = %+v, %v", claims, err)
	}
	if hwmSeesTxn(t, w, claims.HighWater, concurrentXID(t, w)) {
		t.Fatal("a transaction open when the snapshot began is visible in its high-water mark")
	}
	if _, err := w.list(t, w.tn.member.ID, last.NextCursor, 2); !codedIs(err, "unsupported_operation") {
		t.Fatalf("feed cursor before G5-01b: %v, want unsupported_operation", err)
	}
}

// concurrentXID opens a real transaction, keeps it open for the rest of the
// test and answers its xid8: a transaction that was in progress when the
// high-water mark was taken must never be visible in it.
func concurrentXID(t *testing.T, w *changeWorld) string {
	t.Helper()
	tx, err := w.f.pool.Begin(w.f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(w.f.ctx) })
	var xid string
	if err := tx.QueryRow(w.f.ctx, `SELECT pg_current_xact_id()::text`).Scan(&xid); err != nil {
		t.Fatal(err)
	}
	return xid
}

func hwmSeesTxn(t *testing.T, w *changeWorld, hwm, xid string) bool {
	t.Helper()
	var visible bool
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT pg_visible_in_snapshot($1::xid8, $2::pg_snapshot)`, xid, hwm).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	return visible
}

// TestDocumentChangesHighWaterHandoffCommitsMidBuild is the BE-F1-2 guard: a
// writer that commits WHILE the snapshot is being built must sit on one side
// of the high-water mark, exactly. The snapshot is taken at the mark, so the
// row is in the snapshot IF AND ONLY IF the mark sees the writer's xid8:
// visible but missing loses the change (G5-01b de-duplicates it away),
// present but invisible delivers it twice. The writer's document is inserted
// before its commit and its commit is held behind the row lock the item read
// blocks on, so the interleave is deterministic.
//
// The test fails on a READ COMMITTED openSnapshot (the regression the finding
// names): there the item read re-snapshots after the writer commits, so the
// live document lands in the snapshot while the high-water mark still cannot
// see the writer - present but invisible.
func TestDocumentChangesHighWaterHandoffCommitsMidBuild(t *testing.T) {
	w := newChangeWorld(t, "chghwm", nil)
	base := w.docs(t, 1, "workspace")[0]

	writer, err := w.f.pool.Begin(w.f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = writer.Rollback(w.f.ctx) }()

	type opened struct {
		snapshotID string
		orgID      string
		err        error
	}
	openedCh := make(chan opened, 1)
	go func() {
		snapshotID, orgID, err := w.svc.openSnapshot(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA)
		openedCh <- opened{snapshotID: snapshotID, orgID: orgID, err: err}
	}()

	// The build must not finish before the writer commits: lock the row its
	// item read scans, then park on that lock - the INSERT ... SELECT waits.
	if _, err := writer.Exec(w.f.ctx, `UPDATE documents SET revision = revision + 1 WHERE id = $1`, base.ID); err != nil {
		t.Fatal(err)
	}
	midBuildID := util.NewID()
	if _, err := writer.Exec(w.f.ctx,
		`INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility, created_by, updated_by)
		 VALUES ($1, $2, $3, 'page', 'committed mid-build', 'workspace', $4, $4)`,
		midBuildID, w.tn.orgID, w.tn.wsA, w.tn.member.ID); err != nil {
		t.Fatal(err)
	}
	var xid string
	if err := writer.QueryRow(w.f.ctx, `SELECT pg_current_xact_id()::text`).Scan(&xid); err != nil {
		t.Fatal(err)
	}
	waitForBlockedChangeBuild(t, w)
	if err := writer.Commit(w.f.ctx); err != nil {
		t.Fatal(err)
	}
	got := <-openedCh
	if got.err != nil {
		t.Fatalf("openSnapshot: %v", got.err)
	}

	page, err := w.list(t, w.tn.member.ID, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.HasMore {
		t.Fatal("expected the whole snapshot on one page")
	}
	claims, err := w.svc.codec.verify(page.NextCursor, changeCursorScope{
		deployment: "dep-test", userID: w.tn.member.ID, organization: got.orgID, workspace: w.tn.wsA,
	}, w.now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.HighWater == "" {
		t.Fatalf("feed cursor carries no high-water mark: %+v", claims)
	}
	inSnapshot := false
	for _, c := range page.Changes {
		if c.DocumentID == midBuildID {
			inSnapshot = true
		}
	}
	hwmSees := hwmSeesTxn(t, w, claims.HighWater, xid)
	switch {
	case hwmSees && !inSnapshot:
		t.Fatal("the high-water mark sees the writer but the snapshot misses it: G5-01b de-duplicates the change away (lost update)")
	case !hwmSees && inSnapshot:
		t.Fatal("the snapshot holds the writer but the high-water mark cannot see it: the change would be delivered twice")
	}
	// This writer commits after the high-water mark was taken, so the correct
	// side is: absent from the snapshot and invisible in the mark, delivered
	// by the incremental feed (G5-01b) once it continues from the mark.
	if inSnapshot || hwmSees {
		t.Fatalf("a commit after the high-water mark must be on neither side: in snapshot=%v, hwm sees=%v", inSnapshot, hwmSees)
	}
}

// waitForBlockedChangeBuild polls until the snapshot row of the parked build
// exists, i.e. its transaction is past CurrentChangeHighWater and is inside
// the item insert (which blocks on the held row lock).
func waitForBlockedChangeBuild(t *testing.T, w *changeWorld) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := w.f.pool.QueryRow(w.f.ctx, `SELECT count(*) FROM document_change_snapshots`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the snapshot build never reached its item insert")
}

// TestDocumentChangesPageReadSurvivesConcurrentSweep is the BE-F1-3 guard: a
// sweep that commits between a page's snapshot-row read and its item read
// must never turn the page short. The page answers the complete expected
// rows, or runs into the expiry check and answers 410 - never a short or
// empty 200.
//
// The hook fires exactly in that window (the transaction snapshot is fixed by
// the row read) and runs the sweep the worker runs - the same three
// statements in one transaction. The snapshot is expired first, so an
// implementation that re-checked expiry between those statements answers 410:
// that is inside the contract too.
//
// The test fails on a READ COMMITTED page read: there the item read takes a
// fresh snapshot and sees the swept-away items as zero rows.
func TestDocumentChangesPageReadSurvivesConcurrentSweep(t *testing.T) {
	w := newChangeWorld(t, "chgmid", nil)
	docs := w.docs(t, 4, "workspace")
	want := map[string]int64{}
	for _, d := range docs {
		want[d.ID] = d.Revision
	}
	page, err := w.list(t, w.tn.member.ID, "", 2)
	if err != nil || !page.HasMore {
		t.Fatalf("page 1 = %+v, %v", page, err)
	}
	// Expire the snapshot without deleting it: the page read must still see
	// the row (it already read it) and its items; the DELETE below models the
	// sweep landing between the two statements.
	if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE document_change_snapshots SET expires_at = now() - interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	w.svc.pageItemHook = func() {
		w.svc.pageItemHook = nil
		if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM document_change_snapshot_items`); err != nil {
			t.Fatal(err)
		}
	}
	page2, err := w.list(t, w.tn.member.ID, page.NextCursor, 2)
	if err != nil {
		if !codedIs(err, "change_cursor_expired") {
			t.Fatalf("page 2 after the sweep committed mid-read: %v, want the page or 410", err)
		}
		return
	}
	if len(page2.Changes) != 2 {
		t.Fatalf("page 2 = %d rows; a sweep committing mid-read must not shorten the page", len(page2.Changes))
	}
	for _, c := range page2.Changes {
		if c.Revision != want[c.DocumentID] {
			t.Errorf("document %s revision = %d, want %d", c.DocumentID, c.Revision, want[c.DocumentID])
		}
	}
}

// TestDocumentChangesMembershipRevokedMidBuildLeavesNoSnapshot is the BE-F1-4
// guard: a role revoked after the caller-side gate read but before the
// snapshot's item insert must be seen by the in-transaction gate re-read, so
// no snapshot is materialised under stale privileges. The hook fires between
// the two reads, exactly the window the finding names.
func TestDocumentChangesMembershipRevokedMidBuildLeavesNoSnapshot(t *testing.T) {
	w := newChangeWorld(t, "chgtoctou", nil)
	open := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", createdBy: w.tn.creator.ID})
	restricted := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.creator.ID})

	// Control first: without the revoke, the member sees the open document
	// (and not the restricted one).
	control, err := w.list(t, w.tn.member.ID, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(control.Changes) != 1 || control.Changes[0].DocumentID != open.ID {
		t.Fatalf("control snapshot = %+v, want exactly the open document", control.Changes)
	}

	w.svc.afterScopeHook = func() {
		w.svc.afterScopeHook = nil
		if _, err := w.f.pool.Exec(w.f.ctx,
			`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
			w.tn.wsA, w.tn.member.ID); err != nil {
			t.Fatal(err)
		}
	}
	page, err := w.list(t, w.tn.member.ID, "", 10)
	if err == nil {
		for _, c := range page.Changes {
			if c.DocumentID == restricted.ID {
				t.Fatal("a role revoked mid-build still materialised a snapshot holding the restricted document")
			}
		}
		t.Fatal("a role revoked mid-build still opened a snapshot")
	}
	var n int
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT count(*) FROM document_change_snapshots WHERE created_by = $1`, w.tn.member.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("the refused build left %d snapshots behind", n)
	}
}

func TestDocumentChangesSnapshotFollowsReadAccess(t *testing.T) {
	w := newChangeWorld(t, "chgacl", nil)
	open := w.docs(t, 2, "workspace")
	restricted := w.docs(t, 1, "restricted")[0]
	w.f.doc(t, w.tn, docSpec{ws: w.tn.wsB, visibility: "workspace", createdBy: w.tn.bMember.ID})

	member, _ := w.drain(t, w.tn.member.ID, 50, nil)
	if len(member) != len(open) {
		t.Fatalf("member sees %d documents, want %d (restricted and workspace B left out)", len(member), len(open))
	}
	for _, c := range member {
		if c.DocumentID == restricted.ID {
			t.Fatal("member sees a restricted document")
		}
	}
	admin, _ := w.drain(t, w.tn.wsAdmin.ID, 50, nil)
	if len(admin) != len(open)+1 {
		t.Fatalf("workspace admin sees %d documents, want %d", len(admin), len(open)+1)
	}
	if _, err := w.list(t, w.tn.outsider.ID, "", 10); err == nil {
		t.Fatal("organization member outside the workspace opened a snapshot")
	}
}

func TestDocumentChangesEmptyWorkspace(t *testing.T) {
	w := newChangeWorld(t, "chgempty", nil)
	page, err := w.list(t, w.tn.member.ID, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Changes) != 0 || page.HasMore || page.NextCursor == "" {
		t.Fatalf("empty workspace page = %+v, want no rows, no more, a feed cursor", page)
	}
}

func TestDocumentChangesSweepBetweenPagesAnswersGone(t *testing.T) {
	w := newChangeWorld(t, "chgsweep", nil)
	w.docs(t, 3, "workspace")
	page, err := w.list(t, w.tn.member.ID, "", 1)
	if err != nil || !page.HasMore {
		t.Fatalf("page 1 = %+v, %v", page, err)
	}
	sweep := w.svc.NewSnapshotSweeper(nil)
	sweep.SetClock(func() time.Time { return w.now.Add(w.svc.SnapshotTTL() + time.Second) })
	snapshots, items, err := sweep.Sweep(w.f.ctx)
	if err != nil || snapshots != 1 || items != 3 {
		t.Fatalf("sweep = %d snapshots, %d items, %v; want 1, 3", snapshots, items, err)
	}
	// The cursor itself is still within its expiry: the 410 comes from the
	// swept snapshot, never a short or empty page.
	page2, err := w.list(t, w.tn.member.ID, page.NextCursor, 1)
	if !codedIs(err, "change_cursor_expired") {
		t.Fatalf("page 2 after the sweep = %+v, %v; want change_cursor_expired", page2, err)
	}
	var left int
	if err := w.f.pool.QueryRow(w.f.ctx, `SELECT count(*) FROM document_change_snapshot_items`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("items left after the sweep = %d, %v", left, err)
	}
}

func TestDocumentChangesSweepKeepsLiveSnapshots(t *testing.T) {
	w := newChangeWorld(t, "chgkeep", nil)
	w.docs(t, 2, "workspace")
	page, err := w.list(t, w.tn.member.ID, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	snapshots, _, err := w.svc.NewSnapshotSweeper(nil).Sweep(w.f.ctx)
	if err != nil || snapshots != 0 {
		t.Fatalf("sweep removed %d live snapshots, %v", snapshots, err)
	}
	if _, err := w.list(t, w.tn.member.ID, page.NextCursor, 1); err != nil {
		t.Fatalf("page 2 of a live snapshot: %v", err)
	}
}

// changeSweepRecorder is the DocumentChangeSweepMetrics fake. The worker
// goroutine writes and the test goroutine reads, so it holds a lock.
type changeSweepRecorder struct {
	mu               sync.Mutex
	snapshots, items int64
	observations     int
}

func (r *changeSweepRecorder) ObserveChangeSnapshotSweep(snapshots, items int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.snapshots += snapshots
	r.items += items
	r.observations++
}

func (r *changeSweepRecorder) snapshot() (snapshots, items int64, observations int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshots, r.items, r.observations
}

// TestDocumentChangesSweepWorkerRunCountsRows pins the worker's own Run path
// (T-6): the first pass sweeps expired snapshots, counts both tables and
// reports them to the metrics recorder, and Run stops on context
// cancellation instead of spinning.
func TestDocumentChangesSweepWorkerRunCountsRows(t *testing.T) {
	w := newChangeWorld(t, "chgrun", nil)
	w.docs(t, 2, "workspace")
	live, err := w.list(t, w.tn.member.ID, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	// One expired snapshot with two items, beside the live one.
	if _, err := w.f.pool.Exec(w.f.ctx,
		`INSERT INTO document_change_snapshots (id, organization_id, workspace_id, created_by, created_by_kind, high_water, item_count, expires_at)
		 VALUES ('01EXPIREDSWEEP0000000000000', $1, $2, $3, 'human', '1:1:', 2, now() - interval '1 minute')`,
		w.tn.orgID, w.tn.wsA, w.tn.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.pool.Exec(w.f.ctx,
		`INSERT INTO document_change_snapshot_items (snapshot_id, organization_id, workspace_id, document_id, kind, revision, current_version)
		 VALUES ('01EXPIREDSWEEP0000000000000', $1, $2, '01DOCSWEEP00000000000000001', 'page', 1, 0),
		        ('01EXPIREDSWEEP0000000000000', $1, $2, '01DOCSWEEP00000000000000002', 'page', 1, 0)`,
		w.tn.orgID, w.tn.wsA); err != nil {
		t.Fatal(err)
	}

	sweep := w.svc.NewSnapshotSweeper(nil)
	rec := &changeSweepRecorder{}
	sweep.SetMetrics(rec)
	ctx, cancel := context.WithCancel(w.f.ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		sweep.Run(ctx)
	}()
	// The first pass is synchronous inside Run; cancel once it has landed.
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, _, obs := rec.snapshot(); obs > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Run's first pass never reported metrics")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop on context cancellation")
	}
	snapshots, items, observations := rec.snapshot()
	if observations != 1 || snapshots != 1 || items != 2 {
		t.Fatalf("metrics = (%d snapshots, %d items, %d observations), want one observation of (1, 2)",
			snapshots, items, observations)
	}
	var wiped, liveItems int
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT count(*) FROM document_change_snapshots WHERE id = '01EXPIREDSWEEP0000000000000'`).Scan(&wiped); err != nil {
		t.Fatal(err)
	}
	if wiped != 0 {
		t.Fatal("Run left the expired snapshot behind")
	}
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT count(*) FROM document_change_snapshot_items WHERE snapshot_id = '01EXPIREDSWEEP0000000000000'`).Scan(&liveItems); err != nil {
		t.Fatal(err)
	}
	if liveItems != 0 {
		t.Fatal("Run left the expired snapshot's items behind")
	}
	// The live snapshot is untouched: its cursor still pages.
	if _, err := w.list(t, w.tn.member.ID, live.NextCursor, 1); err != nil {
		t.Fatalf("page 2 of the live snapshot after the sweep: %v", err)
	}
}

func TestDocumentChangesExpiredCursorAnswersGone(t *testing.T) {
	w := newChangeWorld(t, "chgexp", nil)
	w.docs(t, 2, "workspace")
	page, err := w.list(t, w.tn.member.ID, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	w.now = w.now.Add(w.svc.SnapshotTTL() + time.Second)
	if _, err := w.list(t, w.tn.member.ID, page.NextCursor, 1); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("expired cursor: %v, want change_cursor_expired", err)
	}
}

func TestDocumentChangesForeignCursorIsInvalidWithoutScope(t *testing.T) {
	w := newChangeWorld(t, "chgforeign", nil)
	w.docs(t, 2, "workspace")
	w.f.wsMember(t, w.tn.wsB, w.tn.member.ID, "member")
	page, err := w.list(t, w.tn.member.ID, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	// One fixture per test: testutil.DB truncates and holds the advisory lock.
	other := w.f.tenant(t, "chgforeignb")
	cases := map[string]func() error{
		"another user": func() error {
			_, err := w.list(t, w.tn.creator.ID, page.NextCursor, 1)
			return err
		},
		"another workspace": func() error {
			_, err := w.svc.List(w.f.ctx, Human(w.tn.member.ID), w.tn.wsB, DocumentChangeListInput{Cursor: page.NextCursor, Limit: 1})
			return err
		},
		"another deployment": func() error {
			svc := NewDocumentChangesService(w.f.svc, nil, config.Config{
				JWTSecret: "change-feed-test-secret-0123456789", DesktopAuthDeploymentIDs: []string{"dep-other"},
			})
			_, err := svc.List(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA, DocumentChangeListInput{Cursor: page.NextCursor, Limit: 1})
			return err
		},
		"another server key": func() error {
			svc := NewDocumentChangesService(w.f.svc, nil, config.Config{
				JWTSecret: "another-change-feed-secret-012345", DesktopAuthDeploymentIDs: []string{"dep-test"},
			})
			_, err := svc.List(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA, DocumentChangeListInput{Cursor: page.NextCursor, Limit: 1})
			return err
		},
		"another organization's owner": func() error {
			_, err := w.svc.List(w.f.ctx, Human(other.owner.ID), other.wsA, DocumentChangeListInput{Cursor: page.NextCursor, Limit: 1})
			return err
		},
		"tampered": func() error {
			_, err := w.list(t, w.tn.member.ID, page.NextCursor[:len(page.NextCursor)-2]+"AA", 1)
			return err
		},
		"expired feed cursor of another scope": func() error {
			// Genuine signature, foreign workspace, expired: the scope check
			// runs before expiry, so the answer must be invalid, never 410 -
			// a 410 would confirm the foreign scope exists.
			claims, err := w.svc.codec.verify(page.NextCursor, changeCursorScope{
				deployment: "dep-test", userID: w.tn.member.ID, organization: w.tn.orgID, workspace: w.tn.wsA,
			}, w.now)
			if err != nil {
				t.Fatal(err)
			}
			claims.Phase, claims.HighWater = changeCursorPhaseFeed, "1:1:"
			claims.ExpiresAt = w.now.Add(-time.Hour).Unix()
			token, err := w.svc.codec.sign(claims)
			if err != nil {
				t.Fatal(err)
			}
			_, err = w.svc.List(w.f.ctx, Human(w.tn.bMember.ID), w.tn.wsB, DocumentChangeListInput{Cursor: token, Limit: 1})
			return err
		},
	}
	for name, run := range cases {
		err := run()
		if !codedIs(err, "change_cursor_invalid") {
			t.Errorf("%s: %v, want change_cursor_invalid", name, err)
			continue
		}
		for _, leak := range []string{w.tn.orgID, w.tn.wsA, w.tn.wsB, w.tn.member.ID, "dep-test"} {
			if strings.Contains(err.Error(), leak) {
				t.Errorf("%s: error names %q", name, leak)
			}
		}
	}
}

func TestDocumentChangesFlagOffAnswersCapabilityOff(t *testing.T) {
	w := newChangeWorld(t, "chgflag", nil)
	flags, _, err := featureflags.NewService(graphFlagStore{rows: []db.FeatureFlagOverride{
		{FlagKey: "office_sync_feed", ScopeType: featureflags.ScopeOrganization, ScopeID: w.tn.orgID, Enabled: false},
		{FlagKey: "office_sync_feed", ScopeType: featureflags.ScopeUser, ScopeID: w.tn.wsAdmin.ID, Enabled: true},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	w.svc.flags = flags
	_, err = w.list(t, w.tn.member.ID, "", 10)
	var ce CodedError
	if !asCoded(err, &ce) || ce.Code != "office_capability_off" || ce.Status != 403 || ce.Fields["capability"] != "sync_feed" {
		t.Fatalf("flag off for the organization: %+v (%v), want 403 office_capability_off capability=sync_feed", ce, err)
	}
	// A user override beats the organization (user > org > global).
	if _, err := w.list(t, w.tn.wsAdmin.ID, "", 10); err != nil {
		t.Fatalf("user override on: %v", err)
	}
	var n int
	if err := w.f.pool.QueryRow(w.f.ctx, `SELECT count(*) FROM document_change_snapshots WHERE created_by = $1`, w.tn.member.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a refused caller opened %d snapshots (%v)", n, err)
	}
}
