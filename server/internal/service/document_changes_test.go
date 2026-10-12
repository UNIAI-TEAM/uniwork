package service

import (
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
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
	// every commit after the snapshot: G5-01b continues from it.
	claims, err := w.svc.codec.verify(last.NextCursor, changeCursorScope{
		deployment: "dep-test", userID: w.tn.member.ID, organization: w.tn.orgID, workspace: w.tn.wsA,
	}, w.now)
	if err != nil || claims.Phase != changeCursorPhaseFeed || claims.HighWater == "" {
		t.Fatalf("last cursor = %+v, %v", claims, err)
	}
	var visible bool
	if err := w.f.pool.QueryRow(w.f.ctx, `SELECT pg_visible_in_snapshot(pg_current_xact_id(), $1::pg_snapshot)`, claims.HighWater).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible {
		t.Fatal("a transaction after the snapshot is visible in its high-water mark")
	}
	if _, err := w.list(t, w.tn.member.ID, last.NextCursor, 2); !codedIs(err, "unsupported_operation") {
		t.Fatalf("feed cursor before G5-01b: %v, want unsupported_operation", err)
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
