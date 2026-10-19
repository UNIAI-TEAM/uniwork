package service

import (
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SH-S1 (UNI-1780): the workspace home row carries its own level
// (documents.workspace_level), the resolver and the list read it instead of a
// fixed edit, and a home-row change writes document.workspace_access_changed.

// setWorkspaceLevel re-levels one document's home row the way a write command
// does (the column is not exposed through the PATCH), and returns the row as
// the readers will see it.
func setWorkspaceLevel(t *testing.T, f *docPermFixture, doc db.Document, level string) db.Document {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = $2 WHERE id = $1`, doc.ID, level); err != nil {
		t.Fatalf("set workspace_level=%s: %v", level, err)
	}
	updated, err := f.q.GetDocumentByID(f.ctx, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	return updated
}

// TestWorkspaceLevelMigrationIsRightsNeutral pins the migration's neutrality:
// a document inserted the way the pre-migration schema held one (no
// workspace_level) takes the DEFAULT 'edit', and every existing viewer keeps
// exactly the level the resolver handed out before the column existed.
func TestWorkspaceLevelMigrationIsRightsNeutral(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1neutral")

	// f.doc inserts without workspace_level: the pre-migration row shape.
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	if doc.WorkspaceLevel != "edit" {
		t.Fatalf("a row inserted without workspace_level = %q, want the DEFAULT 'edit'", doc.WorkspaceLevel)
	}

	runPermCases(t, f, []permCase{
		{name: "member keeps edit", actor: Human(tn.member.ID), doc: doc, level: DocumentLevelEdit, via: DocumentViaMember},
		{name: "agent keeps view", actor: agentActor(tn.agent), doc: doc, level: DocumentLevelView, via: DocumentViaMember},
		{name: "workspace admin keeps manage", actor: Human(tn.wsAdmin.ID), doc: doc, level: DocumentLevelManage, via: DocumentViaMember},
		{name: "acl owner keeps manage", actor: Human(tn.aclOwner.ID), doc: doc, level: DocumentLevelManage, via: DocumentViaMember},
		{name: "outsider keeps none", actor: Human(tn.outsider.ID), doc: doc, level: DocumentLevelNone},
	})

	// The list row agrees with the resolver.
	page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	found := false
	for _, item := range page.Items {
		if item.Document.ID != doc.ID {
			continue
		}
		found = true
		if item.Access.Level != DocumentLevelEdit || item.Access.Via != DocumentViaMember {
			t.Fatalf("home row list access = %+v, want edit via member", item.Access)
		}
	}
	if !found {
		t.Fatal("the member's home-visible document is missing from the list")
	}

	// The home row never reaches manage (Q-S1): the CHECK refuses it.
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'manage' WHERE id = $1`, doc.ID); err == nil {
		t.Fatal("documents.workspace_level accepted 'manage'")
	}
}

// TestWorkspaceLevelHomeRowResolvesItsLevel is the SH-S1 matrix: a
// workspace-visible document resolves to the row's stored level for every
// effective member, and the write gates follow it - a view home row reads but
// never edits, a comment home row comments but never edits content.
func TestWorkspaceLevelHomeRowResolvesItsLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1levels")

	view := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	comment := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	edit := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	view = setWorkspaceLevel(t, f, view, "view")
	comment = setWorkspaceLevel(t, f, comment, "comment")

	runPermCases(t, f, []permCase{
		{name: "view home row reads", actor: Human(tn.member.ID), doc: view, level: DocumentLevelView, via: DocumentViaMember},
		{name: "comment home row reads and comments", actor: Human(tn.member.ID), doc: comment, level: DocumentLevelComment, via: DocumentViaMember},
		{name: "edit home row edits", actor: Human(tn.member.ID), doc: edit, level: DocumentLevelEdit, via: DocumentViaMember},
	})

	// A view home row is a read row: the content gate refuses an edit.
	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.member.ID), view.ID, UpdateDocumentInput{Revision: view.Revision, Title: strPtr("sửa")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a view home row allowed a title edit: %v", err)
	}
	// A comment home row comments (>= comment) but does not edit content.
	if _, err := f.svc.AddDocumentComment(f.ctx, Human(tn.member.ID), comment.ID, AddCommentInput{Body: "ý kiến"}, ""); err != nil {
		t.Fatalf("a comment home row refused a comment: %v", err)
	}
	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.member.ID), comment.ID, UpdateDocumentInput{Revision: comment.Revision, Title: strPtr("sửa")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a comment home row allowed a title edit: %v", err)
	}

	// The list carries the same level per row (listRowAccess).
	page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	byID := map[string]DocumentListItem{}
	for _, item := range page.Items {
		byID[item.Document.ID] = item
	}
	for id, want := range map[string]DocumentLevel{view.ID: DocumentLevelView, comment.ID: DocumentLevelComment, edit.ID: DocumentLevelEdit} {
		item, ok := byID[id]
		if !ok {
			t.Fatalf("home row %s missing from the member's list", id)
		}
		if item.Access.Level != want || item.Access.Via != DocumentViaMember {
			t.Fatalf("home row %s list access = %+v, want %q via member", id, item.Access, want)
		}
	}
}

