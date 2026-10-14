package service

// E6/FD-05 (UNI-1465) title search, kind=document, batched path resolution and
// trigram index EXPLAIN tests.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentTitleSearchAndKind(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tsearch")

	folder := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "Hợp đồng", searchText: documentSearchText("Hợp đồng", ""),
	})
	docTitle := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindPage, title: "Hợp đồng A", contentText: "nội dung chung",
		searchText: documentSearchText("Hợp đồng A", "nội dung chung"),
	})
	fileTitle := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindFile, title: "Hợp đồng B.pdf",
		searchText: documentSearchText("Hợp đồng B.pdf", ""),
	})
	docBodyOnly := f.treeDoc(t, tn, treeDocSpec{
		ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
		kind: DocumentKindPage, title: "Biên bản", contentText: "thảo luận về Hợp đồng",
		searchText: documentSearchText("Biên bản", "thảo luận về Hợp đồng"),
	})

	t.Run("match=title matches folded title only and excludes content-only hits", func(t *testing.T) {
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "hop dong", Match: "title", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if !containsID(ids, folder.ID) || !containsID(ids, docTitle.ID) || !containsID(ids, fileTitle.ID) {
			t.Fatalf("match=title ids = %v, want folder %s, page %s, file %s", ids, folder.ID, docTitle.ID, fileTitle.ID)
		}
		if containsID(ids, docBodyOnly.ID) {
			t.Fatalf("match=title returned content-only match %s (%v)", docBodyOnly.ID, ids)
		}
	})

	t.Run("no match keeps legacy search_text behavior", func(t *testing.T) {
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "hop dong", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if !containsID(ids, folder.ID) || !containsID(ids, docTitle.ID) || !containsID(ids, fileTitle.ID) || !containsID(ids, docBodyOnly.ID) {
			t.Fatalf("default search ids = %v, want all four matches", ids)
		}
	})

	t.Run("kind=folder returns only folders and kind=document returns non-folders", func(t *testing.T) {
		foldersOnly, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "hop dong", Match: "title", Kind: DocumentKindFolder, Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		fIDs := listIDs(foldersOnly)
		if len(fIDs) != 1 || fIDs[0] != folder.ID {
			t.Fatalf("kind=folder ids = %v, want [%s]", fIDs, folder.ID)
		}

		docsOnly, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "hop dong", Match: "title", Kind: "document", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		dIDs := listIDs(docsOnly)
		if containsID(dIDs, folder.ID) || !containsID(dIDs, docTitle.ID) || !containsID(dIDs, fileTitle.ID) {
			t.Fatalf("kind=document ids = %v, want [%s, %s] without folder %s", dIDs, docTitle.ID, fileTitle.ID, folder.ID)
		}
	})

	t.Run("invalid match is rejected with 400 Invalid", func(t *testing.T) {
		_, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "hop dong", Match: "body",
		})
		if err == nil {
			t.Fatal("expected Invalid error for match=body, got nil")
		}
	})

	t.Run("LIKE wildcards % and _ stay literal with match=title", func(t *testing.T) {
		litPct := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Tăng 100% doanh thu", searchText: documentSearchText("Tăng 100% doanh thu", ""),
		})
		litNoPct := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "Tăng 1000 doanh thu", searchText: documentSearchText("Tăng 1000 doanh thu", ""),
		})
		litUnd := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "mã_tài_liệu", searchText: documentSearchText("mã_tài_liệu", ""),
		})
		litNoUnd := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, title: "mãxtàixliệu", searchText: documentSearchText("mãxtàixliệu", ""),
		})

		pctPage, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "100%", Match: "title", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		pctIDs := listIDs(pctPage)
		if !containsID(pctIDs, litPct.ID) || containsID(pctIDs, litNoPct.ID) {
			t.Fatalf("query 100%% with match=title got %v, want %s and not %s", pctIDs, litPct.ID, litNoPct.ID)
		}

		undPage, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "ma_tai_lieu", Match: "title", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		undIDs := listIDs(undPage)
		if !containsID(undIDs, litUnd.ID) || containsID(undIDs, litNoUnd.ID) {
			t.Fatalf("query ma_tai_lieu with match=title got %v, want %s and not %s", undIDs, litUnd.ID, litNoUnd.ID)
		}
	})
}

