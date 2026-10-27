package service

// UNI-2074 (D1-4 of UNI-2055): ADR 0037 point 5 for every trashed root. A page,
// a file with children, a legacy private folder or a My Folder sub-folder
// takes the same plan as a workspace folder: a page or file below that the
// actor cannot manage - hidden from them, or readable without manage - moves
// to the workspace root with its own subtree, access and title instead of
// being trashed (an admin) or refusing the command (a member). A folder below
// that the actor cannot read or manage still refuses the whole command.

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// foreignPage inserts a restricted page owned by A (tn.member) under parent:
// nobody else reads it unless A shares it.
func (e *wsFolderEnv) foreignPage(t *testing.T, parent, title string) db.Document {
	t.Helper()
	return e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: parent, title: title})
}

// relocationRow reads the document.moved row a trash wrote for id.
func (e *wsFolderEnv) relocationRow(t *testing.T, id string) (reason, from, fromKind, batch string) {
	t.Helper()
	if err := e.f.pool.QueryRow(e.f.ctx, `SELECT metadata::jsonb->>'reason', metadata::jsonb->>'from_folder_id',
		coalesce(metadata::jsonb->>'from_kind', ''), metadata::jsonb->>'batch_id'
		FROM audit_events WHERE action = 'document.moved' AND resource_id = $1`, id).Scan(&reason, &from, &fromKind, &batch); err != nil {
		t.Fatalf("document.moved row of %s: %v", id, err)
	}
	return reason, from, fromKind, batch
}

