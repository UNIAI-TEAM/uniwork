package service

// UNI-2055 S2 (ADR 0037 points 4, 5): trashing a workspace folder never
// trashes a document the actor cannot manage. Such a document - hidden from
// the actor, or visible without manage - moves to the workspace root with its
// own subtree, its access and title untouched, and one document.moved audit
// row (reason folder_trashed) in the archive transaction; everything else goes
// to the trash in one batch. Restore brings back only the trashed part. Only
// the folder's creator and the admins trash, restore or purge it. Emptiness of
// a folder is counted from what the viewer can read.

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (e *wsFolderEnv) doc(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := e.f.svc.q.GetDocumentByID(e.f.ctx, id)
	if err != nil {
		t.Fatalf("read %s: %v", id, err)
	}
	return d
}

func (e *wsFolderEnv) trash(t *testing.T, actor Actor, id string) DocumentArchiveResult {
	t.Helper()
	res, err := e.svc.ArchiveDocument(e.f.ctx, actor, id, ArchiveDocumentInput{})
	if err != nil {
		t.Fatalf("trash %s: %v", id, err)
	}
	return res
}

func wantAtRoot(t *testing.T, d db.Document, what string) {
	t.Helper()
	if d.ParentID.Valid || d.ArchivedAt.Valid {
		t.Fatalf("%s = parent %q archived %v, want live at the workspace root", what, d.ParentID.String, d.ArchivedAt.Valid)
	}
}

func wantTrashed(t *testing.T, d db.Document, batch, what string) {
	t.Helper()
	if !d.ArchivedAt.Valid || d.ArchiveBatchID.String != batch {
		t.Fatalf("%s archived=%v batch=%q, want in the trash with batch %q", what, d.ArchivedAt.Valid, d.ArchiveBatchID.String, batch)
	}
}

func TestFolderTrashRelocatesWhatTheActorCannotSee(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Thư mục của B")
	sub := e.mkFolder(t, e.b, folder.ID, "Con của B")
	mine := e.mkPage(t, e.b, folder.ID, "Trang của B")
	hidden := e.mkPage(t, e.a, sub.ID, "Bí mật của A")
	if _, err := e.svc.GetDocument(ctx, e.b, hidden.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B reads A's restricted page = %v, want not found", err)
	}

	res := e.trash(t, e.b, folder.ID)
	wantTrashed(t, e.doc(t, folder.ID), res.BatchID, "folder")
	wantTrashed(t, e.doc(t, sub.ID), res.BatchID, "sub-folder")
	wantTrashed(t, e.doc(t, mine.ID), res.BatchID, "B's page")
	moved := e.doc(t, hidden.ID)
	wantAtRoot(t, moved, "A's hidden page")
	if moved.Title != hidden.Title || moved.Visibility != hidden.Visibility || moved.WorkspaceLevel != hidden.WorkspaceLevel ||
		moved.AclOwnerID != hidden.AclOwnerID {
		t.Fatalf("A's page changed beyond its place: %+v -> %+v", hidden, moved)
	}
	for _, id := range res.Affected {
		if id == hidden.ID {
			t.Fatal("the archive answer names the page it relocated")
		}
	}
	if _, err := e.svc.GetDocument(ctx, e.a, hidden.ID); err != nil {
		t.Fatalf("A lost their page: %v", err)
	}
	if _, err := e.svc.GetDocument(ctx, e.b, hidden.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B reads A's page after the trash = %v, want not found (access unchanged)", err)
	}
}