func TestDocumentListPath(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tpath")

	t.Run("deep chain returns root-to-parent order up to maxDocumentDepth", func(t *testing.T) {
		// Build a chain of depth maxDocumentDepth (and test up to 20 levels if
		// seeded directly in DB, since FD-03 may raise maxDocumentDepth to 20;
		// the path walk caps at 2*maxDocumentDepth).
		depth := maxDocumentDepth
		chain := make([]db.Document, depth)
		parentID := ""
		for i := 0; i < depth; i++ {
			title := fmt.Sprintf("Cấp %d", i+1)
			if i == depth-1 {
				title = "Lá sâu đặc biệt"
			}
			chain[i] = f.treeDoc(t, tn, treeDocSpec{
				ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
				kind: DocumentKindFolder, parent: parentID, title: title,
				searchText: documentSearchText(title, ""),
			})
			parentID = chain[i].ID
		}
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "la sau dac biet", Match: "title", Limit: 10,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].Document.ID != chain[depth-1].ID {
			t.Fatalf("got items %v, want leaf %s", listIDs(page), chain[depth-1].ID)
		}
		gotPath := page.Items[0].Path
		if len(gotPath) != depth-1 {
			t.Fatalf("len(Path) = %d, want %d (%v)", len(gotPath), depth-1, gotPath)
		}
		for i := 0; i < depth-1; i++ {
			if gotPath[i].ID != chain[i].ID || gotPath[i].Title != chain[i].Title {
				t.Fatalf("path[%d] = %+v, want {%s %q}", i, gotPath[i], chain[i].ID, chain[i].Title)
			}
		}
	})

	t.Run("restricted ancestor cuts path before it and never leaks titles above", func(t *testing.T) {
		root := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, title: "Gốc công khai BíMậtGốc",
		})
		secretMid := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, parent: root.ID, title: "Thư mục mật BíMậtGiữa",
		})
		openParent := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindFolder, parent: secretMid.ID, title: "Cha đọc được",
		})
		leaf := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, parent: openParent.ID, title: "Tài liệu dưới vùng hạn chế",
			searchText: documentSearchText("Tài liệu dưới vùng hạn chế", ""),
		})

		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{
			Query: "tai lieu duoi vung han che", Match: "title", Limit: 10,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].Document.ID != leaf.ID {
			t.Fatalf("got items %v, want [%s]", listIDs(page), leaf.ID)
		}
		gotPath := page.Items[0].Path
		if len(gotPath) != 1 || gotPath[0].ID != openParent.ID || gotPath[0].Title != openParent.Title {
			t.Fatalf("path = %+v, want only direct readable parent [%s %q]", gotPath, openParent.ID, openParent.Title)
		}
		for _, p := range gotPath {
			if strings.Contains(p.Title, "BíMật") || p.ID == secretMid.ID || p.ID == root.ID {
				t.Fatalf("restricted or above-restricted ancestor leaked in path: %+v", gotPath)
			}
		}
	})

	t.Run("foreign-tenant poison parent never enters path", func(t *testing.T) {
		tnOther := f.tenant(t, "tpathother")
		poison := f.treeDoc(t, tnOther, treeDocSpec{
			ws: tnOther.wsA, visibility: "workspace", aclOwner: tnOther.owner.ID, createdBy: tnOther.owner.ID,
			kind: DocumentKindFolder, title: "PoisonForeignFolder",
		})
		// Also test same-org different-workspace poison parent.
		wsBPoison := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsB, visibility: "workspace", aclOwner: tn.owner.ID, createdBy: tn.owner.ID,
			kind: DocumentKindFolder, title: "PoisonOtherWorkspace",
		})
		victim1 := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, parent: poison.ID, title: "Victim doc 1",
			searchText: documentSearchText("Victim doc 1", ""),
		})
		victim2 := f.treeDoc(t, tn, treeDocSpec{
			ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			kind: DocumentKindPage, parent: wsBPoison.ID, title: "Victim doc 2",
			searchText: documentSearchText("Victim doc 2", ""),
		})

		page, err := f.svc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{
			Query: "victim doc", Match: "title", Limit: 10,
		})
		if err != nil {
			t.Fatal(err)
		}
		ids := listIDs(page)
		if !containsID(ids, victim1.ID) || !containsID(ids, victim2.ID) {
			t.Fatalf("got %v, want victims %s and %s", ids, victim1.ID, victim2.ID)
		}
		for _, it := range page.Items {
			if len(it.Path) != 0 {
				t.Fatalf("doc %s has non-empty path %+v from foreign/other-ws parent", it.Document.ID, it.Path)
			}
		}
	})

	t.Run("50 results uses fixed query count without N+1", func(t *testing.T) {
		tnBatch := f.tenant(t, "tbatch")
		p1 := f.treeDoc(t, tnBatch, treeDocSpec{
			ws: tnBatch.wsA, visibility: "workspace", aclOwner: tnBatch.aclOwner.ID, createdBy: tnBatch.aclOwner.ID,
			kind: DocumentKindFolder, title: "Thư mục gốc lô",
		})
		p2 := f.treeDoc(t, tnBatch, treeDocSpec{
			ws: tnBatch.wsA, visibility: "restricted", aclOwner: tnBatch.aclOwner.ID, createdBy: tnBatch.aclOwner.ID,
			kind: DocumentKindFolder, parent: p1.ID, title: "Thư mục con được chia sẻ",
		})
		f.share(t, p2, DocumentPrincipalUser, tnBatch.member.ID, DocumentLevelView, tnBatch.aclOwner.ID)

		for i := 0; i < 50; i++ {
			title := fmt.Sprintf("Tài liệu lô số %02d", i)
			f.treeDoc(t, tnBatch, treeDocSpec{
				ws: tnBatch.wsA, visibility: "workspace", aclOwner: tnBatch.aclOwner.ID, createdBy: tnBatch.aclOwner.ID,
				kind: DocumentKindFile, parent: p2.ID, title: title,
				searchText: documentSearchText(title, ""),
			})
		}

		cPool, counter := countingPool(t, f.pool)
		tracedSvc := newDocumentServiceForTest(cPool, db.New(cPool))

		counter.n.Store(0)
		page5, err := tracedSvc.ListDocuments(f.ctx, Human(tnBatch.member.ID), tnBatch.wsA, ListDocumentsInput{
			Query: "tai lieu lo so", Match: "title", Limit: 5,
		})
		if err != nil {
			t.Fatal(err)
		}
		q5 := counter.n.Load()
		if len(page5.Items) != 5 || len(page5.Items[0].Path) != 2 {
			t.Fatalf("page5 items=%d path=%+v, want 5 items with 2-step path", len(page5.Items), page5.Items[0].Path)
		}

		counter.n.Store(0)
		page50, err := tracedSvc.ListDocuments(f.ctx, Human(tnBatch.member.ID), tnBatch.wsA, ListDocumentsInput{
			Query: "tai lieu lo so", Match: "title", Limit: 50,
		})
		if err != nil {
			t.Fatal(err)
		}
		q50 := counter.n.Load()
		if len(page50.Items) != 50 || len(page50.Items[49].Path) != 2 {
			t.Fatalf("page50 items=%d path=%+v, want 50 items with 2-step path", len(page50.Items), page50.Items[49].Path)
		}
		if q50 != q5 {
			t.Fatalf("query count grew with result size: 5 items = %d queries, 50 items = %d queries", q5, q50)
		}
	})
}

