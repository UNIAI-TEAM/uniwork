package service

// FD-03 (UNI-1463, E6, FD-D2): the tree bound is 20 and every occurrence
// reads maxDocumentDepth: the create check, the move check (destination depth
// + subtree height), the ancestor walk guard, the tree cut and the three
// recursive subtree CTEs (through subtreeMaxLevel()).
//
// The chains here are pages in pages: the deep shape the bound exists for.
// wantDepth pins the signed contract value (FD-D2) so a revert of the
// constant fails here instead of silently shrinking every shape.

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// wantDepth is the FD-D2 value (contract v1.0: maxDocumentDepth = 20).
const wantDepth = 20

// depthChain inserts n live pages, each the child of the previous one (a root
// at depth 1), so a test can build trees the create check would refuse.
func (f *docPermFixture) depthChain(t *testing.T, tn docTenant, n int, spec treeDocSpec) []db.Document {
	t.Helper()
	chain := make([]db.Document, 0, n)
	parent := ""
	for i := 0; i < n; i++ {
		s := spec
		s.ws = tn.wsA
		s.parent = parent
		if s.visibility == "" {
			s.visibility = "workspace"
		}
		if s.title == "" {
			s.title = fmt.Sprintf("Cấp %d", i+1)
		}
		d := f.treeDoc(t, tn, s)
		chain = append(chain, d)
		parent = d.ID
	}
	return chain
}

// archived asserts one row sits in the trash.
func (f *docPermFixture) archived(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if !d.ArchivedAt.Valid {
		t.Fatalf("document %s is live, want archived", id)
	}
	return d
}

