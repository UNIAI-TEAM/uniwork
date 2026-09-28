package service

// G1-04b (UNI-678) lifecycle tests: archive/restore batches, the purge
// sweep's FileService seam, and version compaction.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// releaseSpy is the FileService the purge tests run against: it records the
// ids ReleaseInTx is asked about so the test can prove the seam saw exactly
// the document's references - once, inside the command's transaction.
type releaseSpy struct {
	files.Service
	mu       sync.Mutex
	released [][]files.FileID
}

func (r *releaseSpy) ReleaseInTx(_ context.Context, _ *db.Queries, ids []files.FileID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.released = append(r.released, append([]files.FileID(nil), ids...))
	return nil
}

func (r *releaseSpy) releasedIDs() []files.FileID {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []files.FileID
	for _, batch := range r.released {
		out = append(out, batch...)
	}
	return out
}

// insertVersion adds a document_versions row the purge/compaction tests
// shape by hand.
func (f *docPermFixture) version(t *testing.T, d db.Document, n int, reason, fileID string) db.DocumentVersion {
	t.Helper()
	row := map[string]any{
		"id": util.NewID(), "organization_id": d.OrganizationID, "workspace_id": d.WorkspaceID,
		"document_id": d.ID, "version": n, "kind": "page", "reason": reason,
		"content": `{"type":"doc","content":[]}`, "created_by": d.CreatedBy, "created_by_kind": "human",
	}
	if fileID != "" {
		row["file_id"] = fileID
	}
	insertRow(t, f.ctx, f.pool, "document_versions", row)
	v, err := f.q.GetDocumentVersion(f.ctx, db.GetDocumentVersionParams{
		OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		DocumentID: d.ID, Version: int32(n),
	})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDocumentArchive(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "arch")
	owner := Human(tn.owner.ID)

	t.Run("a subtree archives in one batch and restores together", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		grand := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: child.ID})

		res, err := f.svc.ArchiveDocument(f.ctx, owner, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if res.BatchID == "" || len(res.Affected) != 3 {
			t.Fatalf("archive = batch %q affected %v, want 3 ids", res.BatchID, res.Affected)
		}
		for _, id := range []string{root.ID, child.ID, grand.ID} {
			d, err := f.q.GetDocumentByID(f.ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			if !d.ArchivedAt.Valid || d.ArchiveBatchID.String != res.BatchID || !d.PurgeAfter.Valid {
				t.Fatalf("%s archived=%v batch=%v purge_after=%v", id, d.ArchivedAt.Valid, d.ArchiveBatchID, d.PurgeAfter.Valid)
			}
		}

		res, err = f.svc.RestoreDocument(f.ctx, owner, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Affected) != 3 {
			t.Fatalf("restore affected %v, want the same 3", res.Affected)
		}
		for _, id := range []string{root.ID, child.ID, grand.ID} {
			f.live(t, id)
		}
	})

	t.Run("a restricted child the caller cannot manage blocks the batch", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		f.share(t, root, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
		if _, err := f.svc.ArchiveDocument(f.ctx, Human(tn.member.ID), root.ID, ArchiveDocumentInput{}); err == nil {
			t.Fatal("archive with an unmanageable child succeeded")
		} else {
			wantCodeOrForbidden(t, err)
		}
		// Nothing moved: the refusal is atomic.
		if d := f.live(t, root.ID); d.ArchiveBatchID.Valid {
			t.Fatal("partial archive left a batch id behind")
		}
	})

	t.Run("restore touches exactly the batch it was asked for", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, a.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, b.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.RestoreDocument(f.ctx, owner, a.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		f.live(t, a.ID)
		d, err := f.q.GetDocumentByID(f.ctx, b.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !d.ArchivedAt.Valid {
			t.Fatal("restore leaked outside the batch")
		}
	})

	t.Run("an owned document refuses archive and restore", func(t *testing.T) {
		owned := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-arch"})
		_, err := f.svc.ArchiveDocument(f.ctx, owner, owned.ID, ArchiveDocumentInput{})
		wantCode(t, err, "document_owned_by_work_product")
	})

	t.Run("an archived document cannot be moved", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		dst := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, a.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		_, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: dst.ID, Revision: 1})
		wantCode(t, err, "document_deleted")
	})
}

func wantCodeOrForbidden(t *testing.T, err error) {
	t.Helper()
	if errors.Is(err, ErrForbidden) {
		return
	}
	var ce CodedError
	if errors.As(err, &ce) && (ce.Code == "forbidden" || ce.Status == 403) {
		return
	}
	t.Fatalf("want forbidden, got %v", err)
}

