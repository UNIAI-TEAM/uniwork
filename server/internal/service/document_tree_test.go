package service

// G1-04b (UNI-678) tree tests: the move command's checks and the tree read.
// The race subtest is the one the lane exists for - two moves that would
// make a cycle if their checks interleaved must serialize on the workspace
// tree lock.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// treeDocSpec extends the bare docSpec with the columns the tree, search and
// lifecycle tests set; treeDoc is the same insertRow shortcut over them.
type treeDocSpec struct {
	ws             string
	visibility     string
	aclOwner       string
	createdBy      string
	parent         string
	title          string
	kind           string // default "page"
	searchText     string
	contentText    string
	position       float64
	createdAt      time.Time
	updatedAt      time.Time
	contentSavedAt time.Time
	ownerID        string
	archived       bool
	purgeAfter     time.Time // zero with archived -> the 30 day retention
}

func (f *docPermFixture) treeDoc(t *testing.T, tn docTenant, s treeDocSpec) db.Document {
	t.Helper()
	id := util.NewID()
	row := baseDoc(map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": s.ws,
		"visibility": s.visibility, "created_by": s.createdBy, "updated_by": s.createdBy,
	})
	if s.aclOwner != "" {
		row["acl_owner_id"] = s.aclOwner
	}
	if s.parent != "" {
		row["parent_id"] = s.parent
	}
	if s.kind != "" {
		row["kind"] = s.kind
	}
	if s.title != "" {
		row["title"] = s.title
	}
	if s.searchText != "" {
		row["search_text"] = s.searchText
	}
	if s.contentText != "" {
		row["content"] = `{"type":"doc","content":[{"type":"paragraph"}]}`
		row["content_text"] = s.contentText
	}
	if s.position != 0 {
		row["position"] = s.position
	}
	if !s.createdAt.IsZero() {
		row["created_at"] = s.createdAt
	}
	if !s.updatedAt.IsZero() {
		row["updated_at"] = s.updatedAt
	}
	if !s.contentSavedAt.IsZero() {
		row["content_saved_at"] = s.contentSavedAt
		if row["content"] == nil {
			row["content"] = `{"type":"doc","content":[{"type":"paragraph"}]}`
			row["content_text"] = "nội dung"
		}
	}
	if s.ownerID != "" {
		row["owner_kind"] = "work_product"
		row["owner_id"] = s.ownerID
	}
	if s.archived {
		now := time.Now()
		row["archived_at"] = now
		row["archived_by"] = s.createdBy
		after := s.purgeAfter
		if after.IsZero() {
			after = now.Add(documentRetentionDays * 24 * time.Hour)
		}
		row["purge_after"] = after
	}
	insertRow(t, f.ctx, f.pool, "documents", row)
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// live checks the row still exists unarchived.
func (f *docPermFixture) live(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if d.ArchivedAt.Valid {
		t.Fatalf("document %s is archived, want live", id)
	}
	return d
}

func treeIDs(nodes []DocumentTreeNode, out *[]string) {
	for _, n := range nodes {
		*out = append(*out, n.ID)
		treeIDs(n.Children, out)
	}
}