func TestPageRootTrashRelocatesWhatAnAdminCannotRead(t *testing.T) {
	e := newWSFolderEnv(t)
	const corr = "corr-page-root-trash-2074"
	ctx := audit.WithRequest(e.f.ctx, audit.RequestInfo{CorrelationID: corr})
	root := e.mkPage(t, e.admin, "", "Trang của quản trị")
	hidden := e.foreignPage(t, root.ID, "Riêng của A")
	under := e.foreignPage(t, hidden.ID, "Con riêng của A")
	if _, err := e.svc.GetDocument(ctx, e.admin, hidden.ID); err == nil {
		t.Fatal("the admin reads A's restricted page, the fixture does not hold the case")
	}

	impact, err := e.svc.ArchiveImpact(ctx, e.admin, root.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if want := (DocumentArchiveImpact{Total: 1, Relocated: 1, MaxNodes: documentArchiveMaxNodes}); impact != want {
		t.Fatalf("impact = %+v, want %+v", impact, want)
	}
	res, err := e.svc.ArchiveDocument(ctx, e.admin, root.ID, ArchiveDocumentInput{})
	if err != nil {
		t.Fatalf("admin trashes the page root: %v", err)
	}
	if len(res.Affected) != impact.Total {
		t.Fatalf("archive stamped %d rows, the preview promised %d", len(res.Affected), impact.Total)
	}
	wantTrashed(t, e.doc(t, root.ID), res.BatchID, "page root")
	moved := e.doc(t, hidden.ID)
	wantAtRoot(t, moved, "A's restricted sub-page")
	if moved.Title != hidden.Title || moved.Visibility != hidden.Visibility || moved.AclOwnerID != hidden.AclOwnerID ||
		moved.WorkspaceLevel != hidden.WorkspaceLevel {
		t.Fatalf("A's page changed beyond its place: %+v -> %+v", hidden, moved)
	}
	if got := e.doc(t, under.ID); got.ParentID.String != hidden.ID || got.ArchivedAt.Valid {
		t.Fatalf("page under the relocated one = parent %q archived %v", got.ParentID.String, got.ArchivedAt.Valid)
	}
	reason, from, fromKind, batch := e.relocationRow(t, hidden.ID)
	if reason != audit.ReasonFolderTrashed || from != root.ID || fromKind != DocumentKindPage || batch != res.BatchID {
		t.Fatalf("audit row = %s from %s (%s) batch %s; want %s from %s (page) batch %s",
			reason, from, fromKind, batch, audit.ReasonFolderTrashed, root.ID, res.BatchID)
	}
	if n := e.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'
		AND payload::jsonb->>'document_id' = $1 AND correlation_id = $2`, hidden.ID, corr); n != 1 {
		t.Fatalf("%d document.moved outbox rows in the command, want 1", n)
	}

	// Restore brings back only the trashed batch; the relocated page stays.
	if _, err := e.svc.RestoreDocument(ctx, e.admin, root.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("admin restores the page root: %v", err)
	}
	if d := e.doc(t, root.ID); d.ArchivedAt.Valid {
		t.Fatal("page root still in the trash after restore")
	}
	wantAtRoot(t, e.doc(t, hidden.ID), "relocated page after restore")
}

func TestPageRootTrashByAMemberRelocatesInsteadOfRefusing(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	root := e.mkPage(t, e.b, "", "Trang của B")
	hidden := e.foreignPage(t, root.ID, "Ẩn của A")
	shared := e.foreignPage(t, root.ID, "A chia cho B")
	if _, err := e.svc.ShareDocument(ctx, e.a, shared.ID, DocumentShareInput{
		PrincipalType: "user", PrincipalID: e.tn.creator.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("A shares with B: %v", err)
	}
	if _, err := e.svc.GetDocument(ctx, e.b, hidden.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B reads A's restricted page = %v, want not found", err)
	}

	impact, err := e.svc.ArchiveImpact(ctx, e.b, root.ID)
	if err != nil {
		t.Fatalf("member impact over someone else's sub-pages: %v", err)
	}
	if want := (DocumentArchiveImpact{Total: 1, Relocated: 2, MaxNodes: documentArchiveMaxNodes}); impact != want {
		t.Fatalf("impact = %+v, want %+v", impact, want)
	}
	res := e.trash(t, e.b, root.ID)
	wantTrashed(t, e.doc(t, root.ID), res.BatchID, "B's page")
	wantAtRoot(t, e.doc(t, hidden.ID), "A's hidden page")
	wantAtRoot(t, e.doc(t, shared.ID), "A's page B edits without manage")
	if lvl, err := e.svc.effectiveLevel(ctx, e.f.svc.q, e.b, e.doc(t, shared.ID)); err != nil || lvl.Level != DocumentLevelEdit {
		t.Fatalf("B's level after the trash = %+v, %v, want edit", lvl, err)
	}
	if _, err := e.svc.GetDocument(ctx, e.b, hidden.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B reads A's page after the trash = %v, want not found (access unchanged)", err)
	}
}

func TestPageRootTrashRelocatesADeepHiddenPageWithItsSubtree(t *testing.T) {
	e := newWSFolderEnv(t)
	root := e.mkPage(t, e.b, "", "Gốc B")
	mine := e.mkPage(t, e.b, root.ID, "Con của B")
	hidden := e.foreignPage(t, mine.ID, "Cháu của A")
	under := e.foreignPage(t, hidden.ID, "Chắt của A")

	impact, err := e.svc.ArchiveImpact(e.f.ctx, e.b, root.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if want := (DocumentArchiveImpact{Documents: 1, Total: 2, Relocated: 1, MaxNodes: documentArchiveMaxNodes}); impact != want {
		t.Fatalf("impact = %+v, want %+v", impact, want)
	}
	res := e.trash(t, e.b, root.ID)
	wantTrashed(t, e.doc(t, root.ID), res.BatchID, "root")
	wantTrashed(t, e.doc(t, mine.ID), res.BatchID, "B's sub-page")
	wantAtRoot(t, e.doc(t, hidden.ID), "A's hidden page")
	if got := e.doc(t, under.ID); got.ParentID.String != hidden.ID || got.ArchivedAt.Valid {
		t.Fatalf("A's page under the relocated one = parent %q archived %v", got.ParentID.String, got.ArchivedAt.Valid)
	}
	if n := e.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND resource_id = $1`, under.ID); n != 0 {
		t.Fatalf("%d document.moved rows for the page that kept its parent, want 0", n)
	}
}