func TestDocumentDepthBound(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "depth")
	owner := Human(tn.owner.ID)

	if maxDocumentDepth != wantDepth {
		t.Errorf("maxDocumentDepth = %d, want the signed %d (FD-D2)", maxDocumentDepth, wantDepth)
	}

	t.Run("a chain of exactly the bound is created and the next level is refused", func(t *testing.T) {
		parent := ""
		for i := 1; i <= wantDepth; i++ {
			v, err := f.svc.CreatePage(f.ctx, owner, tn.wsA, CreatePageInput{Title: fmt.Sprintf("Cấp %d", i), ParentID: parent})
			if err != nil {
				t.Fatalf("create level %d of %d: %v", i, wantDepth, err)
			}
			parent = v.Document.ID
		}
		_, err := f.svc.CreatePage(f.ctx, owner, tn.wsA, CreatePageInput{Title: "Cấp quá sâu", ParentID: parent})
		ce := wantCode(t, err, "document_too_deep")
		if ce.Status != 422 {
			t.Fatalf("document_too_deep status = %d, want 422", ce.Status)
		}
		if !strings.Contains(ce.Msg, strconv.Itoa(wantDepth)) {
			t.Fatalf("message %q does not name the bound %d", ce.Msg, wantDepth)
		}
	})

	t.Run("a move counts the destination depth plus the subtree height", func(t *testing.T) {
		chain := f.depthChain(t, tn, wantDepth, treeDocSpec{aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		// depth 19 + height 1 = 20: allowed.
		leaf := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.MoveDocument(f.ctx, owner, leaf.ID, MoveDocumentInput{ParentID: chain[wantDepth-2].ID, Revision: leaf.Revision}); err != nil {
			t.Fatalf("move to depth %d refused: %v", wantDepth, err)
		}
		// depth 20 + height 1 = 21: refused.
		deep := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, deep.ID, MoveDocumentInput{ParentID: chain[wantDepth-1].ID, Revision: deep.Revision})
		wantCode(t, err, "document_too_deep")
		// depth 19 + height 2 = 21: refused on the height, not just the node.
		sub := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: sub.ID})
		_, err = f.svc.MoveDocument(f.ctx, owner, sub.ID, MoveDocumentInput{ParentID: chain[wantDepth-2].ID, Revision: sub.Revision})
		wantCode(t, err, "document_too_deep")
	})

	t.Run("the tree read returns every level up to the bound and cuts below", func(t *testing.T) {
		// Two levels past the bound: a row shape the create check refuses, to
		// prove the read cuts at the bound instead of rendering it.
		chain := f.depthChain(t, tn, wantDepth+2, treeDocSpec{aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		tree, err := f.svc.DocumentTree(f.ctx, owner, tn.wsA, "")
		if err != nil {
			t.Fatal(err)
		}
		var node *DocumentTreeNode
		for i := range tree {
			if tree[i].ID == chain[0].ID {
				node = &tree[i]
			}
		}
		if node == nil {
			t.Fatalf("root %s missing from the tree", chain[0].ID)
		}
		levels := 1
		for node != nil {
			var next *DocumentTreeNode
			for i := range node.Children {
				if node.Children[i].ID == chain[levels].ID {
					next = &node.Children[i]
				}
			}
			if levels < wantDepth {
				if next == nil {
					t.Fatalf("level %d missing from the tree", levels+1)
				}
			} else if len(node.Children) != 0 {
				t.Fatalf("level %d has children past the bound: %+v", levels, node.Children)
			}
			node = next
			levels++
		}
		if levels != wantDepth+1 {
			t.Fatalf("tree rendered %d levels, want %d", levels-1, wantDepth)
		}
	})

	t.Run("a chain at the bound archives whole with no live descendant", func(t *testing.T) {
		chain := f.depthChain(t, tn, wantDepth, treeDocSpec{aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		res, err := f.svc.ArchiveDocument(f.ctx, owner, chain[0].ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Affected) != wantDepth {
			t.Fatalf("archived %d rows, want %d: %v", len(res.Affected), wantDepth, res.Affected)
		}
		for _, d := range chain {
			got := f.archived(t, d.ID)
			if got.ArchiveBatchID.String != res.BatchID {
				t.Fatalf("row %s carries batch %q, want %q", d.ID, got.ArchiveBatchID.String, res.BatchID)
			}
		}
	})

	t.Run("an unmanageable node deep in the chain refuses the whole archive", func(t *testing.T) {
		// One restricted node at level 15 the member does not manage: the
		// whole command must refuse, never leave it live under an archived
		// parent.
		member := Human(tn.member.ID)
		chain := f.depthChain(t, tn, 14, treeDocSpec{aclOwner: tn.member.ID, createdBy: tn.member.ID})
		blocked := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID,
			createdBy: tn.aclOwner.ID, parent: chain[len(chain)-1].ID, title: "Cấp 15"})
		chain = append(chain, blocked)
		prev := blocked.ID
		for i := 16; i <= wantDepth; i++ {
			d := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.member.ID,
				createdBy: tn.member.ID, parent: prev, title: fmt.Sprintf("Cấp %d", i)})
			chain = append(chain, d)
			prev = d.ID
		}
		_, err := f.svc.ArchiveDocument(f.ctx, member, chain[0].ID, ArchiveDocumentInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive over an unmanageable level-15 node = %v, want forbidden", err)
		}
		for _, d := range chain {
			f.live(t, d.ID)
		}
	})

	t.Run("the cycle guard still fires deep in the chain", func(t *testing.T) {
		chain := f.depthChain(t, tn, wantDepth, treeDocSpec{aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, chain[0].ID, MoveDocumentInput{
			ParentID: chain[wantDepth-1].ID, Revision: chain[0].Revision,
		})
		wantCode(t, err, "document_cycle")
	})

	t.Run("a chain past twice the bound is refused, not walked forever", func(t *testing.T) {
		chain := f.depthChain(t, tn, 2*wantDepth+1, treeDocSpec{aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.CreatePage(f.ctx, owner, tn.wsA, CreatePageInput{Title: "Ngoài trần", ParentID: chain[len(chain)-1].ID})
		wantCode(t, err, "document_too_deep")
	})
}