func TestDocumentTree(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tree")
	owner := Human(tn.owner.ID)

	t.Run("move re-parents and the tree read shows it", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Gốc"})
		child := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Con"})
		view, err := f.svc.MoveDocument(f.ctx, owner, child.ID, MoveDocumentInput{ParentID: root.ID, Revision: child.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if view.Document.ParentID.String != root.ID {
			t.Fatalf("parent = %v, want %s", view.Document.ParentID, root.ID)
		}
		tree, err := f.svc.DocumentTree(f.ctx, owner, tn.wsA, "")
		if err != nil {
			t.Fatal(err)
		}
		var ids []string
		treeIDs(tree, &ids)
		var foundRoot, foundChild bool
		for _, n := range tree {
			if n.ID == root.ID {
				foundRoot = true
				for _, c := range n.Children {
					if c.ID == child.ID {
						foundChild = true
					}
				}
			}
		}
		if !foundRoot || !foundChild {
			t.Fatalf("tree = %v, want %s nested under %s", ids, child.ID, root.ID)
		}
	})

	t.Run("moving a page under itself is a cycle", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: a.ID, Revision: 1})
		wantCode(t, err, "document_cycle")
	})

	t.Run("moving a page under its own descendant is a cycle", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: a.ID})
		c := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: b.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: c.ID, Revision: 1})
		wantCode(t, err, "document_cycle")
	})

	t.Run("the five-level bound counts the moved subtree", func(t *testing.T) {
		// chain of five: r -> c2 -> c3 -> c4 -> c5 is at the bound already.
		r := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		prev := r
		chain := []db.Document{r}
		for i := 0; i < 4; i++ {
			n := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: prev.ID})
			chain = append(chain, n)
			prev = n
		}
		other := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		// The whole chain (height 5) under a depth-1 root would reach 6.
		_, err := f.svc.MoveDocument(f.ctx, owner, r.ID, MoveDocumentInput{ParentID: other.ID, Revision: 1})
		wantCode(t, err, "document_too_deep")
		// A leaf at depth 5 cannot take a child either.
		newRoot := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err = f.svc.MoveDocument(f.ctx, owner, newRoot.ID, MoveDocumentInput{ParentID: chain[4].ID, Revision: 1})
		wantCode(t, err, "document_too_deep")
		// The same leaf under a depth-4 page is legal.
		if _, err := f.svc.MoveDocument(f.ctx, owner, newRoot.ID, MoveDocumentInput{ParentID: chain[3].ID, Revision: 1}); err != nil {
			t.Fatalf("depth-5 move refused: %v", err)
		}
	})

	t.Run("a parent in another workspace is refused", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsB, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: b.ID, Revision: 1})
		wantCode(t, err, "cross_workspace_reference")
	})

	t.Run("a parent in another organization is not found", func(t *testing.T) {
		// An id of a foreign tenant's document answers like an unknown id:
		// no existence oracle across organizations (R1-06).
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
			"id": util.NewID(), "organization_id": "01ORGFOREIGN0000000000000", "workspace_id": "01WSFOREIGN00000000000000",
		}))
		var foreignID string
		if err := f.pool.QueryRow(f.ctx, `SELECT id FROM documents WHERE organization_id = '01ORGFOREIGN0000000000000'`).Scan(&foreignID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: foreignID, Revision: 1}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("move to a foreign-organization parent = %v, want ErrNotFound", err)
		}
	})

	t.Run("a parent in a workspace the caller cannot see is not found", func(t *testing.T) {
		// member holds edit on a but belongs to wsA only: a wsB id answers
		// like an unknown id - the 422 would confirm the row exists (R1-06).
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsB, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		member := Human(tn.member.ID)
		if _, err := f.svc.MoveDocument(f.ctx, member, a.ID, MoveDocumentInput{ParentID: b.ID, Revision: 1}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("move to an unseen workspace's parent = %v, want ErrNotFound", err)
		}
		// A caller who can already see the foreign row still earns the
		// distinct reason - here through a user share on it.
		f.share(t, b, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		_, err := f.svc.MoveDocument(f.ctx, member, a.ID, MoveDocumentInput{ParentID: b.ID, Revision: 1})
		wantCode(t, err, "cross_workspace_reference")
	})

	t.Run("an invisible document's self-parent move is not found", func(t *testing.T) {
		// R1-07: the cycle check sits behind the access gate - a document a
		// stranger cannot read must answer like an unknown id, never the
		// cycle code that would confirm the id exists.
		hidden := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.MoveDocument(f.ctx, Human(tn.member.ID), hidden.ID, MoveDocumentInput{ParentID: hidden.ID, Revision: 1}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("self-parent on an invisible doc = %v, want ErrNotFound", err)
		}
	})

	t.Run("a move needs edit on source AND destination", func(t *testing.T) {
		src := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		dst := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		member := Human(tn.member.ID)
		f.share(t, src, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		// edit on the source, nothing on the destination: a document the
		// member cannot even read answers not_found, never forbidden.
		if _, err := f.svc.MoveDocument(f.ctx, member, src.ID, MoveDocumentInput{ParentID: dst.ID, Revision: 1}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("move without destination access = %v, want ErrNotFound", err)
		}
		// Manage the destination, only view on the source.
		dst2 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		src2 := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, dst2, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
		viewShare := f.share(t, src2, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		if _, err := f.svc.MoveDocument(f.ctx, member, src2.ID, MoveDocumentInput{ParentID: dst2.ID, Revision: 1}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("move with view-only source = %v, want ErrForbidden", err)
		}
		// Edit on both ends goes through.
		f.revoke(t, viewShare, tn.aclOwner.ID)
		f.share(t, src2, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
		if _, err := f.svc.MoveDocument(f.ctx, member, src2.ID, MoveDocumentInput{ParentID: dst2.ID, Revision: 1}); err != nil {
			t.Fatalf("move with both permissions: %v", err)
		}
	})

	t.Run("an owned document has no tree slot", func(t *testing.T) {
		// The owner service grants the org owner manage on the owned doc;
		// the public move still refuses - owned docs have no tree slot.
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.owner.ID: DocumentLevelManage})
		defer f.svc.SetOwnerLevelResolver(nil)
		owned := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "wp-1"})
		parent := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, owned.ID, MoveDocumentInput{ParentID: parent.ID, Revision: 1})
		wantCode(t, err, "document_owned_by_work_product")
		// An actor who cannot read the document at all learns only that the
		// id does not answer - the owned refusal never confirms it (R1-07).
		hidden := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", createdBy: tn.aclOwner.ID, ownerID: "wp-2"})
		if _, err := f.svc.MoveDocument(f.ctx, Human(tn.member.ID), hidden.ID, MoveDocumentInput{ParentID: parent.ID, Revision: 1}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("move on an invisible owned doc = %v, want ErrNotFound", err)
		}
	})

	t.Run("a stale revision conflicts", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		_, err := f.svc.MoveDocument(f.ctx, owner, a.ID, MoveDocumentInput{ParentID: b.ID, Revision: a.Revision + 9})
		wantCode(t, err, "revision_conflict")
	})

	t.Run("concurrent opposite moves serialize without a cycle", func(t *testing.T) {
		a := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "A"})
		b := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "B"})
		ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
		defer cancel()
		start := make(chan struct{})
		errs := make(chan error, 2)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, err := f.svc.MoveDocument(ctx, owner, a.ID, MoveDocumentInput{ParentID: b.ID, Revision: 1})
			errs <- err
		}()
		go func() {
			defer wg.Done()
			<-start
			_, err := f.svc.MoveDocument(ctx, owner, b.ID, MoveDocumentInput{ParentID: a.ID, Revision: 1})
			errs <- err
		}()
		close(start)
		wg.Wait()
		close(errs)
		var moved, refused int
		for err := range errs {
			if err == nil {
				moved++
				continue
			}
			var ce CodedError
			if !errors.As(err, &ce) || (ce.Code != "document_cycle" && ce.Code != "revision_conflict") {
				t.Fatalf("unexpected move error %v", err)
			}
			refused++
		}
		if moved != 1 || refused != 1 {
			t.Fatalf("moved=%d refused=%d, want exactly one of each", moved, refused)
		}
		// The surviving tree is still a forest: walk the parent chain from
		// both rows and never see a node twice.
		for _, id := range []string{a.ID, b.ID} {
			seen := map[string]bool{}
			d := f.live(t, id)
			for d.ParentID.Valid {
				if seen[d.ID] {
					t.Fatalf("cycle survived the race at %s", d.ID)
				}
				seen[d.ID] = true
				d = f.live(t, d.ParentID.String)
			}
		}
	})

	t.Run("the tree hides a subtree the member cannot read", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, title: "Cây"})
		open := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		secret := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: root.ID})
		grand := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, parent: secret.ID})
		tree, err := f.svc.DocumentTree(f.ctx, Human(tn.member.ID), tn.wsA, root.ID)
		if err != nil {
			t.Fatal(err)
		}
		var ids []string
		treeIDs(tree, &ids)
		for _, id := range ids {
			if id == secret.ID || id == grand.ID {
				t.Fatalf("restricted subtree leaked to member: %v", ids)
			}
		}
		var sawOpen bool
		for _, id := range ids {
			if id == open.ID {
				sawOpen = true
			}
		}
		if !sawOpen {
			t.Fatalf("visible child missing from member tree: %v", ids)
		}
	})
}
