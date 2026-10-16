package service

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// SH-S1 (UNI-1780) write half: the visibility PATCH keeps the home row's
// stored level, every home-row change writes document.workspace_access_changed,
// and the change feed reads that action for the removal.

// TestUpdateDocumentKeepsWorkspaceLevel is the PATCH round trip: turning the
// home row off (restricted) and on (workspace) keeps the stored level, so the
// row comes back exactly as it left (SH-S1 §3 "PATCH keeps its meaning").
func TestUpdateDocumentKeepsWorkspaceLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1patch")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	setWorkspaceLevel(t, f, doc, "view")

	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, UpdateDocumentInput{Revision: doc.Revision, Visibility: strPtr("restricted")}); err != nil {
		t.Fatalf("workspace -> restricted: %v", err)
	}
	if _, err := f.svc.GetDocument(f.ctx, Human(tn.member.ID), doc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a member still reads the closed home row: %v", err)
	}
	closed, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Visibility != "restricted" || closed.WorkspaceLevel != "view" {
		t.Fatalf("closed home row = %q/%q, want restricted/view", closed.Visibility, closed.WorkspaceLevel)
	}

	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, UpdateDocumentInput{Revision: closed.Revision, Visibility: strPtr("workspace")}); err != nil {
		t.Fatalf("restricted -> workspace: %v", err)
	}
	reopened, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.WorkspaceLevel != "view" {
		t.Fatalf("reopened home row level = %q, want the stored view", reopened.WorkspaceLevel)
	}
	access, err := f.svc.effectiveLevel(f.ctx, f.q, Human(tn.member.ID), reopened)
	if err != nil {
		t.Fatalf("effectiveLevel: %v", err)
	}
	if access.Level != DocumentLevelView || access.Via != DocumentViaMember {
		t.Fatalf("reopened access = %+v, want view via member", access)
	}
}