// TestWorkspaceLevelListFilterDropsBelowMinimum pins the member_visible leg of
// the list SQL: a home row is kept only while its stored level reaches the
// minimum the caller asks for, so a view home row never passes an edit-level
// filter (SH-S1 §3) while every home row passes the view minimum the list,
// tree, recent and change-feed callers use.
func TestWorkspaceLevelListFilterDropsBelowMinimum(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1filter")

	view := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	comment := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	edit := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	setWorkspaceLevel(t, f, view, "view")
	setWorkspaceLevel(t, f, comment, "comment")

	ids := func(min DocumentLevel) map[string]bool {
		t.Helper()
		rows, err := f.q.ListDocumentsPage(f.ctx, db.ListDocumentsPageParams{
			OrganizationID: tn.orgID, WorkspaceID: tn.wsA,
			SeeAll: false, MemberVisible: true, AclOwner: true, ActorID: nullText(tn.member.ID),
			AllowShares: true, ShareLevels: shareLevelsFor(min),
			ShareWorkspaces: []string{tn.wsB}, PageLimit: 100,
		})
		if err != nil {
			t.Fatalf("list page at min=%s: %v", min, err)
		}
		out := map[string]bool{}
		for _, r := range rows {
			out[r.ID] = true
		}
		return out
	}

	// Every home row is view or above, so the view minimum keeps all three.
	if got := ids(DocumentLevelView); !got[view.ID] || !got[comment.ID] || !got[edit.ID] {
		t.Fatalf("view-level filter dropped a home row: %v", got)
	}
	// A comment minimum drops the view home row.
	got := ids(DocumentLevelComment)
	if got[view.ID] || !got[comment.ID] || !got[edit.ID] {
		t.Fatalf("comment-level filter kept %v, want comment and edit home rows only", got)
	}
	// An edit minimum drops both lower home rows - a view home row must never
	// pass an edit-level search or filter.
	got = ids(DocumentLevelEdit)
	if got[view.ID] || got[comment.ID] || !got[edit.ID] {
		t.Fatalf("edit-level filter kept %v, want the edit home row only", got)
	}
}

// TestWorkspaceLevelSearchPathCrossesAViewHomeRow keeps the ancestor walk
// honest: a search result under a view-level home folder still shows its path
// (listRowAccess on the constructed ancestor row reads the stored level).
func TestWorkspaceLevelSearchPathCrossesAViewHomeRow(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1path")

	folder := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET kind = 'folder', title = 'Hồ sơ' WHERE id = $1`, folder.ID); err != nil {
		t.Fatal(err)
	}
	setWorkspaceLevel(t, f, folder, "view")
	child := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = $1, title = 'Hợp đồng' WHERE id = $2`, folder.ID, child.ID); err != nil {
		t.Fatal(err)
	}

	page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{Query: "hợp đồng", Match: DocumentMatchTitle, Limit: 100})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, item := range page.Items {
		if item.Document.ID != child.ID {
			continue
		}
		if len(item.Path) != 1 || item.Path[0].ID != folder.ID {
			t.Fatalf("search path = %+v, want the view-level home folder", item.Path)
		}
		return
	}
	t.Fatal("the search did not return the child of the view home row")
}
