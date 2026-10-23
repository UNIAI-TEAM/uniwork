package service

import "testing"

// BE-R2-4 (UNI-2056): the owner restore seams write the document_changed
// notice (document.change_noticed, verb restored) in the same Record call as
// their document.restored frame, like the public restore.
func TestOwnerRestoreSeamsWriteTheChangeNotice(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rnot")
	owner := Human(tn.owner.ID)

	notices := func(docID string) int {
		t.Helper()
		var n int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM outbox_events
			 WHERE topic = 'document.change_noticed'
			   AND payload::jsonb->>'document_id' = $1 AND payload::jsonb->>'verb' = 'restored'
			   AND payload::jsonb->>'workspace_id' = $2`, docID, tn.wsA).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	single := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "rnot-single", archived: true})
	bulk := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "rnot-bulk", archived: true})
	if got := notices(single.ID) + notices(bulk.ID); got != 0 {
		t.Fatalf("%d change notices before any restore", got)
	}

	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := f.svc.RestoreOwnedDocumentInTx(f.ctx, f.q.WithTx(tx), owner, tn.orgID, tn.wsA, single.ID)
	if err != nil || !ok {
		t.Fatalf("single owner restore = (%v, %v)", ok, err)
	}
	restored, err := f.svc.RestoreOwnedDocumentsInTx(f.ctx, f.q.WithTx(tx), owner, tn.orgID, tn.wsA, "rnot-bulk")
	if err != nil || len(restored) != 1 || restored[0] != bulk.ID {
		t.Fatalf("bulk owner restore = %v, %v; want [%s]", restored, err, bulk.ID)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}

	for name, id := range map[string]string{"RestoreOwnedDocumentInTx": single.ID, "RestoreOwnedDocumentsInTx": bulk.ID} {
		if got := notices(id); got != 1 {
			t.Errorf("%s wrote %d document.change_noticed rows (verb restored) for %s, want 1", name, got, id)
		}
	}
}
