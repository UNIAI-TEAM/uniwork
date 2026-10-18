package service

// ARCHIVE-01 (UNI-1845) shelved-state tests: SH-1 (subtree shelve, one batch,
// audit+outbox per node, unmanageable node refuses all), SH-3 (per-item
// unshelve, idempotency), SH-4 (shelved x trash interplay), and the agent cap
// (an agent holds at most view, so shelve answers 403/404 like the trash gate).

import (
	"context"
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countDocAuditRows and countDocOutboxRows are the SH assertion reads: one
// audit row and one outbox row per stamped node is the SH-1 contract.
func countDocAuditRows(t *testing.T, f *docPermFixture, action, docID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func countDocOutboxRows(t *testing.T, f *docPermFixture, topic, docID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, topic, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func shelvedRow(t *testing.T, f *docPermFixture, id string) db.Document {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func wantShelved(t *testing.T, f *docPermFixture, id, batch string) db.Document {
	t.Helper()
	d := shelvedRow(t, f, id)
	if !d.ShelvedAt.Valid || d.ShelveBatchID.String != batch || !d.ShelvedBy.Valid || !d.ShelvedByKind.Valid {
		t.Fatalf("%s shelved=%v batch=%q by=%v kind=%v, want shelved in batch %q",
			id, d.ShelvedAt.Valid, d.ShelveBatchID.String, d.ShelvedBy, d.ShelvedByKind, batch)
	}
	return d
}

func wantUnshelved(t *testing.T, f *docPermFixture, id string) db.Document {
	t.Helper()
	d := shelvedRow(t, f, id)
	if d.ShelvedAt.Valid || d.ShelveBatchID.Valid || d.ShelvedBy.Valid || d.ShelvedByKind.Valid {
		t.Fatalf("%s still shelved: at=%v batch=%v", id, d.ShelvedAt, d.ShelveBatchID)
	}
	return d
}

func TestShelveDocumentSubtree(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sh1")
	owner := Human(tn.owner.ID)

	t.Run("SH-1: a folder shelves its whole live subtree in one batch with audit and outbox per node", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: DocumentKindFolder})
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		grand := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: child.ID})

		res, err := f.svc.ShelveDocument(f.ctx, owner, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if res.BatchID == "" || len(res.Affected) != 3 {
			t.Fatalf("shelve = batch %q affected %v, want 3 ids", res.BatchID, res.Affected)
		}
		for _, id := range []string{root.ID, child.ID, grand.ID} {
			d := wantShelved(t, f, id, res.BatchID)
			if d.ShelvedBy.String != tn.owner.ID || d.ShelvedByKind.String != "human" {
				t.Fatalf("%s shelved_by=%v kind=%v, want owner/human", id, d.ShelvedBy, d.ShelvedByKind)
			}
			if got := countDocAuditRows(t, f, "document.shelved", id); got != 1 {
				t.Fatalf("%s shelved audit rows = %d, want 1", id, got)
			}
			if got := countDocOutboxRows(t, f, "document.shelved", id); got != 1 {
				t.Fatalf("%s shelved outbox rows = %d, want 1", id, got)
			}
		}
		// The outbox payload names the batch.
		var payloadBatch string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT payload::jsonb->>'shelve_batch_id' FROM outbox_events WHERE topic = 'document.shelved' AND payload::jsonb->>'document_id' = $1`,
			root.ID).Scan(&payloadBatch); err != nil {
			t.Fatal(err)
		}
		if payloadBatch != res.BatchID {
			t.Fatalf("outbox shelve_batch_id = %q, want %q", payloadBatch, res.BatchID)
		}
		// Nothing else moved: the rows stay live (not trashed) at the same
		// parent and position.
		if d := shelvedRow(t, f, child.ID); d.ArchivedAt.Valid || d.ParentID.String != root.ID {
			t.Fatalf("child moved or trashed: archived=%v parent=%v", d.ArchivedAt.Valid, d.ParentID)
		}
	})

	t.Run("SH-1: a node the caller cannot manage refuses the whole shelve, nothing stamped", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: DocumentKindFolder, title: "Thư mục deny"})
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		f.share(t, root, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
		if _, err := f.svc.ShelveDocument(f.ctx, Human(tn.member.ID), root.ID, ArchiveDocumentInput{}); err == nil {
			t.Fatal("shelve with an unmanageable child succeeded")
		} else {
			wantCodeOrForbidden(t, err)
		}
		for _, id := range []string{root.ID, child.ID} {
			wantUnshelved(t, f, id)
			if got := countDocAuditRows(t, f, "document.shelved", id); got != 0 {
				t.Fatalf("%s shelved audit rows = %d, want 0 after refusal", id, got)
			}
		}
	})

	t.Run("SH-1: shelve on an already-shelved item is a 200 no-op, no second audit", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		res, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		again, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if again.BatchID != res.BatchID || len(again.Affected) != 0 {
			t.Fatalf("re-shelve = batch %q affected %v, want batch %q and no writes", again.BatchID, again.Affected, res.BatchID)
		}
		if got := countDocAuditRows(t, f, "document.shelved", doc.ID); got != 1 {
			t.Fatalf("shelved audit rows = %d, want 1", got)
		}
	})

	t.Run("SH-1: the My Folder root refuses shelve with my_folder_locked", func(t *testing.T) {
		mf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.member.ID, createdBy: tn.member.ID, kind: DocumentKindFolder, title: "My Folder"})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET system_kind = 'my_folder' WHERE id = $1`, mf.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ShelveDocument(f.ctx, Human(tn.member.ID), mf.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrMyFolderLocked) {
			t.Fatalf("shelve My Folder = %v, want my_folder_locked", err)
		}
	})

	t.Run("an agent cannot shelve: capped at view, the answer is the trash gate's 403/404", func(t *testing.T) {
		visible := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, agentActor(tn.agent), visible.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent shelve of a workspace doc = %v, want ErrForbidden", err)
		}
		wantUnshelved(t, f, visible.ID)
		hidden := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, agentActor(tn.agent), hidden.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("agent shelve of a restricted doc = %v, want ErrNotFound", err)
		}
	})

	t.Run("S-3: Idempotency-Key replays the stored batch without re-stamping", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		first, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{IdempotencyKey: "sh-key-1"})
		if err != nil {
			t.Fatal(err)
		}
		replay, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{IdempotencyKey: "sh-key-1"})
		if err != nil {
			t.Fatal(err)
		}
		if replay.BatchID != first.BatchID {
			t.Fatalf("replay batch = %q, want %q", replay.BatchID, first.BatchID)
		}
		if got := countDocAuditRows(t, f, "document.shelved", doc.ID); got != 1 {
			t.Fatalf("shelved audit rows after replay = %d, want 1", got)
		}
	})
}