type sqlCaptureTracer struct {
	sql  string
	args []any
}

func (c *sqlCaptureTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "-- name: ListDocumentsPage") {
		c.sql = data.SQL
		c.args = data.Args
	}
	return ctx
}

func (c *sqlCaptureTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestDocumentTitleSearchExplainUsesIndex(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "texplain")

	// Seed 20,000 live rows in one statement so the planner prefers the GIN
	// trigram index on uw_fold_search(title) over a sequential scan.
	prefix := util.NewID()[:10]
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO documents (
			id, organization_id, workspace_id, kind, title, visibility,
			content, content_text, search_text, content_bytes,
			current_version, revision, content_revision, position,
			acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind
		)
		SELECT
			$1 || '-' || g::text,
			$2,
			$3,
			CASE WHEN g % 5 = 0 THEN 'folder' ELSE 'page' END,
			CASE WHEN g = 42 THEN 'Hợp đồng nguyên tắc đặc biệt' ELSE 'Tài liệu mẫu số ' || g::text END,
			'workspace',
			CASE WHEN g % 5 = 0 THEN NULL ELSE '{"type":"doc","content":[]}'::jsonb END,
			'',
			'tai lieu mau so ' || g::text,
			CASE WHEN g % 5 = 0 THEN 0 ELSE 27 END,
			0, 1, 1, g::double precision,
			$4, $4, 'human', $4, 'human'
		FROM generate_series(1, 20000) AS g
	`, prefix, tn.orgID, tn.wsA, tn.owner.ID); err != nil {
		t.Fatalf("seed 20k documents: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM documents WHERE organization_id = $1`, tn.orgID)
	})

	if _, err := f.pool.Exec(f.ctx, `ANALYZE documents`); err != nil {
		t.Fatalf("ANALYZE documents: %v", err)
	}

	cfg := f.pool.Config()
	capTracer := &sqlCaptureTracer{}
	cfg.ConnConfig.Tracer = capTracer
	cPool, err := pgxpool.NewWithConfig(f.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cPool.Close)
	tracedSvc := newDocumentServiceForTest(cPool, db.New(cPool))

	page, err := tracedSvc.ListDocuments(f.ctx, Human(tn.owner.ID), tn.wsA, ListDocumentsInput{
		Query: "hop dong nguyen tac", Match: "title", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Document.Title != "Hợp đồng nguyên tắc đặc biệt" {
		t.Fatalf("title search items = %v, want 1 match", listIDs(page))
	}
	if capTracer.sql == "" {
		t.Fatal("failed to capture ListDocumentsPage SQL")
	}

	var explainJSON string
	if err := f.pool.QueryRow(f.ctx, `EXPLAIN (FORMAT JSON) `+capTracer.sql, capTracer.args...).Scan(&explainJSON); err != nil {
		t.Fatalf("EXPLAIN JSON: %v", err)
	}
	if !strings.Contains(explainJSON, "idx_documents_title_fold") {
		t.Fatalf("EXPLAIN JSON did not use idx_documents_title_fold:\n%s", explainJSON)
	}

	rows, err := f.pool.Query(f.ctx, `EXPLAIN (ANALYZE, BUFFERS) `+capTracer.sql, capTracer.args...)
	if err != nil {
		t.Fatalf("EXPLAIN ANALYZE: %v", err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	explainText := strings.Join(lines, "\n") + "\n"
	if !strings.Contains(explainText, "idx_documents_title_fold") {
		t.Fatalf("EXPLAIN ANALYZE did not use idx_documents_title_fold:\n%s", explainText)
	}
	reportPath := filepath.FromSlash("D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/office-g5g6g7/reports/e6-search/explain-title-idx.txt")
	if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err == nil {
		_ = os.WriteFile(reportPath, []byte(explainText), 0o644)
	}
}
