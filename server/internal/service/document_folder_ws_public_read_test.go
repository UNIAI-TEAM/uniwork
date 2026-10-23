package service

// UNI-2055 S4 (ADR 0037 §9, card rules 14-15): the read paths follow the ACL
// predicate and nothing else. A workspace folder is read by every member of
// its workspace, so a document inside it keeps its parent_id and its full
// breadcrumb for a recipient (list, search, recent, tree, Shared with me,
// favorites, detail); a parent inside another member's My Folder stays masked
// as under 0036 rule 3. Search, recent, the tree, the realtime reader filter
// and the MCP read tools show a workspace folder to every member and another
// member's My Folder subtree to nobody.

import (
	"context"
	"encoding/json"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func wsrIDs(page DocumentListPage) map[string]DocumentListItem {
	out := make(map[string]DocumentListItem, len(page.Items))
	for _, it := range page.Items {
		out[it.Document.ID] = it
	}
	return out
}

func wsrTreeIDs(nodes []DocumentTreeNode, into map[string]DocumentTreeNode) {
	for _, n := range nodes {
		into[n.ID] = n
		wsrTreeIDs(n.Children, into)
	}
}

func wsrPath(path []DocumentPathItem) []string {
	out := make([]string, 0, len(path))
	for _, p := range path {
		out = append(out, p.ID)
	}
	return out
}

func wsrSameIDs(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// Rule 14: a recipient sees a shared document where it lives when the folder
// path is a workspace folder, on every surface that names a parent.
func TestSharedDocumentInWorkspaceFolderKeepsItsPath(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	root := ""

	top := e.mkFolder(t, e.a, "", "Dự án chung")
	sub := e.mkFolder(t, e.a, top.ID, "Hợp đồng")
	open, err := e.svc.CreatePage(ctx, e.a, e.tn.wsA, CreatePageInput{Title: "Bản mở cho workspace", ParentID: sub.ID, Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	shared := e.mkPage(t, e.a, sub.ID, "Bản chia sẻ riêng cho B")
	hidden := e.mkPage(t, e.a, sub.ID, "Bản riêng tư của A")
	if _, err := e.svc.ShareDocument(ctx, e.a, shared.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: e.b.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	wantPath := []string{top.ID, sub.ID}

	t.Run("lists keep the folder: root, children, flat, search", func(t *testing.T) {
		rootPage, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		got := wsrIDs(rootPage)
		if _, ok := got[top.ID]; !ok {
			t.Fatal("B does not see A's workspace folder at the root")
		}
		for _, d := range []string{open.Document.ID, shared.ID, hidden.ID} {
			if _, ok := got[d]; ok {
				t.Fatalf("document %s is promoted to B's root although its folder is readable", d)
			}
		}
		kids, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{ParentID: &sub.ID})
		if err != nil {
			t.Fatal(err)
		}
		inside := wsrIDs(kids)
		for _, d := range []string{open.Document.ID, shared.ID} {
			it, ok := inside[d]
			if !ok || it.Document.ParentID.String != sub.ID {
				t.Fatalf("inside the folder: %s ok=%v parent=%q, want %s", d, ok, it.Document.ParentID.String, sub.ID)
			}
		}
		if _, ok := inside[hidden.ID]; ok {
			t.Fatal("a private document is listed inside the folder for B")
		}
		flat, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		search, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{Query: "workspace"})
		if err != nil {
			t.Fatal(err)
		}
		for name, page := range map[string]DocumentListPage{"flat": flat, "search": search} {
			it, ok := wsrIDs(page)[open.Document.ID]
			if !ok {
				t.Fatalf("%s: %q missing", name, open.Document.Title)
			}
			if it.Document.ParentID.String != sub.ID {
				t.Fatalf("%s: parent %q, want %s", name, it.Document.ParentID.String, sub.ID)
			}
			// Only a search resolves the path of its rows (attachListPaths).
			if name == "search" && !wsrSameIDs(wsrPath(it.Path), wantPath) {
				t.Fatalf("search: path %v, want %v", wsrPath(it.Path), wantPath)
			}
		}
	})

	t.Run("recent keeps the folder", func(t *testing.T) {
		if _, err := e.svc.GetDocument(ctx, e.b, open.Document.ID); err != nil {
			t.Fatal(err)
		}
		recent, err := e.svc.ListRecentDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		it, ok := wsrIDs(recent)[open.Document.ID]
		if !ok || it.Document.ParentID.String != sub.ID {
			t.Fatalf("recent: ok=%v parent=%q, want %s", ok, it.Document.ParentID.String, sub.ID)
		}
	})

	t.Run("the tree nests them under the folders", func(t *testing.T) {
		nodes, err := e.svc.DocumentTree(ctx, e.b, e.tn.wsA, "", false)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]DocumentTreeNode{}
		wsrTreeIDs(nodes, seen)
		if seen[sub.ID].ParentID != top.ID {
			t.Fatalf("sub-folder parent in B's tree = %q, want %s", seen[sub.ID].ParentID, top.ID)
		}
		for _, d := range []string{open.Document.ID, shared.ID} {
			if n, ok := seen[d]; !ok || n.ParentID != sub.ID {
				t.Fatalf("tree node %s: ok=%v parent=%q, want %s", d, ok, n.ParentID, sub.ID)
			}
		}
		if _, ok := seen[hidden.ID]; ok {
			t.Fatal("a private document is in B's tree")
		}
	})

	t.Run("Shared with me and favorites keep the parent", func(t *testing.T) {
		sw, err := e.svc.ListSharedWithMe(ctx, e.b.ID, e.tn.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, it := range sw.Items {
			if it.Document.ID == shared.ID {
				found = true
				if it.Document.ParentID.String != sub.ID {
					t.Fatalf("Shared with me parent = %q, want %s", it.Document.ParentID.String, sub.ID)
				}
			}
		}
		if !found {
			t.Fatal("the shared document is not in Shared with me")
		}
		if _, err := e.svc.FavoriteDocument(ctx, e.b, open.Document.ID); err != nil {
			t.Fatal(err)
		}
		favs, err := e.svc.ListDocumentFavorites(ctx, e.b, e.tn.orgID)
		if err != nil {
			t.Fatal(err)
		}
		if len(favs) != 1 {
			t.Fatalf("favorites = %d rows, want one under %s", len(favs), sub.ID)
		}
		if favs[0].Document.ParentID.String != sub.ID {
			t.Fatalf("favorites parent = %q, want %s", favs[0].Document.ParentID.String, sub.ID)
		}
	})

	t.Run("the detail view carries the full breadcrumb", func(t *testing.T) {
		view, err := e.svc.GetDocument(ctx, e.b, open.Document.ID)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, c := range view.Breadcrumbs {
			got = append(got, c.ID)
		}
		if !wsrSameIDs(got, wantPath) || !view.ParentVisible() {
			t.Fatalf("breadcrumbs = %v parentVisible=%v, want %v", got, view.ParentVisible(), wantPath)
		}
	})

	t.Run("a parent in another member's My Folder stays masked", func(t *testing.T) {
		mf, _, err := e.svc.EnsureMyFolder(ctx, e.a, e.tn.wsA)
		if err != nil {
			t.Fatal(err)
		}
		inMy := e.mkFolder(t, e.a, mf.Document.ID, "Riêng của A")
		doc := e.mkPage(t, e.a, inMy.ID, "Chia sẻ từ My Folder")
		if _, err := e.svc.ShareDocument(ctx, e.a, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: e.b.ID, Level: DocumentLevelView,
		}); err != nil {
			t.Fatal(err)
		}
		sw, err := e.svc.ListSharedWithMe(ctx, e.b.ID, e.tn.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, it := range sw.Items {
			if it.Document.ID == doc.ID {
				found = true
				if it.Document.ParentID.Valid {
					t.Fatalf("Shared with me names A's My Folder sub-folder %s", it.Document.ParentID.String)
				}
			}
		}
		if !found {
			t.Fatal("the document shared from My Folder is not in Shared with me")
		}
		view, err := e.svc.GetDocument(ctx, e.b, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(view.Breadcrumbs) != 0 || view.ParentVisible() {
			t.Fatalf("breadcrumbs=%v parentVisible=%v, want none", view.Breadcrumbs, view.ParentVisible())
		}
	})
}

// A share is not membership: a recipient who is not in the folder's workspace
// reads the shared document, but the workspace folder above it stays masked
// (no folder id or title), because the folder itself is not readable to them.
func TestSharedDocumentInWorkspaceFolderStaysMaskedForNonMembers(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx

	top := e.mkFolder(t, e.a, "", "Thư mục chung của A")
	doc := e.mkPage(t, e.a, top.ID, "Chia sẻ ra ngoài workspace")
	recipients := map[string]db.User{"outsider": e.tn.outsider, "bMember": e.tn.bMember}
	for name, u := range recipients {
		if _, err := e.svc.ShareDocument(ctx, e.a, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: u.ID, Level: DocumentLevelView,
		}); err != nil {
			t.Fatalf("share with %s: %v", name, err)
		}
	}

	for name, u := range recipients {
		t.Run(name, func(t *testing.T) {
			sw, err := e.svc.ListSharedWithMe(ctx, u.ID, e.tn.orgID, SharedWithMeQuery{})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, it := range sw.Items {
				if it.Document.ID == doc.ID {
					found = true
					if it.Document.ParentID.Valid {
						t.Fatalf("Shared with me names the workspace folder %s", it.Document.ParentID.String)
					}
				}
			}
			if !found {
				t.Fatal("the shared document is not in Shared with me")
			}
			view, err := e.svc.GetDocument(ctx, human(u), doc.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(view.Breadcrumbs) != 0 || view.ParentVisible() {
				t.Fatalf("breadcrumbs=%v parentVisible=%v, want none", view.Breadcrumbs, view.ParentVisible())
			}
		})
	}
}

// Rule 15: tree, search, recent and the realtime reader filter answer a member
// B with A's workspace folder and with nothing of A's My Folder subtree.
func TestWorkspaceFolderReadPathsFollowTheACL(t *testing.T) {
	e := newWSFolderEnv(t)
	ctx := e.f.ctx
	root := ""

	wsFolder := e.mkFolder(t, e.a, "", "Chung Quý Bốn")
	mf, _, err := e.svc.EnsureMyFolder(ctx, e.a, e.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	myFolder := e.mkFolder(t, e.a, mf.Document.ID, "Chung Quý Năm")
	if _, err := e.svc.GetDocument(ctx, e.b, wsFolder.ID); err != nil {
		t.Fatalf("B opens A's workspace folder: %v", err)
	}

	t.Run("B reads the workspace folder everywhere", func(t *testing.T) {
		rootPage, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{ParentID: &root})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := wsrIDs(rootPage)[wsFolder.ID]; !ok {
			t.Error("root list misses A's workspace folder")
		}
		search, err := e.svc.ListDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{Query: "Chung"})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := wsrIDs(search)[wsFolder.ID]; !ok {
			t.Error("search misses A's workspace folder")
		}
		nodes, err := e.svc.DocumentTree(ctx, e.b, e.tn.wsA, "", true)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]DocumentTreeNode{}
		wsrTreeIDs(nodes, seen)
		if _, ok := seen[wsFolder.ID]; !ok {
			t.Error("folders-only tree misses A's workspace folder")
		}
		recent, err := e.svc.ListRecentDocuments(ctx, e.b, e.tn.wsA, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := wsrIDs(recent)[wsFolder.ID]; !ok {
			t.Error("recent misses the workspace folder B just opened")
		}
	})

	t.Run("nobody but the owner reads A's My Folder subtree", func(t *testing.T) {
		for name, who := range map[string]Actor{"member B": e.b, "workspace admin": e.admin} {
			flat, err := e.svc.ListDocuments(ctx, who, e.tn.wsA, ListDocumentsInput{Query: "Chung"})
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if _, ok := wsrIDs(flat)[myFolder.ID]; ok {
				t.Errorf("%s: search names a folder inside A's My Folder", name)
			}
			nodes, err := e.svc.DocumentTree(ctx, who, e.tn.wsA, "", false)
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			seen := map[string]DocumentTreeNode{}
			wsrTreeIDs(nodes, seen)
			if _, ok := seen[myFolder.ID]; ok {
				t.Errorf("%s: the tree names a folder inside A's My Folder", name)
			}
			if _, ok := seen[mf.Document.ID]; ok {
				t.Errorf("%s: the tree names A's My Folder", name)
			}
		}
		ownerSearch, err := e.svc.ListDocuments(ctx, e.a, e.tn.wsA, ListDocumentsInput{Query: "Chung"})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := wsrIDs(ownerSearch)[myFolder.ID]; !ok {
			t.Error("control: A does not find their own My Folder sub-folder")
		}
	})

	t.Run("realtime reader filter", func(t *testing.T) {
		everyone := []string{e.a.ID, e.b.ID, e.admin.ID, e.tn.outsider.ID, e.tn.bMember.ID, e.tn.deact.ID}
		in, err := e.svc.FilterDocumentReaders(ctx, wsFolder.ID, everyone)
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]bool{e.a.ID: true, e.b.ID: true, e.admin.ID: true}
		if len(in) != len(want) {
			t.Fatalf("workspace folder readers = %v, want the three workspace-A members only", in)
		}
		for _, id := range in {
			if !want[id] {
				t.Fatalf("workspace folder readers = %v: %s must not read it", in, id)
			}
		}
		own, err := e.svc.FilterDocumentReaders(ctx, myFolder.ID, everyone)
		if err != nil {
			t.Fatal(err)
		}
		if len(own) != 1 || own[0] != e.a.ID {
			t.Fatalf("My Folder sub-folder readers = %v, want only A", own)
		}
	})
}

// Rule 15, MCP: the read tools list and read a workspace folder for any
// member the grant covers and name nothing of another member's My Folder.
func TestMcpReadToolsFollowTheWorkspaceFolderRule(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs := x.docs(t)

	wsFolder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục mcp chung"})
	if err != nil {
		t.Fatal(err)
	}
	mf, _, err := docs.EnsureMyFolder(ctx, Human(x.ua.ID), x.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	myFolder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục mcp riêng", ParentID: mf.Document.ID})
	if err != nil {
		t.Fatal(err)
	}
	member := x.member(t)

	list, err := x.docList(t, member, "")
	if err != nil {
		t.Fatal(err)
	}
	has := func(ids []string, id string) bool {
		for _, v := range ids {
			if v == id {
				return true
			}
		}
		return false
	}
	if !has(docIDs(list), wsFolder.Document.ID) {
		t.Errorf("list_documents for a member misses the workspace folder: %v", docIDs(list))
	}
	if has(docIDs(list), mf.Document.ID) || has(docIDs(list), myFolder.Document.ID) {
		t.Errorf("list_documents for a member names A's My Folder: %v", docIDs(list))
	}
	if !has(x.searchIDs(t, member, "mcp"), wsFolder.Document.ID) {
		t.Error("search for a member misses the workspace folder")
	}
	if has(x.searchIDs(t, member, "mcp"), myFolder.Document.ID) {
		t.Error("search for a member finds a folder inside A's My Folder")
	}
	raw, err := callMcpTool(t, x.tools, member, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+wsFolder.Document.ID+`"}`)
	if err != nil {
		t.Fatalf("get_document on a workspace folder: %v", err)
	}
	var d McpDocument
	if err := json.Unmarshal(raw, &d); err != nil || d.DocKind != "folder" {
		t.Fatalf("get_document = %s (%v), want a folder", raw, err)
	}
	if _, err := callMcpTool(t, x.tools, member, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+myFolder.Document.ID+`"}`); err == nil {
		t.Error("get_document reads a folder inside A's My Folder")
	}
}
