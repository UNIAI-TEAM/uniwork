package service

// G1-04b (UNI-678) lifecycle tests: archive/restore batches, the purge
// sweep's FileService seam, and version compaction.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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

// failReleaseSpy fails every ReleaseInTx batch that names one id: the purge
// tests use it to prove a row that errors does not hold back the rest of
// the sweep.
type failReleaseSpy struct {
	releaseSpy
	bad files.FileID
}

func (r *failReleaseSpy) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	for _, id := range ids {
		if id == r.bad {
			return errors.New("files: release refused (test)")
		}
	}
	return r.releaseSpy.ReleaseInTx(ctx, q, ids)
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
			d := f.live(t, id)
			// A restored row is a changed row: revision and updated_at move
			// so a client holding the pre-archive revision conflicts on
			// write instead of silently keeping a stale base (R1-09).
			if d.Revision != 2 {
				t.Fatalf("%s revision = %d, want 2 (restore bumps)", id, d.Revision)
			}
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
		// The owner service grants the org owner manage on this owned doc;
		// the public command still refuses - owned docs live and die through
		// the owner seam, never the public archive path.
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.owner.ID: DocumentLevelManage})
		defer f.svc.SetOwnerLevelResolver(nil)
		owned := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-arch"})
		_, err := f.svc.ArchiveDocument(f.ctx, owner, owned.ID, ArchiveDocumentInput{})
		wantCode(t, err, "document_owned_by_work_product")
		// ...but an actor who cannot even read the document gets not_found:
		// the owned refusal must never confirm the id to a stranger.
		hidden := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", createdBy: tn.aclOwner.ID, ownerID: "wp-arch"})
		if _, err := f.svc.ArchiveDocument(f.ctx, Human(tn.member.ID), hidden.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("archive on an invisible owned doc = %v, want ErrNotFound", err)
		}
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

	t.Run("the owner restore seams name the batch each row cleared", func(t *testing.T) {
		// R1-08: archived through the seam so the row carries a real batch;
		// the document.restored frame's archive_batch_id is that batch, read
		// under the row lock. A row archived without a batch still emits the
		// key, empty, like the public restore.
		live := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-seam-a"})
		legacy := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-seam-b", archived: true})

		tx, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		ok, err := f.svc.ArchiveOwnedDocumentInTx(f.ctx, f.q.WithTx(tx), owner, tn.orgID, tn.wsA, live.ID)
		if err != nil || !ok {
			t.Fatalf("owner archive = (%v, %v)", ok, err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		var batch string
		if err := f.pool.QueryRow(f.ctx, `SELECT archive_batch_id FROM documents WHERE id = $1`, live.ID).Scan(&batch); err != nil || batch == "" {
			t.Fatalf("archived batch = %q, err=%v", batch, err)
		}

		tx, err = f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		ok, err = f.svc.RestoreOwnedDocumentInTx(f.ctx, f.q.WithTx(tx), owner, tn.orgID, tn.wsA, live.ID)
		if err != nil || !ok {
			t.Fatalf("single owner restore = (%v, %v)", ok, err)
		}
		restored, err := f.svc.RestoreOwnedDocumentsInTx(f.ctx, f.q.WithTx(tx), owner, tn.orgID, tn.wsA, "wp-seam-b")
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		if len(restored) != 1 || restored[0] != legacy.ID {
			t.Fatalf("bulk owner restore = %v, want [%s]", restored, legacy.ID)
		}
		var gotBatch string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT payload::jsonb->>'archive_batch_id' FROM outbox_events
			 WHERE topic = 'document.restored' AND payload::jsonb->>'document_id' = $1`, live.ID).Scan(&gotBatch); err != nil {
			t.Fatal(err)
		}
		if gotBatch != batch {
			t.Fatalf("restored frame batch = %q, want %q", gotBatch, batch)
		}
		var hasKey bool
		if err := f.pool.QueryRow(f.ctx,
			`SELECT payload::jsonb ? 'archive_batch_id' FROM outbox_events
			 WHERE topic = 'document.restored' AND payload::jsonb->>'document_id' = $1`, legacy.ID).Scan(&hasKey); err != nil || !hasKey {
			t.Fatalf("legacy-batch frame missing archive_batch_id (has=%v, err=%v)", hasKey, err)
		}
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

	t.Run("owner-service documents are not the public sweep's business", func(t *testing.T) {
		f.svc.SetFiles(&releaseSpy{})
		past := time.Now().Add(-time.Hour)
		owned := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID,
			ownerID: "wp-purge", archived: true, purgeAfter: past})
		f.version(t, owned, 1, "auto", "f-owned-1")
		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if rep.Purged != 0 || rep.Failed != 0 {
			t.Fatalf("purge = %+v, want the owned row untouched", rep)
		}
		f.liveArchived(t, owned.ID)
		d, err := f.q.GetDocumentByID(f.ctx, owned.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !d.OwnerKind.Valid || d.OwnerID.String != "wp-purge" {
			t.Fatalf("owned doc lost its owner: %+v", d)
		}
	})

	t.Run("a row that fails does not hold back the sweep", func(t *testing.T) {
		f.svc.SetFiles(&failReleaseSpy{bad: "f-bad"})
		past := time.Now().Add(-time.Hour)
		bad := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			archived: true, purgeAfter: past.Add(-time.Minute)})
		f.version(t, bad, 1, "auto", "f-bad")
		good := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			archived: true, purgeAfter: past})
		f.version(t, good, 1, "auto", "f-good")

		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if rep.Purged != 1 || rep.Failed != 1 {
			t.Fatalf("purge = %+v, want 1 purged past the 1 failed row", rep)
		}
		// The failing row stays in the trash for the next tick; the good
		// row's orbit is gone.
		f.liveArchived(t, bad.ID)
		if _, err := f.q.GetDocumentByID(f.ctx, good.ID); err == nil {
			t.Fatal("good document survived behind the failing row")
		}
	})

	t.Run("an orphaned asset past the grace releases, a held or young one stays", func(t *testing.T) {
		spy := &releaseSpy{}
		f.svc.SetFiles(spy)
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		asset := func(fileID string, orphanedDays int) string {
			t.Helper()
			id := util.NewID()
			row := map[string]any{
				"id": id, "organization_id": d.OrganizationID, "workspace_id": d.WorkspaceID,
				"document_id": d.ID, "file_id": fileID, "mime_type": "image/png", "size_bytes": 10,
				"created_by": d.CreatedBy, "created_by_kind": "human",
			}
			if orphanedDays > 0 {
				row["orphaned_at"] = time.Now().Add(-time.Duration(orphanedDays) * 24 * time.Hour)
			}
			insertRow(t, f.ctx, f.pool, "document_assets", row)
			return id
		}
		dead := asset("f-orph-dead", 8)
		held := asset("f-orph-held", 8)
		young := asset("f-orph-young", 1)
		// A retained version still mentions the held asset - a restore could
		// bring the reference back, so the sweep must leave it.
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO document_versions
			(id, organization_id, workspace_id, document_id, version, kind, reason, content, created_by, created_by_kind)
			VALUES ('01DVHELD0000000000000000', $1, $2, $3, 1, 'page', 'auto', $4, 'u', 'human')`,
			d.OrganizationID, d.WorkspaceID, d.ID,
			fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"asset://%s"}]}]}`, held)); err != nil {
			t.Fatal(err)
		}

		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		// The fixture's trash is shared with the earlier subtests, so the
		// document half of the sweep can legitimately release other ids;
		// the asset half must touch exactly the dead orphan.
		var deadSeen, heldSeen, youngSeen int
		for _, id := range spy.releasedIDs() {
			switch id {
			case "f-orph-dead":
				deadSeen++
			case "f-orph-held":
				heldSeen++
			case "f-orph-young":
				youngSeen++
			}
		}
		if rep.AssetsPurged != 1 || rep.Failed != 0 || deadSeen != 1 || heldSeen != 0 || youngSeen != 0 {
			t.Fatalf("purge = %+v released %v, want the dead orphan released once and the held/young ones never", rep, spy.releasedIDs())
		}
		for _, id := range []string{held, young} {
			var n int
			if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_assets WHERE id = $1`, id).Scan(&n); err != nil || n != 1 {
				t.Fatalf("asset %s gone (n=%d, err=%v)", id, n, err)
			}
		}
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_assets WHERE id = $1`, dead).Scan(&n); err != nil || n != 0 {
			t.Fatalf("dead asset still present (n=%d, err=%v)", n, err)
		}
	})

	t.Run("an asset orphaned anew inside the grace survives", func(t *testing.T) {
		// R2-02: the scan classified the row on a stale stamp; the purge
		// re-checks the row's own orphaned_at under the document lock, so an
		// asset referenced and re-orphaned meanwhile keeps a fresh seven
		// days.
		spy := &releaseSpy{}
		f.svc.SetFiles(spy)
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		assetID := util.NewID()
		insertRow(t, f.ctx, f.pool, "document_assets", map[string]any{
			"id": assetID, "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": d.ID, "file_id": "f-reorphaned", "mime_type": "image/png", "size_bytes": 10,
			"created_by": d.CreatedBy, "created_by_kind": "human",
			"orphaned_at": time.Now().Add(-24 * time.Hour), // inside the grace now
		})
		// The scan row carries the stale stamp the classification saw.
		purged, err := f.svc.purgeOneAsset(f.ctx, db.ListOrphanedDocumentAssetsRow{
			ID: assetID, OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: d.ID,
			OrphanedAt: pgtype.Timestamptz{Time: time.Now().Add(-8 * 24 * time.Hour), Valid: true},
		}, time.Now().Add(-documentAssetRetentionDays*24*time.Hour))
		if err != nil || purged {
			t.Fatalf("purgeOneAsset = (%v, %v), want (false, nil) for a re-orphaned asset", purged, err)
		}
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_assets WHERE id = $1`, assetID).Scan(&n); err != nil || n != 1 {
			t.Fatalf("re-orphaned asset gone (n=%d, err=%v)", n, err)
		}
		for _, id := range spy.releasedIDs() {
			if id == "f-reorphaned" {
				t.Fatal("a re-orphaned asset's file was released")
			}
		}
	})

	t.Run("a cancelled context stops the sweep", func(t *testing.T) {
		f.svc.SetFiles(&releaseSpy{})
		ctx, cancel := context.WithCancel(f.ctx)
		cancel()
		if _, err := f.svc.PurgeExpired(ctx, time.Now()); !errors.Is(err, context.Canceled) {
			t.Fatalf("PurgeExpired on a dead ctx = %v, want context.Canceled", err)
		}
		if _, err := f.svc.CompactVersions(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("CompactVersions on a dead ctx = %v, want context.Canceled", err)
		}
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
		f.svc.SetMetrics(metrics)
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

	t.Run("the version current_version points at never drops", func(t *testing.T) {
		d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		insertVersions(t, d, documentVersionKeep+1, "auto", "01DVCC")
		// current_version = 1: the oldest auto is also the live one. The
		// plain keep-boundary logic would drop exactly it.
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET current_version = 1 WHERE id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
		rep, err := f.svc.CompactVersions(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		if rep.VersionsDeleted != 0 || rep.Failed != 0 {
			t.Fatalf("compact = %+v, want nothing deleted", rep)
		}
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_versions WHERE document_id = $1`, d.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != documentVersionKeep+1 {
			t.Fatalf("compaction touched current_version: %d rows remain", n)
		}
	})
}
