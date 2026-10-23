package service

// UNI-1645 (addendum 2026-10-15 §3.2): the library list, search, tree, recent
// and shared-with-me rows show who is editing the document - holder, since,
// expiry, hold - and never the tenure id, whatever the viewer's level (C2-1
// keeps the lock id on R1 only). Every attach is one batched read per page;
// the organization-scoped favorites list carries nothing, which the handler
// test TestDocumentFavoriteRowsHaveNoEditLock pins on the wire.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// lockListRow finds one page row by document id.
func lockListRow(t *testing.T, page DocumentListPage, docID string) DocumentListItem {
	t.Helper()
	for _, item := range page.Items {
		if item.Document.ID == docID {
			return item
		}
	}
	t.Fatalf("document %s is not in the page %v", docID, listIDs(page))
	return DocumentListItem{}
}

// lockTreeNode finds one tree node by document id, at any depth.
func lockTreeNode(nodes []DocumentTreeNode, docID string) (DocumentTreeNode, bool) {
	for i := range nodes {
		if nodes[i].ID == docID {
			return nodes[i], true
		}
		if child, ok := lockTreeNode(nodes[i].Children, docID); ok {
			return child, true
		}
	}
	return DocumentTreeNode{}, false
}

// wantEditLockSummary asserts a row carries the live tenure of holder and
// never its id: the holder fields, a horizon after since and the viewer's
// own-hold flag.
func wantEditLockSummary(t *testing.T, sum *DocumentEditLockSummary, holder db.User, lockID string, heldByMe bool) {
	t.Helper()
	if sum == nil {
		t.Fatal("row carries no edit_lock, want the live tenure")
	}
	if sum.HolderID != holder.ID || sum.HolderName != holder.DisplayName {
		t.Fatalf("edit_lock holder = %q/%q, want %q/%q", sum.HolderID, sum.HolderName, holder.ID, holder.DisplayName)
	}
	if sum.LockID != "" {
		t.Fatalf("row carries lock_id %q (the tenure is %s); only R1 answers it (C2-1)", sum.LockID, lockID)
	}
	if sum.HeldByMe != heldByMe {
		t.Fatalf("held_by_me = %v, want %v", sum.HeldByMe, heldByMe)
	}
	if sum.Reserved {
		t.Fatal("a claimed tenure reads reserved")
	}
	if sum.Since.IsZero() || !sum.ExpiresAt.After(sum.Since) {
		t.Fatalf("since/expires_at = %s/%s, want a live tenure", sum.Since, sum.ExpiresAt)
	}
	if sum.OfflineHoldUntil != nil {
		t.Fatalf("offline_hold_until = %s on a tenure with no hold", *sum.OfflineHoldUntil)
	}
}

// listablePage is a workspace-visible page of workspace A owned by aclOwner
// (manage), which is the shape every list path can see.
func listablePage(t *testing.T, w *lockWorld, spec treeDocSpec) db.Document {
	t.Helper()
	spec.ws = w.tn.wsA
	spec.visibility = "workspace"
	spec.aclOwner = w.tn.aclOwner.ID
	spec.createdBy = w.tn.aclOwner.ID
	return w.env.f.treeDoc(t, w.tn, spec)
}

