package service

// FD-04 (UNI-1464, phụ lục thư mục §3.4): the counts the delete dialog warns
// with, GET /documents/{documentID}/archive-impact.
//
// The read runs the archive command's checks in its order - manage on the
// root, the same bounded subtree walk, the same manage gate on that id set,
// then the count - and steps two to four share ONE REPEATABLE READ, read-only
// transaction, so the ids, the access decision and the numbers describe one
// moment. A subtree past the bound answers too_large before any per-node work
// or count, exactly like the command; a node the caller cannot manage refuses
// the whole read with no number in the answer. Reading writes nothing.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// wantImpact pins the whole answer: the counts, the bound and the flag.
func wantImpact(t *testing.T, svc *DocumentService, got DocumentArchiveImpact, folders, documents, total int) {
	t.Helper()
	want := DocumentArchiveImpact{Folders: folders, Documents: documents, Total: total, MaxNodes: svc.archiveBound()}
	if got != want {
		t.Fatalf("impact = %+v, want %+v", got, want)
	}
}

func TestDocumentArchiveImpact(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "aimpact")
	ctx := f.ctx
	owner := Human(tn.owner.ID)
	member := Human(tn.member.ID)

	// doc inserts one live node with the tenant's default shape; spec tweaks
	// a row into a restricted or archived one.
	doc := func(t *testing.T, parent, kind, title string, spec func(*treeDocSpec)) db.Document {
		t.Helper()
		s := treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			parent: parent, kind: kind, title: title,
		}
		if spec != nil {
			spec(&s)
		}
		return f.treeDoc(t, tn, s)
	}

	t.Run("counts the live shape: sub-folders and documents, root only in the total", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Gốc", nil)
		subA := doc(t, root.ID, DocumentKindFolder, "A", nil)
		doc(t, root.ID, DocumentKindFolder, "B", nil)
		page := doc(t, root.ID, DocumentKindPage, "Trang 1", nil)
		doc(t, root.ID, DocumentKindPage, "Trang 2", nil)
		doc(t, root.ID, DocumentKindPage, "Trang 3", nil)
		doc(t, subA.ID, DocumentKindFile, "Tệp", nil)
		// A page inside a page counts as a document, and is not a direct
		// child of the folder: the count follows the tree, not one level.
		doc(t, page.ID, DocumentKindPage, "Trang trong trang", nil)

		got, err := f.svc.ArchiveImpact(ctx, owner, root.ID)
		if err != nil {
			t.Fatalf("archive impact: %v", err)
		}
		wantImpact(t, f.svc, got, 2, 5, 8)
		// The total is exactly the rows the archive command moves.
		res, err := f.svc.ArchiveDocument(ctx, owner, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("archive: %v", err)
		}
		if len(res.Affected) != got.Total {
			t.Fatalf("archive moved %d rows, impact said total=%d", len(res.Affected), got.Total)
		}
	})

	t.Run("an empty folder is one row and reads write nothing", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Trống", nil)
		got, err := f.svc.ArchiveImpact(ctx, owner, root.ID)
		if err != nil {
			t.Fatalf("archive impact: %v", err)
		}
		wantImpact(t, f.svc, got, 0, 0, 1)
		// A read: no audit row, no event, no revision bump.
		var audits, events int
		if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE resource_id = $1`, root.ID).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE payload::jsonb->>'document_id' = $1`, root.ID).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if audits != 0 || events != 0 {
			t.Fatalf("impact wrote %d audit and %d outbox rows, want none", audits, events)
		}
		if d := f.live(t, root.ID); d.Revision != 1 {
			t.Fatalf("revision = %d after a read, want 1", d.Revision)
		}
	})

	t.Run("the bound itself counts, one node past it refuses with no counts", func(t *testing.T) {
		// 999 children + the root is exactly documentArchiveMaxNodes.
		atBound := doc(t, "", DocumentKindFolder, "Đúng trần", nil)
		f.seedChildren(t, tn, tn.wsA, atBound.ID, documentArchiveMaxNodes-1, false)
		f.analyzeDocuments(t)
		got, err := f.svc.ArchiveImpact(ctx, owner, atBound.ID)
		if err != nil {
			t.Fatalf("archive impact at the bound: %v", err)
		}
		wantImpact(t, f.svc, got, 0, documentArchiveMaxNodes-1, documentArchiveMaxNodes)

		over := doc(t, "", DocumentKindFolder, "Quá trần", nil)
		f.seedChildren(t, tn, tn.wsA, over.ID, documentArchiveMaxNodes, false)
		f.analyzeDocuments(t)
		got, err = f.svc.ArchiveImpact(ctx, owner, over.ID)
		if err != nil {
			t.Fatalf("archive impact past the bound: %v", err)
		}
		if !got.TooLarge || got.Folders != 0 || got.Documents != 0 || got.Total != 0 {
			t.Fatalf("past the bound = %+v, want too_large with no counts", got)
		}
		if got.MaxNodes != documentArchiveMaxNodes {
			t.Fatalf("max_nodes = %d, want %d", got.MaxNodes, documentArchiveMaxNodes)
		}
		// The command refuses the same subtree, so the answer the dialog gets
		// never promises a delete that cannot happen.
		if _, err := f.svc.ArchiveDocument(ctx, owner, over.ID, ArchiveDocumentInput{}); err != nil {
			wantCode(t, err, "folder_too_large")
		}
	})

	t.Run("past the bound the refusal wins over a node the caller cannot manage", func(t *testing.T) {
		f.svc.archiveMaxNodes = 3
		defer func() { f.svc.archiveMaxNodes = 0 }()

		// The same shape twice: a root the caller manages through a share and
		// a restricted child they do not manage at all.
		shape := func(t *testing.T, title string, children int) db.Document {
			t.Helper()
			root := doc(t, "", DocumentKindFolder, title, nil)
			doc(t, root.ID, DocumentKindPage, title+" hạn chế", func(s *treeDocSpec) {
				s.visibility = "restricted"
			})
			f.share(t, root, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
			f.seedChildren(t, tn, tn.wsA, root.ID, children, false)
			return root
		}

		// Two nodes: inside the bound, so the manage gate runs and refuses.
		inside := shape(t, "Trong trần", 0)
		if _, err := f.svc.ArchiveImpact(ctx, member, inside.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("inside the bound with an unmanageable node = %v, want forbidden", err)
		}
		// Past the bound the walk stops first: too_large, no per-node check,
		// the same answer the archive command gives.
		over := shape(t, "Quá trần hạn chế", 2)
		got, err := f.svc.ArchiveImpact(ctx, member, over.ID)
		if err != nil {
			t.Fatalf("past the bound with an unmanageable node: %v", err)
		}
		if !got.TooLarge {
			t.Fatalf("past the bound = %+v, want too_large", got)
		}
		if _, err := f.svc.ArchiveDocument(ctx, member, over.ID, ArchiveDocumentInput{}); err != nil {
			wantCode(t, err, "folder_too_large")
		}
	})

	t.Run("an archived node on the path is walked but not counted", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Gốc có nhánh lưu trữ", nil)
		middle := doc(t, root.ID, DocumentKindFolder, "Đã lưu trữ", func(s *treeDocSpec) { s.archived = true })
		leaf := doc(t, middle.ID, DocumentKindPage, "Còn sống", nil)

		got, err := f.svc.ArchiveImpact(ctx, owner, root.ID)
		if err != nil {
			t.Fatalf("archive impact through an archived node: %v", err)
		}
		// The archived folder is traversed (the live leaf hangs under it) but
		// is not one of the rows the archive would write.
		wantImpact(t, f.svc, got, 0, 1, 2)
		res, err := f.svc.ArchiveDocument(ctx, owner, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("archive: %v", err)
		}
		if len(res.Affected) != got.Total {
			t.Fatalf("archive moved %v, impact said total=%d", res.Affected, got.Total)
		}
		f.archived(t, leaf.ID)
		f.archived(t, middle.ID) // kept its older state
	})

	t.Run("a tree at the depth bound is counted whole", func(t *testing.T) {
		root := f.seedSpineTree(t, tn, tn.wsA, maxDocumentDepth, 1)
		got, err := f.svc.ArchiveImpact(ctx, owner, root)
		if err != nil {
			t.Fatalf("archive impact on a %d-level tree: %v", maxDocumentDepth, err)
		}
		wantImpact(t, f.svc, got, 0, maxDocumentDepth-1, maxDocumentDepth)
	})

	t.Run("one node the caller cannot manage refuses the whole read", func(t *testing.T) {
		root := doc(t, "", DocumentKindFolder, "Có nút hạn chế", nil)
		doc(t, root.ID, DocumentKindPage, "Hạn chế", func(s *treeDocSpec) { s.visibility = "restricted" })
		f.share(t, root, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)

		got, err := f.svc.ArchiveImpact(ctx, member, root.ID)
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("archive impact with an unmanageable node = %v, want forbidden", err)
		}
		if got != (DocumentArchiveImpact{}) {
			t.Fatalf("refused read carried %+v, want no number at all", got)
		}
		// The caller who cannot read the root at all gets the stranger's
		// answer, never a confirmation of the id.
		if _, err := f.svc.ArchiveImpact(ctx, Human(tn.outsider.ID), root.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("stranger = %v, want not found", err)
		}
		if _, err := f.svc.ArchiveImpact(ctx, Human(tn.deact.ID), root.ID); !errors.Is(err, ErrMemberDeactivated) {
			t.Fatalf("deactivated member = %v, want ErrMemberDeactivated", err)
		}
	})

	t.Run("a document of another tenant is not found", func(t *testing.T) {
		other := f.tenant(t, "aimpact2")
		root := doc(t, "", DocumentKindFolder, "Của A", nil)
		if _, err := f.svc.ArchiveImpact(ctx, Human(other.owner.ID), root.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other tenant = %v, want not found", err)
		}
	})

	t.Run("the numbers come from one REPEATABLE READ, read-only snapshot", func(t *testing.T) {
		var iso, readOnly string
		// armed arms the seam for exactly one read: it records the
		// transaction's own isolation and access mode and lets a writer commit
		// between the walk and the count.
		armed := func(write func()) func(context.Context, pgx.Tx) {
			return func(ctx context.Context, tx pgx.Tx) {
				documentArchiveImpactTx = nil // one shot: the writer runs once
				if err := tx.QueryRow(ctx, "SHOW transaction_isolation").Scan(&iso); err != nil {
					t.Errorf("SHOW transaction_isolation: %v", err)
				}
				if err := tx.QueryRow(ctx, "SHOW transaction_read_only").Scan(&readOnly); err != nil {
					t.Errorf("SHOW transaction_read_only: %v", err)
				}
				write()
			}
		}
		t.Cleanup(func() { documentArchiveImpactTx = nil })

		// An archive commits in between. Under READ COMMITTED the count would
		// see the archive and answer 0 documents; the promise is that the
		// answer keeps describing the one snapshot the walk opened.
		root := doc(t, "", DocumentKindFolder, "Ảnh chụp lưu trữ", nil)
		child := doc(t, root.ID, DocumentKindPage, "Con", nil)
		documentArchiveImpactTx = armed(func() {
			if _, err := f.svc.ArchiveDocument(context.Background(), owner, child.ID, ArchiveDocumentInput{}); err != nil {
				t.Errorf("interleaved archive: %v", err)
			}
		})
		got, err := f.svc.ArchiveImpact(ctx, owner, root.ID)
		if err != nil {
			t.Fatalf("archive impact: %v", err)
		}
		wantImpact(t, f.svc, got, 0, 1, 2) // the child is still counted
		f.archived(t, child.ID)            // and the interleaved archive did commit

		// A create commits in between: the new row must not appear either.
		createdRoot := doc(t, "", DocumentKindFolder, "Ảnh chụp tạo", nil)
		doc(t, createdRoot.ID, DocumentKindPage, "Con cũ", nil)
		var created string
		documentArchiveImpactTx = armed(func() {
			view, err := f.svc.CreatePage(context.Background(), owner, tn.wsA, CreatePageInput{
				Kind: DocumentKindPage, ParentID: createdRoot.ID, Title: "Sinh giữa lượt đọc",
			})
			if err != nil {
				t.Errorf("interleaved create: %v", err)
				return
			}
			created = view.Document.ID
		})
		got, err = f.svc.ArchiveImpact(ctx, owner, createdRoot.ID)
		if err != nil {
			t.Fatalf("archive impact: %v", err)
		}
		wantImpact(t, f.svc, got, 0, 1, 2) // the new page is not in the snapshot
		if _, err := f.q.GetDocumentByID(ctx, created); err != nil {
			t.Fatalf("the interleaved create did commit: %v", err)
		}
		if iso != "repeatable read" || readOnly != "on" {
			t.Fatalf("impact transaction isolation=%q read_only=%q, want repeatable read / on", iso, readOnly)
		}
	})
}