func TestUnshelveDocument(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sh3")
	admin := Human(tn.wsAdmin.ID)
	u := Human(tn.member.ID)

	t.Run("SH-3: unshelve clears the item and the managed same-batch descendants; unmanaged stay shelved", func(t *testing.T) {
		folderF := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindFolder, title: "Thư mục SH3",
		})
		docA := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID,
			kind: DocumentKindPage, title: "Con A", parent: folderF.ID, position: 10,
		})
		docB := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Con B", parent: folderF.ID,
		})
		f.share(t, docB, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)

		shelf, err := f.svc.ShelveDocument(f.ctx, admin, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("admin shelve F: %v", err)
		}

		// U manages F and A (acl owner) but only edits B: B stays shelved.
		res, err := f.svc.UnshelveDocument(f.ctx, u, folderF.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("U unshelve F: %v", err)
		}
		if len(res.Affected) != 2 {
			t.Fatalf("unshelve affected = %v, want 2 ids (F and A)", res.Affected)
		}
		if got := wantUnshelved(t, f, folderF.ID); got.ParentID.Valid {
			t.Fatalf("F parent = %v, want nil", got.ParentID)
		}
		if gotA := wantUnshelved(t, f, docA.ID); gotA.ParentID.String != folderF.ID || gotA.Position != 10 {
			t.Fatalf("A parent=%v position=%v, want %s at 10 (position never moves)", gotA.ParentID, gotA.Position, folderF.ID)
		}
		wantShelved(t, f, docB.ID, shelf.BatchID)

		// docB's owner clears it alone; the batch is still the one it shelved under.
		resB, err := f.svc.UnshelveDocument(f.ctx, Human(tn.aclOwner.ID), docB.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("aclOwner unshelve B: %v", err)
		}
		if len(resB.Affected) != 1 || resB.Affected[0] != docB.ID || resB.BatchID != shelf.BatchID {
			t.Fatalf("B unshelve = %v batch %q, want [%s] batch %q", resB.Affected, resB.BatchID, docB.ID, shelf.BatchID)
		}
		wantUnshelved(t, f, docB.ID)
		for _, id := range []string{folderF.ID, docA.ID, docB.ID} {
			if got := countDocAuditRows(t, f, "document.unshelved", id); got != 1 {
				t.Fatalf("%s unshelved audit rows = %d, want 1", id, got)
			}
		}
	})

	t.Run("SH-3: unshelve on a live, unshelved item is a 200 no-op", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		res, err := f.svc.UnshelveDocument(f.ctx, admin, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Affected) != 0 || res.BatchID != "" {
			t.Fatalf("unshelve of a live doc = affected %v batch %q, want none", res.Affected, res.BatchID)
		}
		if got := countDocAuditRows(t, f, "document.unshelved", doc.ID); got != 0 {
			t.Fatalf("unshelved audit rows = %d, want 0", got)
		}
	})

	t.Run("SH-3: unshelve replays under Idempotency-Key", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, admin, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		first, err := f.svc.UnshelveDocument(f.ctx, admin, doc.ID, ArchiveDocumentInput{IdempotencyKey: "unsh-key-1"})
		if err != nil {
			t.Fatal(err)
		}
		replay, err := f.svc.UnshelveDocument(f.ctx, admin, doc.ID, ArchiveDocumentInput{IdempotencyKey: "unsh-key-1"})
		if err != nil {
			t.Fatal(err)
		}
		if len(first.Affected) != 1 || replay.BatchID != first.BatchID || len(replay.Affected) != 0 {
			t.Fatalf("unshelve replay = affected %v, want no writes", replay.Affected)
		}
		if got := countDocAuditRows(t, f, "document.unshelved", doc.ID); got != 1 {
			t.Fatalf("unshelved audit rows after replay = %d, want 1", got)
		}
	})
}

