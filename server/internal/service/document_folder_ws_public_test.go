package service

// UNI-2055 S1 (ADR 0037): a folder outside every My Folder tree is visible to
// the whole workspace (workspace/view, set by its location), documents stay
// private by default, every human member may create inside a workspace
// folder, only its creator and the admins rename or move it, a workspace
// folder never enters a My Folder tree, a My Folder sub-folder moved out
// opens with its sub-folders, and a folder create that clashes gets " (n)".

import (
	"bytes"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type wsFolderEnv struct {
	*docStorageEnv
	a, b, admin, orgAdmin Actor
}

func newWSFolderEnv(t *testing.T) *wsFolderEnv {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	return &wsFolderEnv{
		docStorageEnv: env,
		a:             human(env.tn.member),
		b:             human(env.tn.creator),
		admin:         human(env.tn.wsAdmin),
		orgAdmin:      human(env.tn.orgAdmin),
	}
}

func (e *wsFolderEnv) mkFolder(t *testing.T, actor Actor, parentID, title string) db.Document {
	t.Helper()
	v, err := e.svc.CreatePage(e.f.ctx, actor, e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: parentID, Title: title})
	if err != nil {
		t.Fatalf("create folder %q: %v", title, err)
	}
	return v.Document
}

func (e *wsFolderEnv) mkPage(t *testing.T, actor Actor, parentID, title string) db.Document {
	t.Helper()
	v, err := e.svc.CreatePage(e.f.ctx, actor, e.tn.wsA, CreatePageInput{ParentID: parentID, Title: title})
	if err != nil {
		t.Fatalf("create page %q: %v", title, err)
	}
	return v.Document
}

func (e *wsFolderEnv) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(e.f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func wantWorkspaceFolder(t *testing.T, d db.Document, what string) {
	t.Helper()
	if d.Visibility != documentVisibilityWorkspace || d.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("%s = %s/%s, want workspace/view", what, d.Visibility, d.WorkspaceLevel)
	}
}

func wantRestricted(t *testing.T, d db.Document, what string) {
	t.Helper()
	if d.Visibility != documentVisibilityRestricted {
		t.Fatalf("%s visibility = %q, want restricted", what, d.Visibility)
	}
}

func listHas(page DocumentListPage, id string) bool {
	for _, it := range page.Items {
		if it.Document.ID == id {
			return true
		}
	}
	return false
}

func treeHas(nodes []DocumentTreeNode, id string) bool {
	for _, n := range nodes {
		if n.ID == id || treeHas(n.Children, id) {
			return true
		}
	}
	return false
}

func TestWorkspaceFolderIsVisibleToEveryMember(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.a, "", "Hồ sơ chung")
	wantWorkspaceFolder(t, folder, "root folder")
	sub := e.mkFolder(t, e.a, folder.ID, "Hồ sơ con")
	wantWorkspaceFolder(t, sub, "sub-folder")

	// A client visibility on a folder create is ignored: the location decides.
	asked, err := e.svc.CreatePage(ctx, e.a, e.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "Muốn riêng", Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatalf("folder create naming restricted: %v", err)
	}
	wantWorkspaceFolder(t, asked.Document, "folder asked restricted at the root")
	opened, err := e.svc.CreatePage(ctx, e.a, e.tn.wsA, CreatePageInput{
		Kind: DocumentKindFolder, Title: "Muốn mở", Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatalf("folder create naming workspace is no longer refused: %v", err)
	}
	wantWorkspaceFolder(t, opened.Document, "folder asked workspace")

	root := ""
	roots, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{ParentID: &root})
	if err != nil {
		t.Fatal(err)
	}
	if !listHas(roots, folder.ID) {
		t.Fatal("B's root list misses A's workspace folder")
	}
	children, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{ParentID: &folder.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !listHas(children, sub.ID) {
		t.Fatal("B's children list misses A's sub-folder")
	}
	tree, err := e.svc.DocumentTree(ctx, e.b, e.tn.wsA, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !treeHas(tree, folder.ID) || !treeHas(tree, sub.ID) {
		t.Fatalf("B's folder tree misses A's folders: %+v", tree)
	}
	search, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{Query: "Hồ sơ con"})
	if err != nil {
		t.Fatal(err)
	}
	if !listHas(search, sub.ID) {
		t.Fatal("B's search misses A's sub-folder")
	}
	if _, err := e.svc.GetDocument(ctx, e.b, folder.ID); err != nil {
		t.Fatalf("B opens A's workspace folder: %v", err)
	}
	recent, err := e.svc.ListRecentDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{})
	if err != nil {
		t.Fatal(err)
	}
	if !listHas(recent, folder.ID) {
		t.Fatal("B's recent list misses the folder B opened")
	}

	// An agent member reads the tree; an outsider of the workspace does not.
	agentTree, err := e.svc.DocumentTree(ctx, agentActor(e.tn.agent), e.tn.wsA, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !treeHas(agentTree, folder.ID) {
		t.Fatal("agent member does not read the workspace folder tree")
	}
	if _, err := e.svc.GetDocument(ctx, human(e.tn.bMember), folder.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("workspace B member opens wsA folder = %v, want not found", err)
	}
}

