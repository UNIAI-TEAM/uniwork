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

func TestDocumentRestorePerItem(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rs")
	admin := Human(tn.wsAdmin.ID)
	u := Human(tn.member.ID)

	t.Run("RS-1: child manager restores only child to workspace root while parent and sibling stay in trash", func(t *testing.T) {
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, title: "Thư mục F",
		})
		docA := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Tài liệu A", parent: folderF.ID,
		})
		docB := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Tài liệu B", parent: folderF.ID,
		})
		f.share(t, docA, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)

		arch, err := f.svc.ArchiveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("admin archive F: %v", err)
		}

		res, err := f.svc.RestoreDocument(f.ctx, u, docA.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("U restore A: %v", err)
		}
		if len(res.Affected) != 1 || res.Affected[0] != docA.ID {
			t.Fatalf("restore affected = %v, want [%s]", res.Affected, docA.ID)
		}
		gotA := f.live(t, docA.ID)
		if gotA.ParentID.Valid {
			t.Fatalf("restored A parent_id = %v, want NULL (workspace root)", gotA.ParentID)
		}
		if gotA.ArchiveBatchID.Valid || gotA.PurgeAfter.Valid {
			t.Fatalf("restored A still carries batch/purge_after: batch=%v purge_after=%v", gotA.ArchiveBatchID, gotA.PurgeAfter)
		}
		for _, id := range []string{folderF.ID, docB.ID} {
			rem, err := f.q.GetDocumentByID(f.ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			if !rem.ArchivedAt.Valid || rem.ArchiveBatchID.String != arch.BatchID || !rem.PurgeAfter.Valid {
				t.Fatalf("%s state after partial restore: archived=%v batch=%v (want %q) purge_after=%v",
					id, rem.ArchivedAt.Valid, rem.ArchiveBatchID, arch.BatchID, rem.PurgeAfter.Valid)
			}
		}
	})

	t.Run("RS-2: folder manager restores folder and managed child while unmanaged child stays in trash", func(t *testing.T) {
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder, title: "Thư mục RS2",
		})
		docA := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Con A", parent: folderF.ID,
		})
		docB := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Con B", parent: folderF.ID,
		})
		f.share(t, docB, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)

		arch, err := f.svc.ArchiveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("admin archive F: %v", err)
		}
		beforeB, err := f.q.GetDocumentByID(f.ctx, docB.ID)
		if err != nil {
			t.Fatal(err)
		}

		res, err := f.svc.RestoreDocument(f.ctx, u, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("U restore F: %v", err)
		}
		if len(res.Affected) != 2 {
			t.Fatalf("restore affected = %v, want 2 ids (F and A)", res.Affected)
		}
		gotF := f.live(t, folderF.ID)
		gotA := f.live(t, docA.ID)
		if gotF.ParentID.Valid || gotA.ParentID.String != folderF.ID {
			t.Fatalf("F parent=%v, A parent=%v, want nil and %s", gotF.ParentID, gotA.ParentID, folderF.ID)
		}
		afterB, err := f.q.GetDocumentByID(f.ctx, docB.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !afterB.ArchivedAt.Valid || afterB.ArchiveBatchID.String != arch.BatchID || !afterB.PurgeAfter.Time.Equal(beforeB.PurgeAfter.Time) {
			t.Fatalf("B state after F restore: archived=%v batch=%v (want %q) purge_after=%v (want %v)",
				afterB.ArchivedAt.Valid, afterB.ArchiveBatchID, arch.BatchID, afterB.PurgeAfter, beforeB.PurgeAfter)
		}
	})
	t.Run("RS-5: a view holder gets 404 on restore of a trashed item, never a 403 that would confirm the id", func(t *testing.T) {
		sharedView := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Chỉ đọc", archived: true,
		})
		f.share(t, sharedView, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		if _, err := f.svc.RestoreDocument(f.ctx, u, sharedView.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("view holder restore = %v, want ErrNotFound", err)
		}
		f.liveArchived(t, sharedView.ID)

		wsView := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Chỉ đọc workspace", archived: true,
		})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, wsView.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.RestoreDocument(f.ctx, u, wsView.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("workspace view holder restore = %v, want ErrNotFound", err)
		}
		f.liveArchived(t, wsView.ID)
	})

	t.Run("RS-3: child restored after parent is already live returns under parent and renames on collision", func(t *testing.T) {
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder, title: "Thư mục RS3",
		})
		docA := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Báo cáo", parent: folderF.ID,
		})
		if _, err := f.svc.ArchiveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("admin archive F: %v", err)
		}
		// U restores F first; docA stays in trash because U does not manage docA yet.
		if _, err := f.svc.RestoreDocument(f.ctx, u, folderF.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("U restore F: %v", err)
		}
		f.live(t, folderF.ID)
		f.liveArchived(t, docA.ID)

		// Create a live sibling under F with the same title "Báo cáo".
		f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Báo cáo", parent: folderF.ID,
		})

		// Now restore docA as aclOwner: it comes back under F as "Báo cáo (2)".
		res, err := f.svc.RestoreDocument(f.ctx, Human(tn.aclOwner.ID), docA.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("aclOwner restore A: %v", err)
		}
		if res.View.Document.ParentID.String != folderF.ID || res.View.Document.Title != "Báo cáo (2)" {
			t.Fatalf("restored A = parent %v title %q, want %s and Báo cáo (2)",
				res.View.Document.ParentID, res.View.Document.Title, folderF.ID)
		}
	})

	t.Run("RS-4: admin restoring batch root restores the whole subtree", func(t *testing.T) {
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder, title: "Thư mục RS4",
		})
		docA := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Con A", parent: folderF.ID,
		})
		docB := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Con B", parent: folderF.ID,
		})
		if _, err := f.svc.ArchiveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("admin archive F: %v", err)
		}
		res, err := f.svc.RestoreDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("admin restore F: %v", err)
		}
		if len(res.Affected) != 3 {
			t.Fatalf("admin restore affected = %v, want 3", res.Affected)
		}
		f.live(t, folderF.ID)
		if gotA := f.live(t, docA.ID); gotA.ParentID.String != folderF.ID {
			t.Fatalf("A parent = %v, want %s", gotA.ParentID, folderF.ID)
		}
		if gotB := f.live(t, docB.ID); gotB.ParentID.String != folderF.ID {
			t.Fatalf("B parent = %v, want %s", gotB.ParentID, folderF.ID)
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

func TestDocumentManualPurge(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mp")
	admin := Human(tn.wsAdmin.ID)
	u := Human(tn.member.ID)

	t.Run("PG-1: manual purge removes all dependent rows, releases blobs, and records manual_purge audit and outbox", func(t *testing.T) {
		spy := &releaseSpy{}
		f.svc.SetFiles(spy)

		doc := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Tài liệu xóa hẳn",
		})
		f.version(t, doc, 1, "auto", "f-mp-v1")
		assetID := util.NewID()
		insertRow(t, f.ctx, f.pool, "document_assets", map[string]any{
			"id": assetID, "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": doc.ID, "file_id": "f-mp-asset", "mime_type": "image/png", "size_bytes": 10,
			"created_by": tn.member.ID, "created_by_kind": "human",
		})
		f.share(t, doc, DocumentPrincipalUser, tn.aclOwner.ID, DocumentLevelView, tn.member.ID)
		insertRow(t, f.ctx, f.pool, "document_share_links", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": doc.ID, "token_hash": "hash-" + util.NewID(),
			"expires_at": time.Now().Add(24 * time.Hour),
			"created_by": tn.member.ID, "created_by_kind": "human",
		})
		insertRow(t, f.ctx, f.pool, "document_access_logs", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": doc.ID, "actor_id": tn.member.ID, "actor_kind": "human",
			"action": "view", "via": "member", "correlation_id": "corr-" + util.NewID(),
		})
		c, err := f.svc.AddDocumentComment(f.ctx, u, doc.ID, AddCommentInput{Body: "Bình luận gốc"}, "")
		if err != nil {
			t.Fatalf("AddDocumentComment: %v", err)
		}
		commentID := c.ID
		if _, err := f.svc.UpdateDocumentComment(f.ctx, u, commentID, UpdateCommentInput{Body: "Bình luận sửa"}); err != nil {
			t.Fatalf("UpdateDocumentComment: %v", err)
		}
		if _, err := f.svc.AddDocumentCommentReaction(f.ctx, u, commentID, "👍"); err != nil {
			t.Fatalf("AddDocumentCommentReaction: %v", err)
		}
		insertRow(t, f.ctx, f.pool, "document_comment_mentions", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": doc.ID, "comment_id": commentID, "user_id": tn.aclOwner.ID,
			"state": "active", "created_by": tn.member.ID, "created_by_kind": "human",
		})
		insertRow(t, f.ctx, f.pool, "document_favorites", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": doc.ID, "user_id": tn.member.ID,
			"created_by": tn.member.ID, "created_by_kind": "human",
		})

		if _, err := f.svc.ArchiveDocument(f.ctx, u, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("archive doc: %v", err)
		}

		tables := []struct {
			name  string
			query string
			arg   string
		}{
			{"document_versions", `SELECT count(*) FROM document_versions WHERE document_id = $1`, doc.ID},
			{"document_assets", `SELECT count(*) FROM document_assets WHERE document_id = $1`, doc.ID},
			{"document_shares", `SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID},
			{"document_share_links", `SELECT count(*) FROM document_share_links WHERE document_id = $1`, doc.ID},
			{"document_access_logs", `SELECT count(*) FROM document_access_logs WHERE document_id = $1`, doc.ID},
			{"comment_reactions", `SELECT count(*) FROM comment_reactions WHERE comment_id = $1`, commentID},
			{"document_comment_mentions", `SELECT count(*) FROM document_comment_mentions WHERE document_id = $1`, doc.ID},
			{"document_comment_revisions", `SELECT count(*) FROM document_comment_revisions WHERE document_id = $1`, doc.ID},
			{"document_comments", `SELECT count(*) FROM document_comments WHERE document_id = $1`, doc.ID},
			{"document_favorites", `SELECT count(*) FROM document_favorites WHERE document_id = $1`, doc.ID},
			{"documents", `SELECT count(*) FROM documents WHERE id = $1`, doc.ID},
		}
		for _, tc := range tables {
			var n int
			if err := f.pool.QueryRow(f.ctx, tc.query, tc.arg).Scan(&n); err != nil || n == 0 {
				t.Fatalf("before purge %s count = %d, err = %v (want > 0)", tc.name, n, err)
			}
		}

		purged, err := f.svc.PurgeDocument(f.ctx, u, doc.ID)
		if err != nil {
			t.Fatalf("PurgeDocument: %v", err)
		}
		if len(purged) != 1 || purged[0] != doc.ID {
			t.Fatalf("purged = %v, want [%s]", purged, doc.ID)
		}

		for _, tc := range tables {
			var n int
			if err := f.pool.QueryRow(f.ctx, tc.query, tc.arg).Scan(&n); err != nil || n != 0 {
				t.Fatalf("after purge %s count = %d, err = %v (want 0)", tc.name, n, err)
			}
		}
		if got := spy.releasedIDs(); len(got) != 2 {
			t.Fatalf("released blobs = %v, want 2 ids (f-mp-v1, f-mp-asset)", got)
		}
		var manualPurge bool
		if err := f.pool.QueryRow(f.ctx,
			`SELECT COALESCE((metadata::jsonb->>'manual_purge')::boolean, false) FROM audit_events
			 WHERE action = 'document.deleted' AND resource_id = $1 AND actor_id = $2`,
			doc.ID, tn.member.ID).Scan(&manualPurge); err != nil || !manualPurge {
			t.Fatalf("audit manual_purge = %v, err = %v, want true", manualPurge, err)
		}
		var outboxCount int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM outbox_events WHERE topic = 'document.deleted' AND payload::jsonb->>'document_id' = $1`,
			doc.ID).Scan(&outboxCount); err != nil || outboxCount != 1 {
			t.Fatalf("outbox document.deleted count = %d, err = %v, want 1", outboxCount, err)
		}
	})

	t.Run("PG-2: edit holder gets 403, invisible gets 404, live document gets 400 document_not_in_trash, over bound gets 400 folder_too_large", func(t *testing.T) {
		f.svc.SetFiles(&releaseSpy{})
		liveDoc := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
		})
		_, err := f.svc.PurgeDocument(f.ctx, u, liveDoc.ID)
		ce := wantCode(t, err, "document_not_in_trash")
		if ce.Status != 400 {
			t.Fatalf("document_not_in_trash status = %d, want 400", ce.Status)
		}

		trashed := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, archived: true,
		})
		if _, err := f.svc.PurgeDocument(f.ctx, u, trashed.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("invisible purge = %v, want ErrNotFound (404)", err)
		}
		f.share(t, trashed, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		if _, err := f.svc.PurgeDocument(f.ctx, u, trashed.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("edit holder purge = %v, want ErrForbidden (403)", err)
		}

		// A view holder cannot act and must not learn the id exists: 404, not
		// the 403 an edit holder gets.
		viewShared := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, archived: true,
		})
		f.share(t, viewShared, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		if _, err := f.svc.PurgeDocument(f.ctx, u, viewShared.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("view holder purge = %v, want ErrNotFound", err)
		}
		wsViewDoc := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, archived: true,
		})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, wsViewDoc.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.PurgeDocument(f.ctx, u, wsViewDoc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("workspace view holder purge = %v, want ErrNotFound", err)
		}

		// Bound check: > archiveBound returns 400 folder_too_large.
		root := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder,
		})
		f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			parent: root.ID,
		})
		if _, err := f.svc.ArchiveDocument(f.ctx, u, root.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		f.svc.archiveMaxNodes = 1
		defer func() { f.svc.archiveMaxNodes = 0 }()
		_, err = f.svc.PurgeDocument(f.ctx, u, root.ID)
		ce = wantCode(t, err, "folder_too_large")
		if ce.Status != 400 {
			t.Fatalf("purge folder_too_large status = %d, want 400", ce.Status)
		}
		f.liveArchived(t, root.ID)
	})

	t.Run("PG-3: unmanaged descendant stays in trash on folder purge and re-roots to workspace root when later restored", func(t *testing.T) {
		f.svc.SetFiles(&releaseSpy{})
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder, title: "Thư mục PG3",
		})
		managedChild := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Con của U", parent: folderF.ID,
		})
		unmanagedChild := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Con của người khác", parent: folderF.ID,
		})

		if _, err := f.svc.ArchiveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("admin archive F: %v", err)
		}
		beforeChild, err := f.q.GetDocumentByID(f.ctx, unmanagedChild.ID)
		if err != nil {
			t.Fatal(err)
		}
		// A live child under a trashed parent: unreachable through the public
		// commands, but the helper must re-root it too (name + root position).
		liveChild := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Con sống", parent: folderF.ID,
		})

		purged, err := f.svc.PurgeDocument(f.ctx, u, folderF.ID)
		if err != nil {
			t.Fatalf("U purge F: %v", err)
		}
		if len(purged) != 2 {
			t.Fatalf("purged = %v, want 2 (F and managedChild)", purged)
		}
		for _, id := range []string{folderF.ID, managedChild.ID} {
			if _, err := f.q.GetDocumentByID(f.ctx, id); err == nil {
				t.Fatalf("expected %s to be hard-deleted", id)
			}
		}

		// BE-RS-1: the retained child must not keep a dangling parent_id.
		// parent_id is NULL the moment the purge commits and every other
		// field (archived_at, batch, purge_after, title, revision) is what it
		// was before the purge.
		retained, err := f.q.GetDocumentByID(f.ctx, unmanagedChild.ID)
		if err != nil {
			t.Fatal(err)
		}
		if retained.ParentID.Valid {
			t.Fatalf("retained child parent_id = %v, want NULL immediately after purge", retained.ParentID)
		}
		if !retained.ArchivedAt.Valid || !retained.ArchivedAt.Time.Equal(beforeChild.ArchivedAt.Time) ||
			!retained.ArchiveBatchID.Valid ||
			retained.ArchiveBatchID.String != beforeChild.ArchiveBatchID.String ||
			!retained.PurgeAfter.Time.Equal(beforeChild.PurgeAfter.Time) ||
			retained.Title != beforeChild.Title || retained.Revision != beforeChild.Revision {
			t.Fatalf("retained child changed beyond parent_id: %+v vs %+v", retained, beforeChild)
		}
		// The live child re-rooted to the workspace root, still live.
		afterLive := f.live(t, liveChild.ID)
		if afterLive.ParentID.Valid {
			t.Fatalf("live child parent_id = %v, want NULL (workspace root)", afterLive.ParentID)
		}

		// BE-RS-7: exactly one human document.deleted audit row and one outbox
		// row per deleted id - and none for either retained child.
		for _, id := range []string{folderF.ID, managedChild.ID} {
			var auditCount int
			if err := f.pool.QueryRow(f.ctx,
				`SELECT count(*) FROM audit_events
				 WHERE action = 'document.deleted' AND resource_id = $1 AND actor_id = $2 AND actor_kind = 'human'`,
				id, tn.member.ID).Scan(&auditCount); err != nil || auditCount != 1 {
				t.Fatalf("audit document.deleted rows for %s = %d, err = %v, want 1 human row", id, auditCount, err)
			}
			var outboxCount int
			if err := f.pool.QueryRow(f.ctx,
				`SELECT count(*) FROM outbox_events WHERE topic = 'document.deleted' AND payload::jsonb->>'document_id' = $1`,
				id).Scan(&outboxCount); err != nil || outboxCount != 1 {
				t.Fatalf("outbox document.deleted rows for %s = %d, err = %v, want 1", id, outboxCount, err)
			}
		}
		for _, id := range []string{unmanagedChild.ID, liveChild.ID} {
			var n int
			if err := f.pool.QueryRow(f.ctx,
				`SELECT count(*) FROM audit_events WHERE action = 'document.deleted' AND resource_id = $1`,
				id).Scan(&n); err != nil || n != 0 {
				t.Fatalf("audit document.deleted rows for retained %s = %d, err = %v, want 0", id, n, err)
			}
			if err := f.pool.QueryRow(f.ctx,
				`SELECT count(*) FROM outbox_events WHERE topic = 'document.deleted' AND payload::jsonb->>'document_id' = $1`,
				id).Scan(&n); err != nil || n != 0 {
				t.Fatalf("outbox document.deleted rows for retained %s = %d, err = %v, want 0", id, n, err)
			}
		}

		// Now aclOwner restores unmanagedChild: it already sits at the trash
		// root, so it comes back at the workspace root.
		res, err := f.svc.RestoreDocument(f.ctx, Human(tn.aclOwner.ID), unmanagedChild.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("aclOwner restore unmanagedChild: %v", err)
		}
		if res.View.Document.ParentID.Valid {
			t.Fatalf("restored unmanagedChild parent = %v, want NULL (workspace root)", res.View.Document.ParentID)
		}
	})

	t.Run("PG-4: PurgeExpired still purges expired rows via shared hardDeleteDocumentTx", func(t *testing.T) {
		spy := &releaseSpy{}
		f.svc.SetFiles(spy)
		past := time.Now().Add(-time.Hour)
		expired := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, archived: true, purgeAfter: past,
		})
		// A child archived in a different batch with a future purge_after is
		// retained by the sweep; its parent_id must be re-rooted to NULL.
		retainedChild := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			parent: expired.ID, archived: true,
		})
		f.version(t, expired, 1, "auto", "f-pg4-exp")
		rep, err := f.svc.PurgeExpired(f.ctx, time.Now())
		if err != nil {
			t.Fatalf("PurgeExpired: %v", err)
		}
		if rep.Purged < 1 {
			t.Fatalf("PurgeExpired = %+v, want at least 1 purged", rep)
		}
		if _, err := f.q.GetDocumentByID(f.ctx, expired.ID); err == nil {
			t.Fatal("expired document still exists after PurgeExpired")
		}
		afterChild, err := f.q.GetDocumentByID(f.ctx, retainedChild.ID)
		if err != nil {
			t.Fatal(err)
		}
		if afterChild.ParentID.Valid || !afterChild.ArchivedAt.Valid {
			t.Fatalf("retained child after sweep: parent=%v archived=%v, want NULL parent in trash",
				afterChild.ParentID, afterChild.ArchivedAt.Valid)
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

func TestDocumentTrashEditHolders(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tredit")
	f.svc.SetFiles(&releaseSpy{})
	owner := Human(tn.aclOwner.ID)
	editor := Human(tn.member.ID)

	t.Run("TR-1: edit holder sees trashed rows with my_level=edit, does not see unrelated rows, content read is 404, restore and purge are 403", func(t *testing.T) {
		// 1. Workspace-visible document with workspace_level = 'edit' (default).
		wsEdit := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "WS Edit Doc",
		})
		// 2. Restricted document with a live 'edit' share to editor.
		sharedEdit := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Shared Edit Doc",
		})
		f.share(t, sharedEdit, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		// 3. Unrelated rows: workspace-visible with workspace_level = 'view',
		// restricted with 'view' share, and restricted with no share.
		wsView := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "WS View Doc",
		})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, wsView.ID); err != nil {
			t.Fatal(err)
		}
		sharedView := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Shared View Doc",
		})
		f.share(t, sharedView, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		unsharedRestricted := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Unshared Restricted Doc",
		})

		for _, id := range []string{wsEdit.ID, sharedEdit.ID, wsView.ID, sharedView.ID, unsharedRestricted.ID} {
			if _, err := f.svc.ArchiveDocument(f.ctx, owner, id, ArchiveDocumentInput{}); err != nil {
				t.Fatalf("archive %s: %v", id, err)
			}
		}

		trash, err := f.svc.ListDocuments(f.ctx, editor, tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatalf("ListDocuments(Archived=true): %v", err)
		}
		byID := map[string]DocumentListItem{}
		for _, it := range trash.Items {
			byID[it.Document.ID] = it
		}
		for _, wantID := range []string{wsEdit.ID, sharedEdit.ID} {
			it, ok := byID[wantID]
			if !ok {
				t.Fatalf("edit holder trash missing %s (got ids %v)", wantID, listIDs(trash))
			}
			if it.Access.Level != DocumentLevelEdit {
				t.Fatalf("item %s Access.Level = %q, want %q", wantID, it.Access.Level, DocumentLevelEdit)
			}
		}
		for _, unwantedID := range []string{wsView.ID, sharedView.ID, unsharedRestricted.ID} {
			if _, ok := byID[unwantedID]; ok {
				t.Fatalf("edit holder trash leaked unrelated row %s", unwantedID)
			}
		}

		// Agents remain capped at view and never see the trash.
		agentTrash, err := f.svc.ListDocuments(f.ctx, agentActor(tn.agent), tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatalf("agent ListDocuments(Archived=true): %v", err)
		}
		if len(agentTrash.Items) != 0 {
			t.Fatalf("agent trash = %v, want empty", listIDs(agentTrash))
		}

		// Content read of trashed item stays manage-only (404 for edit holder).
		for _, id := range []string{wsEdit.ID, sharedEdit.ID} {
			if _, err := f.svc.GetDocument(f.ctx, editor, id); !errors.Is(err, ErrNotFound) {
				t.Fatalf("edit holder GetDocument(%s) = %v, want ErrNotFound", id, err)
			}
			if _, err := f.svc.RestoreDocument(f.ctx, editor, id, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
				t.Fatalf("edit holder RestoreDocument(%s) = %v, want ErrForbidden", id, err)
			}
			if _, err := f.svc.PurgeDocument(f.ctx, editor, id); !errors.Is(err, ErrForbidden) {
				t.Fatalf("edit holder PurgeDocument(%s) = %v, want ErrForbidden", id, err)
			}
		}
	})

	t.Run("TR-2: creator with no current edit/manage access (ownership transferred away or restricted share revoked) does not see trashed row", func(t *testing.T) {
		// Case A: created by editor, ownership transferred to aclOwner, restricted (no share).
		transferredRestricted := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.member.ID, title: "Transferred Restricted",
		})
		// Case B: created by editor, ownership transferred to aclOwner, workspace-visible with workspace_level = 'view'.
		transferredView := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.member.ID, title: "Transferred View",
		})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, transferredView.ID); err != nil {
			t.Fatal(err)
		}
		// Case C: created by editor, restricted, had an edit share that was revoked.
		revokedShareDoc := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.member.ID, title: "Revoked Share",
		})
		sh := f.share(t, revokedShareDoc, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		if _, err := f.pool.Exec(f.ctx, `UPDATE document_shares SET revoked_at = now() WHERE id = $1`, sh.ID); err != nil {
			t.Fatal(err)
		}

		for _, id := range []string{transferredRestricted.ID, transferredView.ID, revokedShareDoc.ID} {
			if _, err := f.svc.ArchiveDocument(f.ctx, owner, id, ArchiveDocumentInput{}); err != nil {
				t.Fatalf("archive %s: %v", id, err)
			}
		}

		trash, err := f.svc.ListDocuments(f.ctx, editor, tn.wsA, ListDocumentsInput{Archived: true, Limit: 100})
		if err != nil {
			t.Fatalf("ListDocuments(Archived=true): %v", err)
		}
		ids := listIDs(trash)
		for _, id := range []string{transferredRestricted.ID, transferredView.ID, revokedShareDoc.ID} {
			if containsID(ids, id) {
				t.Fatalf("creator without current edit/manage access saw trashed row %s (got %v)", id, ids)
			}
		}
	})

	t.Run("TR-3: a content-only term names the row to a manager but never to an edit holder", func(t *testing.T) {
		// search_text carries title + content (as documentSearchText writes it);
		// the term lives in the content part only, so the title branch cannot
		// match it and the row proves a content match happened.
		contentHit := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			title: "Biên bản họp", searchText: "Biên bản họp xylophone secret body",
		})
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, contentHit.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("archive contentHit: %v", err)
		}

		// The manager (acl owner) still gets the row on a content match.
		managerTrash, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Archived: true, Query: "xylophone", Limit: 100})
		if err != nil {
			t.Fatalf("manager trash search: %v", err)
		}
		if !containsID(listIDs(managerTrash), contentHit.ID) {
			t.Fatalf("manager content search missing %s (got %v)", contentHit.ID, listIDs(managerTrash))
		}

		// The edit holder sees the row by title but a content-only term must
		// not name it (BE-RS-3).
		editorTrash, err := f.svc.ListDocuments(f.ctx, editor, tn.wsA, ListDocumentsInput{Archived: true, Query: "xylophone", Limit: 100})
		if err != nil {
			t.Fatalf("editor trash search: %v", err)
		}
		if containsID(listIDs(editorTrash), contentHit.ID) {
			t.Fatalf("editor content search leaked %s (got %v)", contentHit.ID, listIDs(editorTrash))
		}
		titleHit, err := f.svc.ListDocuments(f.ctx, editor, tn.wsA, ListDocumentsInput{Archived: true, Query: "Biên bản", Limit: 100})
		if err != nil {
			t.Fatalf("editor title search: %v", err)
		}
		if !containsID(listIDs(titleHit), contentHit.ID) {
			t.Fatalf("editor title search missing %s (got %v)", contentHit.ID, listIDs(titleHit))
		}

		// A workspace admin reaches a restricted trashed row only through
		// AdminScope: they administer it, they never read its content, so a
		// content-only term must not name the row while the title still does
		// (F-3b: see_all grants content matching only on non-restricted rows).
		admin := Human(tn.wsAdmin.ID)
		restrictedHit := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			title: "Restricted Agenda", searchText: "Restricted Agenda quasarbody-only",
		})
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, restrictedHit.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("archive restrictedHit: %v", err)
		}
		adminContent, err := f.svc.ListDocuments(f.ctx, admin, tn.wsA, ListDocumentsInput{Archived: true, Query: "quasarbody", Limit: 100})
		if err != nil {
			t.Fatalf("admin content search: %v", err)
		}
		if containsID(listIDs(adminContent), restrictedHit.ID) {
			t.Fatalf("admin content search leaked restricted row %s (got %v)", restrictedHit.ID, listIDs(adminContent))
		}
		adminTitle, err := f.svc.ListDocuments(f.ctx, admin, tn.wsA, ListDocumentsInput{Archived: true, Query: "Restricted Agenda", Limit: 100})
		if err != nil {
			t.Fatalf("admin title search: %v", err)
		}
		if !containsID(listIDs(adminTitle), restrictedHit.ID) {
			t.Fatalf("admin title search missing %s (got %v)", restrictedHit.ID, listIDs(adminTitle))
		}
	})
}