// TestDocumentWorkspaceAccessChangedAuditAndOutbox is AC18's half for SH-S1:
// every home-row change writes the new action with the before/after pair and
// one ids-only frame of the same name, and a visibility-only PATCH is no
// longer a document.updated row.
func TestDocumentWorkspaceAccessChangedAuditAndOutbox(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1audit")

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	setWorkspaceLevel(t, f, doc, "comment")

	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), doc.ID, UpdateDocumentInput{Revision: doc.Revision, Visibility: strPtr("restricted")}); err != nil {
		t.Fatalf("close the home row: %v", err)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 1 {
		t.Fatalf("workspace-access audit rows = %d, want 1", n)
	}
	if n := countAudit(t, f, audit.ActionDocumentUpdated, doc.ID); n != 0 {
		t.Fatalf("a visibility-only PATCH wrote %d document.updated rows, want 0", n)
	}
	if n := countOutbox(t, f, "document.workspace_access_changed", doc.ID); n != 1 {
		t.Fatalf("workspace-access frames = %d, want 1", n)
	}

	// The frame is ids only.
	var payload string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT payload::text FROM outbox_events WHERE topic = 'document.workspace_access_changed' AND payload::jsonb->>'document_id' = $1`, doc.ID,
	).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var keys map[string]any
	if err := json.Unmarshal([]byte(payload), &keys); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 || keys["document_id"] != doc.ID || keys["workspace_id"] != tn.wsA {
		t.Fatalf("workspace-access payload = %s, want ids only", payload)
	}

	// The audit row names the home row before and after; the level did not
	// move, so only visibility is listed.
	var changes string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT changes::text FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentWorkspaceAccessChanged, doc.ID,
	).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	var diff map[string]struct {
		From any `json:"from"`
		To   any `json:"to"`
	}
	if err := json.Unmarshal([]byte(changes), &diff); err != nil {
		t.Fatal(err)
	}
	if len(diff) != 1 {
		t.Fatalf("home-row changes = %s, want the visibility pair only", changes)
	}
	if v, ok := diff["visibility"]; !ok || v.From != "workspace" || v.To != "restricted" {
		t.Fatalf("home-row visibility change = %s, want workspace -> restricted", changes)
	}
}

// TestDocumentChangesFeedWorkspaceHomeRow pins the feed halves SH-S1 touches:
// a member whose home row turns off gets the ids-only removal (the new action
// is read exactly like the visibility diff it replaces), a level move that
// keeps the row workspace-visible keeps delivering upserts, and a merged share
// - the home row turning on through a share naming the document's own
// workspace - counts as the grant it is, so a purge or an ownership change
// that lands on the same page answers 410 instead of a silent skip.
func TestDocumentChangesFeedWorkspaceHomeRow(t *testing.T) {
	t.Run("turned off is a removal", func(t *testing.T) {
		w := newFeedWorld(t, "shs1feedoff")
		// Owned by someone else, so the member reads it only through the home
		// row and closing the row takes that away.
		doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", aclOwner: w.tn.owner.ID, createdBy: w.tn.owner.ID})
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if !held[doc.ID] {
			t.Fatal("the fixture is wrong: the member did not hold the home-visible document")
		}

		if _, err := w.f.svc.UpdateDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, UpdateDocumentInput{
			Revision: doc.Revision, Visibility: strPtr("restricted"),
		}); err != nil {
			t.Fatalf("close the home row: %v", err)
		}

		got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
		if !ok {
			t.Fatal("a closed home row did not reach the member who had access")
		}
		if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
			t.Fatalf("home-row-off row = %+v, want removal permission_revoked", got)
		}
		if got.Kind != "" || got.FileVersionID != "" {
			t.Fatalf("the removal carries document fields: %+v", got)
		}
	})

	t.Run("a lower level still reads", func(t *testing.T) {
		w := newFeedWorld(t, "shs1feedlevel")
		doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", aclOwner: w.tn.owner.ID, createdBy: w.tn.owner.ID})
		setWorkspaceLevel(t, w.f, doc, "view")
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if !held[doc.ID] {
			t.Fatal("the fixture is wrong: a view home row was not held")
		}

		updated, err := w.f.svc.UpdateDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, UpdateDocumentInput{
			Revision: doc.Revision, Title: strPtr("đổi tên"),
		})
		if err != nil {
			t.Fatalf("rename under the view home row: %v", err)
		}
		got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
		if !ok {
			t.Fatal("a metadata change under a view home row reached nobody")
		}
		if got.ChangeKind != DocumentChangeKindUpsert || got.Revision != updated.Document.Revision {
			t.Fatalf("home-row view row = %+v, want upsert revision %d", got, updated.Document.Revision)
		}
	})

	t.Run("a purge after a merged share answers 410", func(t *testing.T) {
		w := newFeedWorld(t, "shs1feedmergepurge")
		// Owned by somebody else and restricted: the member reads it only
		// through the home row, which the merged share turns on after their
		// snapshot.
		doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", aclOwner: w.tn.owner.ID, createdBy: w.tn.owner.ID})
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if held[doc.ID] {
			t.Fatal("the fixture is wrong: the member already read the restricted document")
		}

		// A share naming the document's own workspace merges into the home row
		// (no document_shares row) and writes document.workspace_access_changed,
		// never document.shared: it is still the grant that may have admitted
		// the caller after the snapshot.
		if _, err := w.f.svc.ShareDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalWorkspace, PrincipalID: w.tn.wsA, Level: DocumentLevelView,
		}); err != nil {
			t.Fatalf("merged share: %v", err)
		}
		// The purge destroys the state its removal would be decided from, and
		// the grant is on the same page: the caller may have become a reader
		// after the snapshot, so the feed answers 410 - never a silent skip.
		if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM documents WHERE id = $1`, doc.ID); err != nil {
			t.Fatal(err)
		}
		w.auditChange(t, "document.deleted", doc.ID)

		if _, err := w.list(t, w.tn.member.ID, feedCursor, 200); !codedIs(err, "change_cursor_expired") {
			t.Fatalf("purge after a merged share = %v, want 410 change_cursor_expired", err)
		}
	})

	t.Run("becoming owned after a merged share answers 410", func(t *testing.T) {
		w := newFeedWorld(t, "shs1feedmergeowned")
		const workProduct = "01WPFEED0000000000000000000"
		doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", aclOwner: w.tn.owner.ID, createdBy: w.tn.owner.ID})
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if held[doc.ID] {
			t.Fatal("the fixture is wrong: the member already read the restricted document")
		}

		if _, err := w.f.svc.ShareDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalWorkspace, PrincipalID: w.tn.wsA, Level: DocumentLevelView,
		}); err != nil {
			t.Fatalf("merged share: %v", err)
		}
		// The owner change overwrites the pre-change owner state, so the page's
		// grant is what proves the caller may have been a reader: 410, never a
		// silent skip that leaves the document in their library.
		if _, err := w.f.pool.Exec(w.f.ctx,
			`UPDATE documents SET owner_kind = 'work_product', owner_id = $2 WHERE id = $1`, doc.ID, workProduct); err != nil {
			t.Fatal(err)
		}
		w.auditChange(t, "document.updated", doc.ID)

		if _, err := w.list(t, w.tn.member.ID, feedCursor, 200); !codedIs(err, "change_cursor_expired") {
			t.Fatalf("owned after a merged share = %v, want 410 change_cursor_expired", err)
		}
	})
}
