package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

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
	// every commit after the snapshot: G5-01b serves the feed from there. The
	// check is a real concurrent transaction (BE-F1-2): its xid8 is fixed
	// before the snapshot opens, so the mark must not see it.
	claims, err := w.svc.codec.verify(last.NextCursor, changeCursorScope{
		deployment: "dep-test", userID: w.tn.member.ID, organization: w.tn.orgID, workspace: w.tn.wsA,
	}, w.now)
	if err != nil || claims.Phase != changeCursorPhaseFeed || claims.HighWater == "" {
		t.Fatalf("last cursor = %+v, %v", claims, err)
	}
	if hwmSeesTxn(t, w, claims.HighWater, concurrentXID(t, w)) {
		t.Fatal("a transaction open when the snapshot began is visible in its high-water mark")
	}
	feed, err := w.list(t, w.tn.member.ID, last.NextCursor, 2)
	if err != nil || feed.Phase != changeCursorPhaseFeed {
		t.Fatalf("feed cursor after the snapshot = %+v, %v; want a feed page (G5-01b)", feed, err)
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

// The three concurrency guards below (BE-F2-1, BE-F2-2, BE-F2-3) each run one
// scenario twice: as built (REPEATABLE READ), where the guard must find no
// violation, and with the snapshot/page transactions forced to READ
// COMMITTED through isoOverride, where the same guard must find one. The
// second run is the proof that the guard is not vacuous.
func runIsolationGuard(t *testing.T, scenario func(t *testing.T, iso pgx.TxIsoLevel) string) {
	t.Helper()
	t.Run("repeatable read (as built)", func(t *testing.T) {
		if v := scenario(t, ""); v != "" {
			t.Fatal(v)
		}
	})
	t.Run("read committed is caught", func(t *testing.T) {
		if v := scenario(t, pgx.ReadCommitted); v == "" {
			t.Fatal("the guard found no violation under READ COMMITTED: it does not pin the isolation it claims to")
		} else {
			t.Logf("violation detected as expected: %s", v)
		}
	})
}

func isoSlug(base string, iso pgx.TxIsoLevel) string {
	if iso == "" {
		return base + "rr"
	}
	return base + "rc"
}

func (w *changeWorld) cursorScope(orgID string) changeCursorScope {
	return changeCursorScope{deployment: "dep-test", userID: w.tn.member.ID, organization: orgID, workspace: w.tn.wsA}
}

func (w *changeWorld) snapshotItemIDs(t *testing.T, snapshotID string) map[string]bool {
	t.Helper()
	rows, err := w.f.pool.Query(w.f.ctx,
		`SELECT document_id FROM document_change_snapshot_items WHERE snapshot_id = $1`, snapshotID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out[id] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// dropSnapshots removes every snapshot user opened in this test's workspace.
func (w *changeWorld) dropSnapshots(t *testing.T, user string) {
	t.Helper()
	for _, q := range []string{
		`DELETE FROM document_change_snapshot_items WHERE snapshot_id IN
		   (SELECT id FROM document_change_snapshots WHERE workspace_id = $1 AND created_by = $2)`,
		`DELETE FROM document_change_snapshots WHERE workspace_id = $1 AND created_by = $2`,
	} {
		if _, err := w.f.pool.Exec(w.f.ctx, q, w.tn.wsA, user); err != nil {
			t.Fatal(err)
		}
	}
}

// TestDocumentChangesHighWaterHandoffCommitsMidBuild is the BE-F2-1 guard
// (BE-F1-2): a writer that commits WHILE the snapshot is being built sits on
// exactly one side of the high-water mark. Its change is in the snapshot's
// items IF AND ONLY IF the mark sees its xid8: visible but missing loses the
// change (G5-01b skips what the mark already covers), present but invisible
// delivers it twice.
//
// The writer takes its xid8 (an update of an existing document and a new
// document) before the build begins and commits from midBuildHook - after the
// build read its high-water mark, before it reads the items. The guard then
// reads THAT snapshot (its own pages and its stored high_water), never a
// fresh one. As built, both reads are one REPEATABLE READ snapshot taken
// before the commit: the writer is invisible in the mark and absent from the
// items (the incremental feed carries it). Under READ COMMITTED the item read
// re-snapshots after the commit: present but invisible.
func TestDocumentChangesHighWaterHandoffCommitsMidBuild(t *testing.T) {
	runIsolationGuard(t, func(t *testing.T, iso pgx.TxIsoLevel) string {
		w := newChangeWorld(t, isoSlug("chghwm", iso), nil)
		w.svc.isoOverride = iso
		base := w.docs(t, 1, "workspace")[0]

		writer, err := w.f.pool.Begin(w.f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = writer.Rollback(w.f.ctx) }()
		if _, err := writer.Exec(w.f.ctx, `UPDATE documents SET revision = revision + 1 WHERE id = $1`, base.ID); err != nil {
			t.Fatal(err)
		}
		midBuildID := util.NewID()
		insertRow(t, w.f.ctx, writer, "documents", baseDoc(map[string]any{
			"id": midBuildID, "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
			"title": "committed mid-build", "created_by": w.tn.member.ID, "updated_by": w.tn.member.ID,
		}))
		var xid string
		if err := writer.QueryRow(w.f.ctx, `SELECT pg_current_xact_id()::text`).Scan(&xid); err != nil {
			t.Fatal(err)
		}

		committed := false
		w.svc.midBuildHook = func() {
			w.svc.midBuildHook = nil
			if err := writer.Commit(w.f.ctx); err != nil {
				t.Errorf("writer commit mid-build: %v", err)
				return
			}
			committed = true
		}
		snapshotID, orgID, err := w.svc.openSnapshot(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA)
		if err != nil {
			t.Fatalf("openSnapshot: %v", err)
		}
		if !committed {
			t.Fatal("the writer did not commit inside the build: the interleave was never exercised")
		}

		page, err := w.svc.page(w.f.ctx, w.cursorScope(orgID), snapshotID, "", 50)
		if err != nil {
			t.Fatalf("paging the snapshot that was open during the commit: %v", err)
		}
		if page.HasMore {
			t.Fatal("expected the whole snapshot on one page")
		}
		var highWater string
		if err := w.f.pool.QueryRow(w.f.ctx,
			`SELECT high_water FROM document_change_snapshots WHERE id = $1`, snapshotID).Scan(&highWater); err != nil {
			t.Fatal(err)
		}
		claims, err := w.svc.codec.verify(page.NextCursor, w.cursorScope(orgID), w.now)
		if err != nil || claims.HighWater != highWater {
			t.Fatalf("feed cursor high-water = %q, %v; want the snapshot's own %q", claims.HighWater, err, highWater)
		}

		inSnapshot, baseRev := false, int64(-1)
		for _, c := range page.Changes {
			switch c.DocumentID {
			case midBuildID:
				inSnapshot = true
			case base.ID:
				baseRev = c.Revision
			}
		}
		if baseRev < 0 {
			t.Fatal("the pre-existing document is missing from the snapshot")
		}
		hwmSees := hwmSeesTxn(t, w, highWater, xid)
		switch {
		case hwmSees && !inSnapshot:
			return "the high-water mark sees the writer but the snapshot misses its new document: G5-01b skips it (lost change)"
		case !hwmSees && inSnapshot:
			return "the snapshot holds the writer's new document but the high-water mark cannot see it: the change would be delivered twice"
		case hwmSees != (baseRev == base.Revision+1):
			return fmt.Sprintf("the snapshot carries revision %d of the updated document (before %d) while the mark sees the writer = %v",
				baseRev, base.Revision, hwmSees)
		}
		return ""
	})
}

// TestDocumentChangesMembershipIsAsOfTheSnapshot is the BE-F2-2 guard
// (BE-F1-4, Advisor decision): membership is evaluated at the snapshot's MVCC
// point. A revocation committed after that point - here from midBuildHook,
// together with a new workspace document - does not abort the build, and the
// snapshot holds exactly the workspace as of that point: never a row committed
// with or after the revocation. The NEXT request after the revocation, a page
// cursor or a cold start, is refused by the gate with no data and leaves no
// snapshot. Under READ COMMITTED the gate and the items are read at different
// points, so the snapshot of a member who has already lost the workspace
// carries the document committed with the revocation.
func TestDocumentChangesMembershipIsAsOfTheSnapshot(t *testing.T) {
	runIsolationGuard(t, func(t *testing.T, iso pgx.TxIsoLevel) string {
		w := newChangeWorld(t, isoSlug("chgasof", iso), nil)
		w.svc.isoOverride = iso
		member := w.tn.member.ID
		t.Cleanup(func() { w.dropSnapshots(t, member) })
		open := map[string]bool{}
		for range 2 {
			open[w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", createdBy: w.tn.creator.ID}).ID] = true
		}

		// Control: before the revocation the member sees both documents. Its
		// snapshot is dropped so the counts below see only the guarded build.
		control, err := w.list(t, member, "", 10)
		if err != nil || len(control.Changes) != len(open) {
			t.Fatalf("control = %+v, %v; want the %d open documents", control.Changes, err, len(open))
		}
		w.dropSnapshots(t, member)

		postRevokeID := util.NewID()
		revoked := false
		w.svc.midBuildHook = func() {
			w.svc.midBuildHook = nil
			tx, err := w.f.pool.Begin(w.f.ctx)
			if err != nil {
				t.Errorf("revoke: %v", err)
				return
			}
			defer func() { _ = tx.Rollback(w.f.ctx) }()
			if _, err := tx.Exec(w.f.ctx,
				`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.tn.wsA, member); err != nil {
				t.Errorf("revoke: %v", err)
				return
			}
			if err := insertRowE(w.f.ctx, tx, "documents", baseDoc(map[string]any{
				"id": postRevokeID, "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
				"title": "committed with the revocation", "created_by": w.tn.creator.ID, "updated_by": w.tn.creator.ID,
			})); err != nil {
				t.Errorf("revoke: %v", err)
				return
			}
			if err := tx.Commit(w.f.ctx); err != nil {
				t.Errorf("revoke: %v", err)
				return
			}
			revoked = true
		}
		first, err := w.list(t, member, "", 1)
		if err != nil {
			t.Fatalf("a revocation committed after the snapshot point aborted the build: %v", err)
		}
		if !revoked {
			t.Fatal("the revocation did not commit inside the build: the window was never exercised")
		}
		if !first.HasMore {
			t.Fatalf("first page = %+v, want a snapshot cursor", first)
		}
		var snapshotID string
		if err := w.f.pool.QueryRow(w.f.ctx,
			`SELECT id FROM document_change_snapshots WHERE workspace_id = $1 AND created_by = $2`,
			w.tn.wsA, member).Scan(&snapshotID); err != nil {
			t.Fatalf("the guarded build's snapshot: %v", err)
		}

		// The next request after the revocation is refused by the gate.
		next, err := w.list(t, member, first.NextCursor, 10)
		if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
			t.Fatalf("next page after the revocation = %+v, %v; want the gate's refusal", next, err)
		}
		if len(next.Changes) != 0 || next.NextCursor != "" {
			t.Fatalf("the refused page carries data: %+v", next)
		}
		if _, err := w.list(t, member, "", 10); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
			t.Fatalf("cold start after the revocation = %v; want the gate's refusal", err)
		}
		var n int
		if err := w.f.pool.QueryRow(w.f.ctx,
			`SELECT count(*) FROM document_change_snapshots WHERE workspace_id = $1 AND created_by = $2`,
			w.tn.wsA, member).Scan(&n); err != nil || n != 1 {
			t.Fatalf("snapshots after the refused requests = %d, %v; want only the guarded build's", n, err)
		}

		items := w.snapshotItemIDs(t, snapshotID)
		if items[postRevokeID] {
			return "the snapshot holds a document committed with the revocation: the gate and the items were not read at one MVCC point"
		}
		for id := range open {
			if !items[id] {
				return fmt.Sprintf("the snapshot misses %s, visible at the snapshot point", id)
			}
		}
		if len(items) != len(open) {
			return fmt.Sprintf("the snapshot holds %d documents, want the %d of the snapshot point", len(items), len(open))
		}
		return ""
	})
}

// TestDocumentChangesPageReadSurvivesConcurrentSweep is the BE-F2-3 guard
// (BE-F1-3): a sweep that commits between a page's snapshot-row read and its
// item read never turns the page short or empty. The snapshot is LIVE when
// the page starts, so the page passes its expiry check and reaches
// pageItemHook; the hook runs the real sweeper with a clock past the TTL, which
// deletes the snapshot and its items in one transaction. As built the page
// reads the row and the items in one REPEATABLE READ snapshot taken before the
// sweep, so it answers the whole page (or, for an implementation that
// re-checks, 410 - never a short 200); the next request answers 410
// change_cursor_expired. Under READ COMMITTED the item read sees the sweep: an
// empty last page and a feed cursor, i.e. a client that believes it synced.
func TestDocumentChangesPageReadSurvivesConcurrentSweep(t *testing.T) {
	runIsolationGuard(t, func(t *testing.T, iso pgx.TxIsoLevel) string {
		w := newChangeWorld(t, isoSlug("chgmid", iso), nil)
		w.svc.isoOverride = iso
		want := map[string]int64{}
		for _, d := range w.docs(t, 4, "workspace") {
			want[d.ID] = d.Revision
		}
		first, err := w.list(t, w.tn.member.ID, "", 2)
		if err != nil || !first.HasMore {
			t.Fatalf("page 1 = %+v, %v", first, err)
		}

		sweeper := w.svc.NewSnapshotSweeper(nil)
		sweeper.SetClock(func() time.Time { return w.now.Add(w.svc.SnapshotTTL() + time.Second) })
		var swept int64
		w.svc.pageItemHook = func() {
			w.svc.pageItemHook = nil
			n, _, err := sweeper.Sweep(w.f.ctx)
			if err != nil {
				t.Errorf("sweep inside the page read: %v", err)
			}
			swept = n
		}
		second, err := w.list(t, w.tn.member.ID, first.NextCursor, 2)
		if swept != 1 {
			t.Fatalf("the sweep inside the page read removed %d snapshots, want 1: the seam was never reached", swept)
		}
		if _, again := w.list(t, w.tn.member.ID, first.NextCursor, 2); !codedIs(again, "change_cursor_expired") {
			t.Fatalf("request after the sweep = %v, want 410 change_cursor_expired", again)
		}

		if err != nil {
			if codedIs(err, "change_cursor_expired") {
				return ""
			}
			return fmt.Sprintf("page read across the sweep failed with %v, want the whole page or 410", err)
		}
		if len(second.Changes) != 2 {
			return fmt.Sprintf("page read across the sweep answered %d rows (has_more=%v, phase=%s), want the whole page of 2 or 410",
				len(second.Changes), second.HasMore, second.Phase)
		}
		for _, c := range second.Changes {
			if rev, ok := want[c.DocumentID]; !ok || c.Revision != rev {
				return fmt.Sprintf("document %s revision %d is not the snapshot's", c.DocumentID, c.Revision)
			}
		}
		return ""
	})
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

// MYFOLDER-01 (UNI-1891): the cold-start snapshot is the list predicate
// materialised at one MVCC point, so it carries the same ancestor-My-Folder
// exclusion - an admin's cold start must not seed the offline library with a
// document inside another member's My Folder, while the member who owns it
// still gets it. The admin is wsAdmin (a workspace admin, see_all = true).
func TestDocumentChangesSnapshotHidesForeignMyFolderSubtree(t *testing.T) {
	w := newChangeWorld(t, "chgmfs", nil)

	// A is a plain workspace member; their My Folder plus a page inside it.
	env := w.f
	mf, _, err := env.svc.EnsureMyFolder(env.ctx, Human(w.tn.member.ID), w.tn.wsA)
	if err != nil {
		t.Fatalf("EnsureMyFolder(member): %v", err)
	}
	page, err := env.svc.CreatePage(env.ctx, Human(w.tn.member.ID), w.tn.wsA, CreatePageInput{
		Title: "mfs-secret", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(inside My Folder): %v", err)
	}
	shared, err := env.svc.CreatePage(env.ctx, Human(w.tn.member.ID), w.tn.wsA, CreatePageInput{
		Title: "Shared With Admin Inside My Folder", Destination: DocumentSystemKindMyFolder,
	})
	if err != nil {
		t.Fatalf("CreatePage(shared): %v", err)
	}
	if _, err := env.svc.ShareDocument(env.ctx, Human(w.tn.member.ID), shared.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: w.tn.wsAdmin.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("ShareDocument(shared -> admin): %v", err)
	}

	hasID := func(items []DocumentChange, id string) bool {
		for _, c := range items {
			if c.DocumentID == id {
				return true
			}
		}
		return false
	}
	adminItems, _ := w.drain(t, w.tn.wsAdmin.ID, 50, nil)
	ownerItems, _ := w.drain(t, w.tn.member.ID, 50, nil)

	t.Run("admin snapshot hides unshared foreign page", func(t *testing.T) {
		if hasID(adminItems, mf.Document.ID) {
			t.Error("admin snapshot leaked A's My Folder")
		}
		if hasID(adminItems, page.Document.ID) {
			t.Error("admin snapshot leaked the unshared page inside A's My Folder")
		}
	})
	t.Run("admin snapshot keeps a shared foreign descendant", func(t *testing.T) {
		if !hasID(adminItems, shared.Document.ID) {
			t.Error("admin snapshot dropped a page inside A's My Folder that is shared with the admin")
		}
	})
	t.Run("owner snapshot keeps the subtree", func(t *testing.T) {
		if !hasID(ownerItems, mf.Document.ID) || !hasID(ownerItems, page.Document.ID) {
			t.Error("owner snapshot missing My Folder or the page inside it")
		}
	})
}