func TestWorkspaceFolderCreateGate(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.a, "", "Chung tạo")

	sub := e.mkFolder(t, e.b, folder.ID, "Của B")
	wantWorkspaceFolder(t, sub, "B's folder inside A's folder")
	page := e.mkPage(t, e.b, folder.ID, "Trang của B")
	wantRestricted(t, page, "B's page inside A's folder")
	file, err := e.svc.CreateFileDocument(ctx, e.b, e.tn.wsA, CreateFileDocumentInput{
		ParentID: folder.ID, Title: "Tệp của B", Filename: "b.pdf", Body: bytes.NewReader(pdfBody("ws-folder-b")),
	})
	if err != nil {
		t.Fatalf("B uploads a file inside A's folder: %v", err)
	}
	wantRestricted(t, file.Document, "B's file inside A's folder")
	// Q3: the creator may still open a document at create.
	open, err := e.svc.CreatePage(ctx, e.b, e.tn.wsA, CreatePageInput{ParentID: folder.ID, Title: "Mở", Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	if open.Document.Visibility != documentVisibilityWorkspace {
		t.Fatalf("explicit workspace page = %q", open.Document.Visibility)
	}
	// A folder upload inside a workspace folder: its folders open, nothing
	// else changes.
	batch, err := e.svc.CreateFolderUpload(ctx, e.b, e.tn.wsA, CreateFolderUploadInput{
		ParentID: &folder.ID, RootName: "Tải lên", Folders: []string{"con"}, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatalf("B folder upload inside A's folder: %v", err)
	}
	up := e.f.live(t, batch.RootFolderID)
	wantWorkspaceFolder(t, up, "uploaded root folder")

	// The view level of the folder grants nothing on the folder itself or on
	// A's documents inside.
	aPage := e.mkPage(t, e.a, folder.ID, "Trang của A")
	if _, err := e.svc.GetDocument(ctx, e.b, aPage.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B reads A's private page in the shared folder = %v, want not found", err)
	}
	title := "B đổi"
	if _, err := e.svc.UpdateDocument(ctx, e.b, folder.ID, UpdateDocumentInput{Revision: folder.Revision, Title: &title}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B renames A's folder = %v, want forbidden", err)
	}

	// Agents never create, even in a folder they read.
	if _, err := e.svc.CreatePage(ctx, agentActor(e.tn.agent), e.tn.wsA, CreatePageInput{ParentID: folder.ID, Title: "Agent"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent creates inside the folder = %v, want forbidden", err)
	}
	// A member of another workspace cannot reach it.
	if _, err := e.svc.CreatePage(ctx, human(e.tn.bMember), e.tn.wsA, CreatePageInput{ParentID: folder.ID, Title: "Lạ"}); err == nil {
		t.Fatal("a non-member created inside the folder")
	}
	// A folder inside My Folder stays its owner's.
	mf, _, err := e.svc.EnsureMyFolder(ctx, e.a, e.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	private := e.mkFolder(t, e.a, mf.Document.ID, "Riêng A")
	if _, err := e.svc.CreatePage(ctx, e.b, e.tn.wsA, CreatePageInput{ParentID: private.ID, Title: "Xâm nhập"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B creates inside A's My Folder sub-folder = %v, want not found", err)
	}
}

func TestWorkspaceFolderRenameMoveGate(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.a, "", "Gốc A")
	dst := e.mkFolder(t, e.b, "", "Đích B")

	rename := func(actor Actor, id, title string) error {
		cur := e.f.live(t, id)
		_, err := e.svc.UpdateDocument(ctx, actor, id, UpdateDocumentInput{Revision: cur.Revision, Title: &title})
		return err
	}
	move := func(actor Actor, id, parent string) error {
		cur := e.f.live(t, id)
		_, err := e.svc.MoveDocument(ctx, actor, id, MoveDocumentInput{ParentID: parent, Revision: cur.Revision})
		return err
	}
	if err := rename(e.b, folder.ID, "B đổi"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B renames A's folder = %v, want forbidden", err)
	}
	icon := "📁"
	if _, err := e.svc.UpdateDocument(ctx, e.b, folder.ID, UpdateDocumentInput{Revision: folder.Revision, Icon: &icon}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B re-icons A's folder = %v, want forbidden", err)
	}
	if err := move(e.b, folder.ID, dst.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B moves A's folder = %v, want forbidden", err)
	}
	if err := rename(e.a, folder.ID, "A đổi"); err != nil {
		t.Fatalf("creator renames: %v", err)
	}
	if err := rename(e.admin, folder.ID, "Admin đổi"); err != nil {
		t.Fatalf("workspace admin renames: %v", err)
	}
	if err := rename(e.orgAdmin, folder.ID, "Org admin đổi"); err != nil {
		t.Fatalf("organization admin renames: %v", err)
	}
	// The creator moves their own folder into another member's workspace
	// folder: the destination is contributable to every member.
	if err := move(e.a, folder.ID, dst.ID); err != nil {
		t.Fatalf("creator moves into B's workspace folder: %v", err)
	}
	if err := move(e.admin, folder.ID, ""); err != nil {
		t.Fatalf("admin moves A's folder back to the root: %v", err)
	}
	// B moves B's own page into A's workspace folder.
	page := e.mkPage(t, e.b, "", "Trang B")
	if err := move(e.b, page.ID, folder.ID); err != nil {
		t.Fatalf("B moves own page into A's folder: %v", err)
	}
	wantRestricted(t, e.f.live(t, page.ID), "page moved into a workspace folder")
}

func TestWorkspaceFolderIntoMyFolderIsRefused(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	mf, _, err := e.svc.EnsureMyFolder(ctx, e.a, e.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	inner := e.mkFolder(t, e.a, mf.Document.ID, "Trong MF")
	wantRestricted(t, inner, "folder in My Folder")
	deeper := e.mkFolder(t, e.a, inner.ID, "Sâu MF")
	wantRestricted(t, deeper, "sub-folder in My Folder")
	mfDest, err := e.svc.CreatePage(ctx, e.a, e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Đích MF", Destination: DocumentSystemKindMyFolder})
	if err != nil {
		t.Fatal(err)
	}
	wantRestricted(t, mfDest.Document, "folder created with destination my_folder")

	// B does not see A's My Folder sub-folders.
	if _, err := e.svc.GetDocument(ctx, e.b, inner.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B opens A's My Folder sub-folder = %v, want not found", err)
	}
	tree, err := e.svc.DocumentTree(ctx, e.b, e.tn.wsA, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if treeHas(tree, inner.ID) {
		t.Fatal("B's tree shows A's My Folder sub-folder")
	}

	ws := e.mkFolder(t, e.a, "", "Chung A")
	wsChild := e.mkFolder(t, e.a, ws.ID, "Chung con")
	for name, target := range map[string]string{"My Folder": mf.Document.ID, "a My Folder descendant": inner.ID} {
		for _, moving := range []db.Document{ws, wsChild} {
			cur := e.f.live(t, moving.ID)
			_, err := e.svc.MoveDocument(ctx, e.a, moving.ID, MoveDocumentInput{ParentID: target, Revision: cur.Revision})
			ce := wantCode(t, err, "folder_into_my_folder")
			if ce.Status != http.StatusUnprocessableEntity {
				t.Fatalf("into %s: status %d, want 422", name, ce.Status)
			}
			if got := e.f.live(t, moving.ID); got.ParentID != cur.ParentID || got.Revision != cur.Revision {
				t.Fatalf("refused move changed the row: %+v", got)
			}
		}
	}
	// A document keeps its own access whichever way it moves.
	page := e.mkPage(t, e.a, ws.ID, "Trang đi lại")
	if _, err := e.svc.MoveDocument(ctx, e.a, page.ID, MoveDocumentInput{ParentID: inner.ID, Revision: page.Revision}); err != nil {
		t.Fatalf("a page moves into My Folder: %v", err)
	}
	wantRestricted(t, e.f.live(t, page.ID), "page moved into My Folder")
}

func TestMyFolderSubFolderMovedOutOpensItsFolders(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	mf, _, err := e.svc.EnsureMyFolder(ctx, e.a, e.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	top := e.mkFolder(t, e.a, mf.Document.ID, "Ra ngoài")
	sub := e.mkFolder(t, e.a, top.ID, "Ra ngoài con")
	page := e.mkPage(t, e.a, sub.ID, "Trang riêng")
	openPage, err := e.svc.CreatePage(ctx, e.a, e.tn.wsA, CreatePageInput{ParentID: top.ID, Title: "Trang mở", Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	pageBefore, openBefore := e.f.live(t, page.ID), e.f.live(t, openPage.Document.ID)

	cur := e.f.live(t, top.ID)
	moved, err := e.svc.MoveDocument(ctx, e.a, top.ID, MoveDocumentInput{ParentID: "", Revision: cur.Revision, IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("move a My Folder sub-folder out: %v", err)
	}
	wantWorkspaceFolder(t, moved.Document, "moved folder in the answer")
	wantWorkspaceFolder(t, e.f.live(t, top.ID), "moved folder")
	wantWorkspaceFolder(t, e.f.live(t, sub.ID), "its sub-folder")
	if got := e.f.live(t, page.ID); got.Visibility != pageBefore.Visibility || got.WorkspaceLevel != pageBefore.WorkspaceLevel {
		t.Fatalf("private page changed access: %s/%s", got.Visibility, got.WorkspaceLevel)
	}
	if got := e.f.live(t, openPage.Document.ID); got.Visibility != openBefore.Visibility || got.WorkspaceLevel != openBefore.WorkspaceLevel {
		t.Fatalf("open page changed access: %s/%s", got.Visibility, got.WorkspaceLevel)
	}
	if got := e.f.live(t, top.ID); got.Revision != cur.Revision+1 {
		t.Fatalf("moved folder revision %d -> %d, want one bump", cur.Revision, got.Revision)
	}
	for _, id := range []string{top.ID, sub.ID} {
		for _, action := range []string{audit.ActionDocumentMoved, audit.ActionDocumentWorkspaceAccessChanged} {
			if n := e.count(t, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`, id, string(action)); n != 1 {
				t.Fatalf("%s audit rows for %s = %d, want 1", action, id, n)
			}
		}
		for _, topic := range []string{"document.moved", "document.workspace_access_changed"} {
			if n := e.count(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, topic, id); n != 1 {
				t.Fatalf("%s frames for %s = %d, want 1", topic, id, n)
			}
		}
	}
	for _, id := range []string{page.ID, openPage.Document.ID} {
		if n := e.count(t, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`, id, string(audit.ActionDocumentWorkspaceAccessChanged)); n != 0 {
			t.Fatalf("a document inside wrote an access change: %d", n)
		}
	}
	// B now sees both folders, never the private page.
	tree, err := e.svc.DocumentTree(ctx, e.b, e.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if !treeHas(tree, top.ID) || !treeHas(tree, sub.ID) || treeHas(tree, page.ID) {
		t.Fatalf("B's tree after the move: %+v", tree)
	}
}

func TestWorkspaceFolderHomeRowStaysLocationOwned(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	folder := e.mkFolder(t, e.a, "", "Không đóng được")
	for _, vis := range []string{documentVisibilityRestricted, documentVisibilityWorkspace} {
		v := vis
		_, err := e.svc.UpdateDocument(ctx, e.a, folder.ID, UpdateDocumentInput{Revision: folder.Revision, Visibility: &v})
		wantCode(t, err, "folder_not_shareable")
	}
	edit := DocumentLevelEdit
	_, err := e.svc.UpdateDocumentAccess(ctx, e.a, folder.ID, UpdateDocumentAccessInput{Items: []DocumentAccessBatchItem{
		{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: e.tn.wsA, Level: &edit},
	}})
	wantCode(t, err, "folder_not_shareable")
	_, err = e.svc.UpdateDocumentAccess(ctx, e.a, folder.ID, UpdateDocumentAccessInput{Items: []DocumentAccessBatchItem{
		{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: e.tn.wsA},
	}})
	wantCode(t, err, "folder_not_shareable")
	wantWorkspaceFolder(t, e.f.live(t, folder.ID), "folder after refused access changes")
}

func TestWorkspaceFolderCreateNameClash(t *testing.T) {
	e := newWSFolderEnv(t)
	first := e.mkFolder(t, e.a, "", "Trùng")
	second := e.mkFolder(t, e.b, "", "TRÙNG")
	if second.Title != "TRÙNG (1)" {
		t.Fatalf("second title = %q, want TRÙNG (1)", second.Title)
	}
	third := e.mkFolder(t, e.a, "", "Trùng")
	if third.Title != "Trùng (2)" {
		t.Fatalf("third title = %q, want Trùng (2)", third.Title)
	}
	// Rename into a taken name keeps the 409 (Q2).
	title := "Trùng"
	_, err := e.svc.UpdateDocument(e.f.ctx, e.a, third.ID, UpdateDocumentInput{Revision: third.Revision, Title: &title})
	wantCode(t, err, "folder_name_taken")
	if got := e.f.live(t, first.ID); got.Title != "Trùng" {
		t.Fatalf("first title changed: %q", got.Title)
	}
}

func TestWorkspaceFolderConcurrentCreateSuffixes(t *testing.T) {
	e := newWSFolderEnv(t)
	const racers = 3
	results := make([]db.Document, racers)
	errs := make([]error, racers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			v, err := e.svc.CreatePage(e.f.ctx, e.a, e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Đua"})
			results[i], errs[i] = v.Document, err
		}(i)
	}
	close(start)
	wg.Wait()
	seen := map[string]bool{}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d: %v", i, err)
		}
		seen[results[i].Title] = true
	}
	for _, want := range []string{"Đua", "Đua (1)", "Đua (2)"} {
		if !seen[want] {
			t.Fatalf("titles = %v, want %q among them", seen, want)
		}
	}
}

// TestWorkspaceFolderCreateRetriesTheIndex drives the savepoint retry: the
// first insert attempt meets a unique violation (a racer the tree lock did
// not serialize), the second attempt re-reads the names and lands.
func TestWorkspaceFolderCreateRetriesTheIndex(t *testing.T) {
	e := newWSFolderEnv(t)
	e.mkFolder(t, e.a, "", "Lặp lại")
	calls := 0
	e.svc.titleWriteErr = func(attempt int) error {
		calls++
		if attempt == 1 {
			return &pgconn.PgError{Code: "23505", ConstraintName: "idx_documents_folder_name_user_uidx"}
		}
		return nil
	}
	t.Cleanup(func() { e.svc.titleWriteErr = nil })
	got := e.mkFolder(t, e.b, "", "Lặp lại")
	if got.Title != "Lặp lại (1)" || calls < 2 {
		t.Fatalf("title %q after %d attempts", got.Title, calls)
	}
}
