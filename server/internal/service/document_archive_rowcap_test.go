package service

// FD-03 (UNI-1463, addendum §3.2 r2): the archive walk is capped in rows, not
// only in depth. ListLiveDocumentSubtreeIDs stops after archiveBound()+1 live
// rows, archived nodes on the way are walked but not counted against the cap,
// and the manage gate reads the same bounded id set instead of walking the
// tree a second time.
//
// These are behaviour pins; the row-cap measurement (rows read vs N) lives in
// the FD03_EXPLAIN-gated TestFD03RowCapEvidence.

import (
	"fmt"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentArchiveRowCap(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	member := human(env.tn.member)
	f := env.f
	env.svc.archiveMaxNodes = 3

	doc := func(t *testing.T, parent, kind, title string, archived bool, aclOwner string) db.Document {
		t.Helper()
		return f.treeDoc(t, env.tn, treeDocSpec{
			ws: env.tn.wsA, visibility: "workspace", aclOwner: aclOwner, createdBy: aclOwner,
			parent: parent, kind: kind, title: title, archived: archived,
		})
	}

	t.Run("an archived node on the path is walked but does not count", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Gốc", false, env.tn.member.ID)
		middle := doc(t, root.ID, DocumentKindFolder, "Đã lưu trữ", true, env.tn.member.ID)
		leaf := doc(t, middle.ID, DocumentKindPage, "Còn sống", false, env.tn.member.ID)
		// A live child of the archived middle: the walk must pass through the
		// archived node to reach it.
		res, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("archive through an archived node: %v", err)
		}
		if len(res.Affected) != 2 {
			t.Fatalf("affected = %v, want the live root and leaf only", res.Affected)
		}
		f.archived(t, root.ID)
		f.archived(t, leaf.ID)
		f.archived(t, middle.ID) // untouched: it kept its own (older) state
	})

	t.Run("archived children never count against the live cap", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Nhiều mục lưu trữ", false, env.tn.member.ID)
		for i := 0; i < 5; i++ {
			doc(t, root.ID, DocumentKindPage, fmt.Sprintf("Lưu trữ %d", i), true, env.tn.member.ID)
		}
		live1 := doc(t, root.ID, DocumentKindPage, "Sống 1", false, env.tn.member.ID)
		live2 := doc(t, root.ID, DocumentKindPage, "Sống 2", false, env.tn.member.ID)
		// bound = 3: root + two live children is exactly the cap.
		res, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("archive at the live cap with archived siblings: %v", err)
		}
		if len(res.Affected) != 3 {
			t.Fatalf("affected = %v, want 3 live rows", res.Affected)
		}
		f.archived(t, live1.ID)
		f.archived(t, live2.ID)
	})

	t.Run("over the live cap refuses and writes nothing", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Quá trần", false, env.tn.member.ID)
		kids := make([]db.Document, 0, 4)
		for i := 0; i < 4; i++ {
			kids = append(kids, doc(t, root.ID, DocumentKindPage, fmt.Sprintf("Con %d", i), false, env.tn.member.ID))
		}
		_, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		ce := wantCode(t, err, "folder_too_large")
		if ce.Status != 422 {
			t.Fatalf("folder_too_large status = %d, want 422", ce.Status)
		}
		for _, id := range append([]string{root.ID}, []string{kids[0].ID, kids[1].ID, kids[2].ID, kids[3].ID}...) {
			f.live(t, id)
			if n := env.countAudit(t, "document.archived", id); n != 0 {
				t.Fatalf("%s: %d archive audit rows after a refused command, want 0", id, n)
			}
		}
	})
}