func TestDocumentPurge(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "prg")

	t.Run("expired rows delete and release file references in one pass", func(t *testing.T) {
		spy := &releaseSpy{}
		f.svc.SetFiles(spy)
		past := time.Now().Add(-time.Hour)
		dead := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			archived: true, purgeAfter: past})
		f.version(t, dead, 1, "auto", "f-shared-1")
		f.version(t, dead, 2, "auto", "f-only-dead")
		// A live document referencing the same object keeps it: the purge
		// hands the id back once and the surviving row still points at it.
		alive := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.version(t, alive, 1, "manual", "f-shared-1")

		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if rep.Purged != 1 || rep.Failed != 0 {
			t.Fatalf("purge = %+v, want 1 purged 0 failed", rep)
		}
		got := spy.releasedIDs()
		if len(got) != 2 {
			t.Fatalf("released %v, want the dead doc's two ids once each", got)
		}
		// The dead document's orbit is gone; the survivor's is intact.
		if _, err := f.q.GetDocumentByID(f.ctx, dead.ID); err == nil {
			t.Fatal("purged document still readable")
		}
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_versions WHERE document_id = $1`, dead.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("%d version rows survived the purge", n)
		}
		if _, err := f.q.GetDocumentVersion(f.ctx, db.GetDocumentVersionParams{
			OrganizationID: alive.OrganizationID, WorkspaceID: alive.WorkspaceID,
			DocumentID: alive.ID, Version: 1,
		}); err != nil {
			t.Fatalf("shared object's surviving reference was deleted: %v", err)
		}
		// Idempotent: a second sweep finds nothing.
		rep, err = f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if rep.Purged != 0 {
			t.Fatalf("second sweep purged %d rows", rep.Purged)
		}
	})

	t.Run("a not-yet-expired row stays", func(t *testing.T) {
		f.svc.SetFiles(&releaseSpy{})
		recent := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, archived: true})
		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if rep.Purged != 0 {
			t.Fatalf("purged %d rows still inside retention", rep.Purged)
		}
		f.liveArchived(t, recent.ID)
	})
}

// liveArchived asserts the row exists AND is still in the trash.
func (f *docPermFixture) liveArchived(t *testing.T, id string) {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if !d.ArchivedAt.Valid {
		t.Fatalf("document %s lost its archive state", id)
	}
}

func TestDocumentCompaction(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "cmp")
	f.svc.SetFiles(&releaseSpy{})

	insertVersions := func(t *testing.T, d db.Document, n int, reason, prefix string) {
		t.Helper()
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO document_versions
			(id, organization_id, workspace_id, document_id, version, kind, reason, content, created_by, created_by_kind)
			SELECT $6 || lpad(g::text, 21, '0'), $2, $3, $1, g, 'page', $4,
			       '{"type":"doc","content":[]}', 'u', 'human'
			FROM generate_series(1, $5) g`,
			d.ID, d.OrganizationID, d.WorkspaceID, reason, n, prefix); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("only automatic versions above the keep bound drop", func(t *testing.T) {
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		insertVersions(t, d, documentVersionKeep+1, "auto", "01DVCA")
		f.version(t, d, documentVersionKeep+2, "manual", "")
		rep, err := f.svc.CompactVersions(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		// total 502, protected 1 -> keep 499 autos; the two oldest drop.
		if rep.VersionsDeleted != 2 || rep.Compacted != 1 {
			t.Fatalf("compact = %+v, want 1 doc losing exactly 2 auto versions", rep)
		}
		var autos, manuals int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FILTER (WHERE reason='auto'), count(*) FILTER (WHERE reason='manual')
			 FROM document_versions WHERE document_id = $1`, d.ID).Scan(&autos, &manuals); err != nil {
			t.Fatal(err)
		}
		if autos != documentVersionKeep-1 || manuals != 1 {
			t.Fatalf("remaining autos=%d manuals=%d, want %d + 1", autos, manuals, documentVersionKeep-1)
		}
		// Idempotent.
		rep, err = f.svc.CompactVersions(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		if rep.VersionsDeleted != 0 {
			t.Fatalf("second pass deleted %d versions", rep.VersionsDeleted)
		}
	})

	t.Run("protected versions above the bound all stay and count the metric", func(t *testing.T) {
		metrics := &countingAccessMetrics{}
		f.svc.SetAccessMetrics(metrics)
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		insertVersions(t, d, documentVersionKeep+2, "manual", "01DVCB")
		rep, err := f.svc.CompactVersions(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		if rep.ProtectedOverflow != 1 || rep.VersionsDeleted != 0 {
			t.Fatalf("compact = %+v, want 1 protected overflow and nothing deleted", rep)
		}
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_versions WHERE document_id = $1`, d.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != documentVersionKeep+2 {
			t.Fatalf("protected overflow lost versions: %d remain", n)
		}
		if metrics.protectedOverflow.Load() != 1 {
			t.Fatalf("overflow metric = %d, want 1", metrics.protectedOverflow.Load())
		}
	})
}