// TestEditLockSummaryOnLibraryListRows covers GET
// /workspaces/{ws}/documents.
func TestEditLockSummaryOnLibraryListRows(t *testing.T) {
	w := newLockWorld(t)
	d := listablePage(t, w, treeDocSpec{title: "Trang đang sửa"})
	lock := w.acquire(t, w.tn.aclOwner, d.ID, util.NewID())

	page, err := w.svc.ListDocuments(w.ctx, human(w.tn.member), w.tn.wsA, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	wantEditLockSummary(t, lockListRow(t, page, d.ID).EditLock, w.tn.aclOwner, lock.Lock.ID, false)
}

// TestEditLockSummaryOnSearchRows covers the q branch of the same route.
func TestEditLockSummaryOnSearchRows(t *testing.T) {
	w := newLockWorld(t)
	d := listablePage(t, w, treeDocSpec{title: "Báo cáo quý bốn", searchText: "bao cao quy bon"})
	lock := w.acquire(t, w.tn.aclOwner, d.ID, util.NewID())

	page, err := w.svc.ListDocuments(w.ctx, human(w.tn.member), w.tn.wsA, ListDocumentsInput{Query: "bao cao quy bon", Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	wantEditLockSummary(t, lockListRow(t, page, d.ID).EditLock, w.tn.aclOwner, lock.Lock.ID, false)
}

// TestEditLockSummaryOnTreeRows covers GET /workspaces/{ws}/documents/tree;
// a node nobody is editing stays absent.
func TestEditLockSummaryOnTreeRows(t *testing.T) {
	w := newLockWorld(t)
	locked := listablePage(t, w, treeDocSpec{title: "Có khóa"})
	plain := listablePage(t, w, treeDocSpec{title: "Không khóa"})
	lock := w.acquire(t, w.tn.aclOwner, locked.ID, util.NewID())

	nodes, err := w.svc.DocumentTree(w.ctx, human(w.tn.member), w.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	node, ok := lockTreeNode(nodes, locked.ID)
	if !ok {
		t.Fatalf("locked document %s is not in the tree", locked.ID)
	}
	wantEditLockSummary(t, node.EditLock, w.tn.aclOwner, lock.Lock.ID, false)
	other, ok := lockTreeNode(nodes, plain.ID)
	if !ok {
		t.Fatalf("document %s is not in the tree", plain.ID)
	}
	if other.EditLock != nil {
		t.Fatalf("node %s carries an edit_lock nobody holds: %+v", plain.ID, *other.EditLock)
	}
}

// TestEditLockSummaryOnRecentRows covers GET
// /workspaces/{ws}/documents/recent; the holder's own list reads
// held_by_me=true.
func TestEditLockSummaryOnRecentRows(t *testing.T) {
	w := newLockWorld(t)
	d := listablePage(t, w, treeDocSpec{title: "Vừa mở"})
	lock := w.acquire(t, w.tn.aclOwner, d.ID, util.NewID())

	page, err := w.svc.ListRecentDocuments(w.ctx, human(w.tn.aclOwner), w.tn.wsA, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	wantEditLockSummary(t, lockListRow(t, page, d.ID).EditLock, w.tn.aclOwner, lock.Lock.ID, true)
}

// TestEditLockSummaryOnSharedWithMeRows covers GET
// /workspaces/{ws}/documents/shared-with-me.
func TestEditLockSummaryOnSharedWithMeRows(t *testing.T) {
	w := newLockWorld(t)
	d := w.restricted(t)
	lock := w.acquire(t, w.tn.aclOwner, d.ID, util.NewID())
	w.shareTo(t, d, w.tn.member, DocumentLevelEdit)

	page, err := w.svc.ListSharedWithMe(w.ctx, w.tn.member.ID, w.tn.orgID, SharedWithMeQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var row *SharedDocument
	for i := range page.Items {
		if page.Items[i].Document.ID == d.ID {
			row = &page.Items[i]
		}
	}
	if row == nil {
		t.Fatalf("shared document %s is not in the page (%d rows)", d.ID, len(page.Items))
	}
	wantEditLockSummary(t, row.EditLock, w.tn.aclOwner, lock.Lock.ID, false)
}

// TestEditLockSummaryReadsNullAfterExpiry: a tenure past its TTL reads null
// on a row, and the read never ends it - expiry belongs to the sweeper or the
// next command on the document, not to a GET (contract §3 R1).
func TestEditLockSummaryReadsNullAfterExpiry(t *testing.T) {
	w := newLockWorld(t)
	d := listablePage(t, w, treeDocSpec{title: "Hết hạn"})
	lock := w.acquire(t, w.tn.aclOwner, d.ID, util.NewID())
	w.expire(t, lock.Lock.ID)

	page, err := w.svc.ListDocuments(w.ctx, human(w.tn.member), w.tn.wsA, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if sum := lockListRow(t, page, d.ID).EditLock; sum != nil {
		t.Fatalf("expired tenure still on the row: %+v", *sum)
	}
	nodes, err := w.svc.DocumentTree(w.ctx, human(w.tn.member), w.tn.wsA, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if node, ok := lockTreeNode(nodes, d.ID); !ok || node.EditLock != nil {
		t.Fatalf("tree node of an expired tenure = %+v (found %v), want no edit_lock", node.EditLock, ok)
	}
	if row := w.lockRow(t, lock.Lock.ID); row.EndedAt.Valid {
		t.Fatalf("a list read ended the tenure at %s; reads are read-only", row.EndedAt.Time)
	}
}