func TestShelvedTrash(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "sh4")
	owner := Human(tn.owner.ID)

	t.Run("SH-4: trashing a shelved item is allowed and restore from trash keeps it shelved", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		shelf, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("trashing a shelved item: %v", err)
		}
		d := shelvedRow(t, f, doc.ID)
		if !d.ArchivedAt.Valid || !d.ShelvedAt.Valid || d.ShelveBatchID.String != shelf.BatchID {
			t.Fatalf("shelved+trashed row: archived=%v shelved=%v batch=%q", d.ArchivedAt.Valid, d.ShelvedAt.Valid, d.ShelveBatchID.String)
		}
		res, err := f.svc.RestoreDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("restore from trash: %v", err)
		}
		d = shelvedRow(t, f, doc.ID)
		if d.ArchivedAt.Valid || !d.ShelvedAt.Valid || d.ShelveBatchID.String != shelf.BatchID {
			t.Fatalf("restored row: archived=%v shelved=%v batch=%q, want live and still shelved", d.ArchivedAt.Valid, d.ShelvedAt.Valid, d.ShelveBatchID.String)
		}
		// The restore's document payload carries shelved_at (spec Q-UI3).
		if !res.View.Document.ShelvedAt.Valid {
			t.Fatal("restore answer drops shelved_at")
		}
	})

	t.Run("SH-4: purge of a shelved trashed item works", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		purged, err := f.svc.PurgeDocument(f.ctx, owner, doc.ID)
		if err != nil {
			t.Fatalf("purge shelved+trashed: %v", err)
		}
		if len(purged) != 1 || purged[0] != doc.ID {
			t.Fatalf("purged = %v, want [%s]", purged, doc.ID)
		}
		if _, err := f.q.GetDocumentByID(f.ctx, doc.ID); err == nil {
			t.Fatal("purged document still exists")
		}
	})

	t.Run("SH-4: a leftover shelved child re-roots like every leftover child", func(t *testing.T) {
		folder := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, kind: DocumentKindFolder, title: "Thư mục leftover"})
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: folder.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, owner, folder.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, folder.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		// Purging the batch removes both rows.
		purged, err := f.svc.PurgeDocument(f.ctx, owner, folder.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(purged) != 2 {
			t.Fatalf("purged = %v, want folder and child (same trash batch)", purged)
		}
		if _, err := f.q.GetDocumentByID(f.ctx, folder.ID); err == nil {
			t.Fatal("folder still exists")
		}
		if _, err := f.q.GetDocumentByID(f.ctx, child.ID); err == nil {
			t.Fatal("child still exists (same batch purged it)")
		}

		// Same shape but the child survives the purge by staying unmanaged:
		// restricted child, member manages only the folder.
		folder2 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID, createdBy: tn.member.ID, kind: DocumentKindFolder, title: "Thư mục leftover2"})
		child2 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: folder2.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, owner, folder2.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, folder2.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		purged, err = f.svc.PurgeDocument(f.ctx, Human(tn.member.ID), folder2.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(purged) != 1 || purged[0] != folder2.ID {
			t.Fatalf("purged = %v, want only the folder (child is unmanaged)", purged)
		}
		rest := shelvedRow(t, f, child2.ID)
		if !rest.ArchivedAt.Valid || !rest.ShelvedAt.Valid || rest.ParentID.Valid {
			t.Fatalf("leftover child: archived=%v shelved=%v parent=%v, want trashed, shelved, re-rooted",
				rest.ArchivedAt.Valid, rest.ShelvedAt.Valid, rest.ParentID)
		}
		// And its restore lands it at the workspace root still shelved.
		if _, err := f.svc.RestoreDocument(f.ctx, owner, child2.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		rest = shelvedRow(t, f, child2.ID)
		if rest.ArchivedAt.Valid || !rest.ShelvedAt.Valid || rest.ParentID.Valid {
			t.Fatalf("restored leftover: archived=%v shelved=%v parent=%v, want live, shelved, at root",
				rest.ArchivedAt.Valid, rest.ShelvedAt.Valid, rest.ParentID)
		}
	})

	t.Run("unshelve of a shelved item sitting in the trash clears it there", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		res, err := f.svc.UnshelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("unshelve in trash: %v", err)
		}
		if len(res.Affected) != 1 {
			t.Fatalf("unshelve in trash affected %v, want 1", res.Affected)
		}
		d := shelvedRow(t, f, doc.ID)
		if !d.ArchivedAt.Valid || d.ShelvedAt.Valid {
			t.Fatalf("after unshelve in trash: archived=%v shelved=%v, want trashed and unshelved", d.ArchivedAt.Valid, d.ShelvedAt.Valid)
		}
	})

	t.Run("shelve of a trashed item stamps it shelved without restoring it", func(t *testing.T) {
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ArchiveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		res, err := f.svc.ShelveDocument(f.ctx, owner, doc.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("shelve in trash: %v", err)
		}
		if len(res.Affected) != 1 || res.Affected[0] != doc.ID {
			t.Fatalf("shelve in trash affected %v, want [%s]", res.Affected, doc.ID)
		}
		d := shelvedRow(t, f, doc.ID)
		if !d.ArchivedAt.Valid || !d.ShelvedAt.Valid || !d.PurgeAfter.Valid {
			t.Fatalf("shelved-in-trash: archived=%v shelved=%v purge_after=%v, want trashed and shelved",
				d.ArchivedAt.Valid, d.ShelvedAt.Valid, d.PurgeAfter.Valid)
		}
	})
}