func TestFolderTrashRelocatesWhatTheActorSeesButCannotManage(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Q1 thư mục")
	shared := e.mkPage(t, e.a, folder.ID, "A chia cho B")
	if _, err := e.svc.ShareDocument(ctx, e.a, shared.ID, DocumentShareInput{
		PrincipalType: "user", PrincipalID: e.tn.creator.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("A shares with B: %v", err)
	}
	child := e.mkPage(t, e.a, shared.ID, "Trang con của A")
	grandchild := e.mkPage(t, e.a, child.ID, "Trang cháu của A")

	res := e.trash(t, e.b, folder.ID)
	wantTrashed(t, e.doc(t, folder.ID), res.BatchID, "folder")
	wantAtRoot(t, e.doc(t, shared.ID), "page B edits but does not manage")
	// The relocated page keeps its own subtree.
	if got := e.doc(t, child.ID); got.ParentID.String != shared.ID || got.ArchivedAt.Valid {
		t.Fatalf("child page = parent %q archived %v, want live under %s", got.ParentID.String, got.ArchivedAt.Valid, shared.ID)
	}
	if got := e.doc(t, grandchild.ID); got.ParentID.String != child.ID || got.ArchivedAt.Valid {
		t.Fatalf("grandchild page = parent %q archived %v", got.ParentID.String, got.ArchivedAt.Valid)
	}
	if lvl, err := e.svc.effectiveLevel(ctx, e.f.svc.q, e.b, e.doc(t, shared.ID)); err != nil || lvl.Level != DocumentLevelEdit {
		t.Fatalf("B's level after the trash = %+v, %v, want edit", lvl, err)
	}
}

func TestFolderTrashRestoreBringsBackOnlyTheTrashedPart(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Khôi phục")
	subByA := e.mkFolder(t, e.a, folder.ID, "Thư mục con của A")
	mine := e.mkPage(t, e.b, folder.ID, "Trang B")
	hidden := e.mkPage(t, e.a, subByA.ID, "Trang A")

	res := e.trash(t, e.b, folder.ID)
	wantTrashed(t, e.doc(t, subByA.ID), res.BatchID, "A's sub-folder")
	if _, err := e.svc.RestoreDocument(ctx, e.b, folder.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("B restores the folder: %v", err)
	}
	for _, id := range []string{folder.ID, subByA.ID, mine.ID} {
		if d := e.doc(t, id); d.ArchivedAt.Valid {
			t.Fatalf("%s %q still in the trash after restore", id, d.Title)
		}
	}
	if got := e.doc(t, subByA.ID); got.ParentID.String != folder.ID {
		t.Fatalf("A's sub-folder parent = %q, want %s", got.ParentID.String, folder.ID)
	}
	wantAtRoot(t, e.doc(t, hidden.ID), "relocated page after restore")
}

func TestFolderTrashGate(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Cổng")
	page := e.mkPage(t, e.b, folder.ID, "Trang")
	// The admin trashes only what they read and manage (TV-02): B shares the
	// page with them, so it goes to the trash with the folder.
	if _, err := e.svc.ShareDocument(ctx, e.b, page.ID, DocumentShareInput{
		PrincipalType: "user", PrincipalID: e.tn.wsAdmin.ID, Level: DocumentLevelManage,
	}); err != nil {
		t.Fatalf("B shares the page with the admin: %v", err)
	}

	if _, err := e.svc.ArchiveDocument(ctx, e.a, folder.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member trashes another's workspace folder = %v, want forbidden", err)
	}
	if _, err := e.svc.ArchiveImpact(ctx, e.a, folder.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member previews the trash = %v, want forbidden", err)
	}
	if d := e.doc(t, folder.ID); d.ArchivedAt.Valid {
		t.Fatal("a refused trash stamped the folder")
	}
	res := e.trash(t, e.admin, folder.ID)
	wantTrashed(t, e.doc(t, page.ID), res.BatchID, "page trashed by the workspace admin")
	if _, err := e.svc.RestoreDocument(ctx, e.a, folder.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member restores another's workspace folder = %v, want forbidden", err)
	}
	if _, err := e.svc.PurgeDocument(ctx, e.a, folder.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member purges another's workspace folder = %v, want forbidden", err)
	}
	if _, err := e.svc.RestoreDocument(ctx, e.orgAdmin, folder.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("organization admin restores: %v", err)
	}
	e.trash(t, e.b, folder.ID)
	purged, err := e.svc.PurgeDocument(ctx, e.b, folder.ID)
	if err != nil || len(purged) != 2 {
		t.Fatalf("creator purges = %v, %v, want folder and page", purged, err)
	}
}

func TestFolderTrashImpactCountsRelocationWithoutLeaking(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Xem trước")
	e.mkFolder(t, e.b, folder.ID, "Con")
	e.mkPage(t, e.b, folder.ID, "Của B")
	hidden := e.mkPage(t, e.a, folder.ID, "Ẩn 1")
	e.mkPage(t, e.a, hidden.ID, "Ẩn con")
	e.mkPage(t, e.a, folder.ID, "Ẩn 2")

	got, err := e.svc.ArchiveImpact(ctx, e.b, folder.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	want := DocumentArchiveImpact{Folders: 1, Documents: 1, Total: 3, Relocated: 2, MaxNodes: documentArchiveMaxNodes}
	if got != want {
		t.Fatalf("impact = %+v, want %+v", got, want)
	}
	// The admin administers the pages but reads none of them (restricted, no
	// share): what the actor cannot see relocates too (UNI-2055 TV-02), so only
	// the two folders go to the trash.
	adminView, err := e.svc.ArchiveImpact(ctx, e.admin, folder.ID)
	if err != nil {
		t.Fatal(err)
	}
	if wantAdmin := (DocumentArchiveImpact{Folders: 1, Documents: 0, Total: 2, Relocated: 3, MaxNodes: documentArchiveMaxNodes}); adminView != wantAdmin {
		t.Fatalf("admin impact = %+v, want %+v", adminView, wantAdmin)
	}
	res := e.trash(t, e.b, folder.ID)
	if len(res.Affected) != got.Total {
		t.Fatalf("archive stamped %d rows, the preview promised %d", len(res.Affected), got.Total)
	}
}

func TestFolderTrashRelocationAuditHook(t *testing.T) {
	e := newWSFolderEnv(t)
	const corr = "corr-folder-trash-2055"
	ctx := audit.WithRequest(e.f.ctx, audit.RequestInfo{CorrelationID: corr})
	folder := e.mkFolder(t, e.b, "", "Móc audit")
	hidden := e.mkPage(t, e.a, folder.ID, "Của A")
	under := e.mkPage(t, e.a, hidden.ID, "Con của A")

	countMoved := func() (auditRows, outboxRows int) {
		auditRows = e.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND resource_id = $1
			AND metadata::jsonb->>'reason' = $2`, hidden.ID, audit.ReasonFolderTrashed)
		outboxRows = e.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'
			AND payload::jsonb->>'document_id' = $1 AND correlation_id = $2`, hidden.ID, corr)
		return
	}

	// A forced failure after the relocation rolls everything back.
	folderTrashAfterRelocate = func(context.Context) error { return errors.New("forced rollback") }
	_, err := e.svc.ArchiveDocument(ctx, e.b, folder.ID, ArchiveDocumentInput{})
	folderTrashAfterRelocate = nil
	if err == nil || err.Error() != "forced rollback" {
		t.Fatalf("forced archive = %v, want the forced error", err)
	}
	if a, o := countMoved(); a != 0 || o != 0 {
		t.Fatalf("after rollback: %d audit, %d outbox rows, want none", a, o)
	}
	if d := e.doc(t, hidden.ID); d.ParentID.String != folder.ID {
		t.Fatalf("after rollback the page sits under %q", d.ParentID.String)
	}

	res, err := e.svc.ArchiveDocument(ctx, e.b, folder.ID, ArchiveDocumentInput{})
	if err != nil {
		t.Fatal(err)
	}
	if a, o := countMoved(); a != 1 || o != 1 {
		t.Fatalf("after commit: %d audit, %d outbox rows, want one each", a, o)
	}
	var resourceType, reason, from, batch, auditCorr string
	if err := e.f.pool.QueryRow(e.f.ctx, `SELECT resource_type, metadata::jsonb->>'reason', metadata::jsonb->>'from_folder_id',
		metadata::jsonb->>'batch_id', correlation_id FROM audit_events WHERE action = 'document.moved' AND resource_id = $1`,
		hidden.ID).Scan(&resourceType, &reason, &from, &batch, &auditCorr); err != nil {
		t.Fatal(err)
	}
	if resourceType != "document" || reason != "folder_trashed" || from != folder.ID || batch != res.BatchID || auditCorr != corr {
		t.Fatalf("audit row = %s %s from %s batch %s corr %s; want document folder_trashed %s %s %s",
			resourceType, reason, from, batch, auditCorr, folder.ID, res.BatchID, corr)
	}
	// Only the relocated document has a row: the folder never, the page under
	// it neither (its parent did not change).
	if n := e.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND resource_id = ANY($1)`,
		[]string{folder.ID, under.ID}); n != 0 {
		t.Fatalf("%d document.moved rows on the folder or the page under the relocated one", n)
	}
	var payload string
	if err := e.f.pool.QueryRow(e.f.ctx, `SELECT payload FROM outbox_events WHERE topic = 'document.moved'
		AND payload::jsonb->>'document_id' = $1`, hidden.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if payload != `{"document_id":"`+hidden.ID+`","workspace_id":"`+e.tn.wsA+`"}` {
		t.Fatalf("document.moved payload = %s, want ids only", payload)
	}
}

func folderEmptyFlag(t *testing.T, nodes []DocumentTreeNode, id string) *bool {
	t.Helper()
	for _, n := range nodes {
		if n.ID == id {
			return n.IsEmpty
		}
		if f := folderEmptyFlag(t, n.Children, id); f != nil {
			return f
		}
	}
	return nil
}

func TestWorkspaceFolderEmptinessIsPerViewer(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	onlyA := e.mkFolder(t, e.b, "", "Chỉ A có trang")
	e.mkPage(t, e.a, onlyA.ID, "Riêng A")
	withSub := e.mkFolder(t, e.b, "", "Có thư mục con")
	e.mkFolder(t, e.a, withSub.ID, "Con")
	empty := e.mkFolder(t, e.b, "", "Rỗng")

	for _, tc := range []struct {
		viewer Actor
		name   string
		want   map[string]bool
	}{
		{e.a, "A", map[string]bool{onlyA.ID: false, withSub.ID: false, empty.ID: true}},
		{e.b, "B", map[string]bool{onlyA.ID: true, withSub.ID: false, empty.ID: true}},
	} {
		for _, foldersOnly := range []bool{false, true} {
			tree, err := e.svc.DocumentTree(ctx, tc.viewer, e.tn.wsA, "", foldersOnly)
			if err != nil {
				t.Fatal(err)
			}
			for id, want := range tc.want {
				got := folderEmptyFlag(t, tree, id)
				if got == nil || *got != want {
					t.Fatalf("%s tree (folders only %v): is_empty of %s = %v, want %v", tc.name, foldersOnly, id, got, want)
				}
			}
		}
		root := ""
		page, err := e.svc.ListDocuments(ctx, tc.viewer, e.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		for id, want := range tc.want {
			found := false
			for _, it := range page.Items {
				if it.Document.ID != id {
					continue
				}
				found = true
				if it.IsEmpty == nil || *it.IsEmpty != want {
					t.Fatalf("%s list: is_empty of %s = %v, want %v", tc.name, id, it.IsEmpty, want)
				}
			}
			if !found {
				t.Fatalf("%s list misses folder %s (a folder empty for the viewer still lists)", tc.name, id)
			}
		}
	}
}

// S2-R1-1: only workspace folders ride along to the trash. A legacy restricted
// folder of someone else's below the workspace folder is not the actor's to
// trash, so the whole command refuses as before ADR 0037 - it is never put in
// the relocate set (folders have a unique name index) and the impact read
// refuses with it.
func TestFolderTrashRefusesAForeignRestrictedFolder(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Thư mục chung")
	mine := e.mkPage(t, e.b, folder.ID, "Của B")
	private := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, kind: DocumentKindFolder, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: folder.ID, title: "Riêng của A"})
	inside := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: private.ID, title: "Trang riêng của A"})

	ids := []string{folder.ID, mine.ID, private.ID, inside.ID}
	snapshot := func() (rows []db.Document, audits int) {
		for _, id := range ids {
			rows = append(rows, e.doc(t, id))
		}
		return rows, e.count(t, `SELECT count(*) FROM audit_events WHERE workspace_id = $1`, e.tn.wsA)
	}
	before, auditsBefore := snapshot()

	if _, err := e.svc.ArchiveDocument(ctx, e.b, folder.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("trash over a foreign restricted folder = %v, want forbidden", err)
	}
	if _, err := e.svc.ArchiveImpact(ctx, e.b, folder.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("impact over a foreign restricted folder = %v, want forbidden", err)
	}
	after, auditsAfter := snapshot()
	for i := range ids {
		if after[i].ArchivedAt.Valid != before[i].ArchivedAt.Valid || after[i].ParentID != before[i].ParentID ||
			after[i].Revision != before[i].Revision || after[i].Position != before[i].Position {
			t.Fatalf("%s changed by a refused trash: %+v -> %+v", ids[i], before[i], after[i])
		}
	}
	if auditsAfter != auditsBefore {
		t.Fatalf("audit rows %d -> %d, want none written by a refused trash", auditsBefore, auditsAfter)
	}
}

// D1-2: the same refusal for a workspace admin. An admin administers a legacy
// private folder without reading it (AdminScope alone), and the trash is for
// what the actor reads and manages, so the admin does not trash it either; the
// whole command and its impact read refuse, and nothing is written.
func TestFolderTrashRefusesAForeignRestrictedFolderForAnAdmin(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	admin := Human(e.tn.wsAdmin.ID)
	folder := e.mkFolder(t, e.b, "", "Thư mục chung của admin")
	mine := e.mkPage(t, e.b, folder.ID, "Của B")
	private := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, kind: DocumentKindFolder, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: folder.ID, title: "Riêng của A (admin)"})
	inside := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: private.ID, title: "Trang riêng của A (admin)"})

	ids := []string{folder.ID, mine.ID, private.ID, inside.ID}
	snapshot := func() (rows []db.Document, audits int) {
		for _, id := range ids {
			rows = append(rows, e.doc(t, id))
		}
		return rows, e.count(t, `SELECT count(*) FROM audit_events WHERE workspace_id = $1`, e.tn.wsA)
	}
	before, auditsBefore := snapshot()

	if _, err := e.svc.ArchiveDocument(ctx, admin, folder.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin trash over a foreign restricted folder = %v, want forbidden", err)
	}
	if _, err := e.svc.ArchiveImpact(ctx, admin, folder.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin impact over a foreign restricted folder = %v, want forbidden", err)
	}
	after, auditsAfter := snapshot()
	for i := range ids {
		if after[i].ArchivedAt.Valid != before[i].ArchivedAt.Valid || after[i].ParentID != before[i].ParentID ||
			after[i].Revision != before[i].Revision || after[i].Position != before[i].Position {
			t.Fatalf("%s changed by a refused trash: %+v -> %+v", ids[i], before[i], after[i])
		}
	}
	if auditsAfter != auditsBefore {
		t.Fatalf("audit rows %d -> %d, want none written by a refused trash", auditsBefore, auditsAfter)
	}
}

// S2-R1-2: the 403 a trashed workspace folder gives readers is for people. An
// agent, a person outside the workspace and a member of another workspace get
// the same not found as anyone who cannot read it.
func TestFolderTrashGateHidesTheFolderFromNonMembers(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.b, "", "Cổng ẩn")
	e.trash(t, e.b, folder.ID)

	callers := []struct {
		name  string
		actor Actor
	}{
		{"agent in the workspace", agentActor(e.tn.agent)},
		{"agent of the organization outside the workspace", agentActor(e.tn.agentOut)},
		{"organization member in no workspace", human(e.tn.outsider)},
		{"member of the other workspace", human(e.tn.bMember)},
	}
	for _, c := range callers {
		if _, err := e.svc.RestoreDocument(ctx, c.actor, folder.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s restores a trashed workspace folder = %v, want not found", c.name, err)
		}
		if _, err := e.svc.PurgeDocument(ctx, c.actor, folder.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s purges a trashed workspace folder = %v, want not found", c.name, err)
		}
		if _, err := e.svc.ArchiveImpact(ctx, c.actor, folder.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s previews a trashed workspace folder = %v, want not found", c.name, err)
		}
	}
}

// S2-R1-3: the bound is checked before anything is relocated. A workspace
// folder over it, holding a page the actor cannot see, answers folder_too_large
// and leaves the page where it was, with no document.moved row.
func TestFolderTrashBoundBeatsRelocation(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	e.svc.archiveMaxNodes = 3
	defer func() { e.svc.archiveMaxNodes = 0 }()
	folder := e.mkFolder(t, e.b, "", "Quá trần")
	e.mkPage(t, e.b, folder.ID, "Một")
	e.mkPage(t, e.b, folder.ID, "Hai")
	hidden := e.mkPage(t, e.a, folder.ID, "Ẩn của A")

	_, err := e.svc.ArchiveDocument(ctx, e.b, folder.ID, ArchiveDocumentInput{})
	if ce := wantCode(t, err, "folder_too_large"); ce.Status != 422 {
		t.Fatalf("folder_too_large status = %d, want 422", ce.Status)
	}
	if d := e.doc(t, hidden.ID); d.ParentID.String != folder.ID || d.ArchivedAt.Valid {
		t.Fatalf("A's page = parent %q archived %v, want still live under the folder", d.ParentID.String, d.ArchivedAt.Valid)
	}
	if d := e.doc(t, folder.ID); d.ArchivedAt.Valid {
		t.Fatal("a refused archive stamped the folder")
	}
	if n := e.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND workspace_id = $1`, e.tn.wsA); n != 0 {
		t.Fatalf("%d document.moved rows after a refused archive, want 0", n)
	}
	if got, err := e.svc.ArchiveImpact(ctx, e.b, folder.ID); err != nil || !got.TooLarge {
		t.Fatalf("impact over the bound = %+v, %v, want too_large", got, err)
	}
}