func TestLegacyPrivateFolderRootTrashRelocatesAHiddenPage(t *testing.T) {
	e := newWSFolderEnv(t)
	legacy := e.mkFolder(t, e.b, "", "Thư mục riêng cũ của B")
	e.legacyFolderRow(t, legacy.ID, documentVisibilityRestricted, string(DocumentLevelView))
	mine := e.mkPage(t, e.b, legacy.ID, "Của B")
	hidden := e.foreignPage(t, legacy.ID, "Ẩn của A")

	impact, err := e.svc.ArchiveImpact(e.f.ctx, e.b, legacy.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if want := (DocumentArchiveImpact{Documents: 1, Total: 2, Relocated: 1, MaxNodes: documentArchiveMaxNodes}); impact != want {
		t.Fatalf("impact = %+v, want %+v", impact, want)
	}
	res := e.trash(t, e.b, legacy.ID)
	wantTrashed(t, e.doc(t, legacy.ID), res.BatchID, "legacy folder")
	wantTrashed(t, e.doc(t, mine.ID), res.BatchID, "B's page")
	wantAtRoot(t, e.doc(t, hidden.ID), "A's hidden page")
	if _, _, fromKind, _ := e.relocationRow(t, hidden.ID); fromKind != DocumentKindFolder {
		t.Fatalf("from_kind = %q, want folder", fromKind)
	}
}

// Folders never relocate (unique name index, ADR 0037 point 2): a legacy
// private folder of someone else's below the root refuses the whole command
// and its impact read, and nothing is written.
func TestLegacyPrivateFolderRootTrashRefusesAForeignSubFolder(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	legacy := e.mkFolder(t, e.b, "", "Thư mục riêng cũ có con lạ")
	e.legacyFolderRow(t, legacy.ID, documentVisibilityRestricted, string(DocumentLevelView))
	hidden := e.foreignPage(t, legacy.ID, "Ẩn của A")
	private := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, kind: DocumentKindFolder, visibility: "restricted",
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID, parent: legacy.ID, title: "Thư mục riêng của A"})

	ids := []string{legacy.ID, hidden.ID, private.ID}
	snapshot := func() (rows []db.Document, audits int) {
		for _, id := range ids {
			rows = append(rows, e.doc(t, id))
		}
		return rows, e.count(t, `SELECT count(*) FROM audit_events WHERE workspace_id = $1`, e.tn.wsA)
	}
	before, auditsBefore := snapshot()
	if _, err := e.svc.ArchiveDocument(ctx, e.b, legacy.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("trash over a foreign private sub-folder = %v, want forbidden", err)
	}
	if _, err := e.svc.ArchiveImpact(ctx, e.b, legacy.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("impact over a foreign private sub-folder = %v, want forbidden", err)
	}
	after, auditsAfter := snapshot()
	for i := range ids {
		if after[i].ArchivedAt.Valid != before[i].ArchivedAt.Valid || after[i].ParentID != before[i].ParentID ||
			after[i].Revision != before[i].Revision {
			t.Fatalf("%s changed by a refused trash: %+v -> %+v", ids[i], before[i], after[i])
		}
	}
	if auditsAfter != auditsBefore {
		t.Fatalf("audit rows %d -> %d, want none written by a refused trash", auditsBefore, auditsAfter)
	}
}

// A root inside My Folder relocates to the workspace root too, never into a
// My Folder (contract Q4 A).
func TestMyFolderSubFolderTrashRelocatesToTheWorkspaceRoot(t *testing.T) {
	e := newWSFolderEnv(t)
	mf, _, err := e.svc.EnsureMyFolder(e.f.ctx, e.b, e.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	sub := e.mkFolder(t, e.b, mf.Document.ID, "Con trong My Folder của B")
	hidden := e.foreignPage(t, sub.ID, "Trang của A")

	impact, err := e.svc.ArchiveImpact(e.f.ctx, e.b, sub.ID)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if want := (DocumentArchiveImpact{Total: 1, Relocated: 1, MaxNodes: documentArchiveMaxNodes}); impact != want {
		t.Fatalf("impact = %+v, want %+v", impact, want)
	}
	res := e.trash(t, e.b, sub.ID)
	wantTrashed(t, e.doc(t, sub.ID), res.BatchID, "My Folder sub-folder")
	wantAtRoot(t, e.doc(t, hidden.ID), "A's page from B's My Folder")
	if d := e.doc(t, mf.Document.ID); d.ArchivedAt.Valid {
		t.Fatal("the My Folder itself went to the trash")
	}
}

// An agent never trashes (capped at view): the root gate refuses before any
// plan, on a page root exactly as on a workspace folder, and nothing moves.
func TestPageRootTrashByAnAgentIsRefusedAtTheRoot(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	agent := agentActor(e.tn.agent)
	root := e.f.treeDoc(t, e.tn, treeDocSpec{ws: e.tn.wsA, visibility: "workspace",
		aclOwner: e.tn.creator.ID, createdBy: e.tn.creator.ID, title: "Trang chung của B"})
	hidden := e.foreignPage(t, root.ID, "Ẩn của A")
	if _, err := e.svc.ArchiveImpact(ctx, agent, root.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent impact = %v, want forbidden", err)
	}
	if _, err := e.svc.ArchiveDocument(ctx, agent, root.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent trash = %v, want forbidden", err)
	}
	if d := e.doc(t, hidden.ID); d.ParentID.String != root.ID || d.ArchivedAt.Valid {
		t.Fatalf("A's page = parent %q archived %v after a refused agent trash", d.ParentID.String, d.ArchivedAt.Valid)
	}
	if d := e.doc(t, root.ID); d.ArchivedAt.Valid {
		t.Fatal("a refused agent trash stamped the root")
	}
}
