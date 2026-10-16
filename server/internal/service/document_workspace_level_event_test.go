package service

import (
	"encoding/json"
	"errors"
	"strconv"
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

	// One PATCH that moves the home row and the content at once writes one row
	// per fact: the home-row event for the visibility half and the autosave's
	// document.updated row for the content half, with no document.updated
	// frame - neither title nor icon moved (C-01 §5.1).
	doc2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), doc2.ID, UpdateDocumentInput{
		Revision: doc2.Revision, Visibility: strPtr("restricted"), Content: pageJSON("nội dung mới"),
	}); err != nil {
		t.Fatalf("combined visibility+content PATCH: %v", err)
	}
	if n := countAudit(t, f, audit.ActionDocumentWorkspaceAccessChanged, doc2.ID); n != 1 {
		t.Fatalf("combined PATCH workspace-access rows = %d, want 1", n)
	}
	if n := countAudit(t, f, audit.ActionDocumentUpdated, doc2.ID); n != 1 {
		t.Fatalf("combined PATCH document.updated rows = %d, want 1", n)
	}
	if n := countOutbox(t, f, "document.updated", doc2.ID); n != 0 {
		t.Fatalf("combined PATCH document.updated frames = %d, want none", n)
	}
	if n := countOutbox(t, f, "document.workspace_access_changed", doc2.ID); n != 1 {
		t.Fatalf("combined PATCH workspace-access frames = %d, want 1", n)
	}
	// One successful PATCH bumps the revision once, however many halves it
	// writes (C-01 §9.1 item 3), and the document.updated row's metadata names
	// that final revision.
	final, err := f.q.GetDocumentByID(f.ctx, doc2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Revision != doc2.Revision+1 {
		t.Fatalf("combined PATCH revision = %d, want exactly one bump from %d", final.Revision, doc2.Revision)
	}
	var auditRevision string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata::jsonb->>'revision' FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentUpdated, doc2.ID,
	).Scan(&auditRevision); err != nil {
		t.Fatal(err)
	}
	if auditRevision != strconv.FormatInt(final.Revision, 10) {
		t.Fatalf("combined PATCH audit revision = %q, want the final revision %d", auditRevision, final.Revision)
	}
}

// TestDocumentChangesFeedWorkspaceHomeRow pins the feed halves SH-S1 touches:
// a member whose home row turns off gets the ids-only removal (the new action
// is read exactly like the visibility diff it replaces), and a level move that
// keeps the row workspace-visible keeps delivering upserts.
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
}