// TV-02 (card rules 6 and 7, Q1): an admin who administers a page without
// reading it (restricted, no share) does not trash it with the folder either.
// The page goes to the workspace root with its subtree, access and title, is
// left out of the impact's documents and total, and counts as relocated.
func TestFolderTrashRelocatesWhatAnAdminCannotRead(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.admin, "", "Thư mục của quản trị")
	mine := e.mkPage(t, e.admin, folder.ID, "Của quản trị")
	hidden := e.mkPage(t, e.a, folder.ID, "Riêng của B")
	under := e.mkPage(t, e.a, hidden.ID, "Con của B")
	if _, err := e.svc.GetDocument(ctx, e.admin, hidden.ID); err == nil {
		t.Fatal("the admin reads B's restricted page, the fixture does not hold the case")
	}

	got, err := e.svc.ArchiveImpact(ctx, e.admin, folder.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if want := (DocumentArchiveImpact{Folders: 0, Documents: 1, Total: 2, Relocated: 1, MaxNodes: documentArchiveMaxNodes}); got != want {
		t.Fatalf("impact = %+v, want %+v", got, want)
	}
	res := e.trash(t, e.admin, folder.ID)
	if len(res.Affected) != got.Total {
		t.Fatalf("archive stamped %d rows, the preview promised %d", len(res.Affected), got.Total)
	}
	wantTrashed(t, e.doc(t, folder.ID), res.BatchID, "folder")
	wantTrashed(t, e.doc(t, mine.ID), res.BatchID, "the admin's own page")
	moved := e.doc(t, hidden.ID)
	wantAtRoot(t, moved, "B's restricted page")
	if moved.Title != hidden.Title || moved.Visibility != hidden.Visibility || moved.AclOwnerID != hidden.AclOwnerID {
		t.Fatalf("B's page changed beyond its place: %+v -> %+v", hidden, moved)
	}
	if got := e.doc(t, under.ID); got.ParentID.String != hidden.ID || got.ArchivedAt.Valid {
		t.Fatalf("page under the relocated one = parent %q archived %v", got.ParentID.String, got.ArchivedAt.Valid)
	}
	if n := e.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND resource_id = $1
		AND metadata::jsonb->>'reason' = $2`, hidden.ID, audit.ReasonFolderTrashed); n != 1 {
		t.Fatalf("%d folder_trashed rows for B's page, want 1", n)
	}
	if _, err := e.svc.GetDocument(ctx, e.a, hidden.ID); err != nil {
		t.Fatalf("B lost their page: %v", err)
	}
}
