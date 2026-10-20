package service

import (
	"bytes"
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2039 fx1 (Advisor folder rule): the report lists documents. A folder -
// My Folder included - is a scope the picker or folder_id names, never a row
// of the page, the export, the summary or the principals table.
func TestAccessReportExcludesFoldersAndMyFolder(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fx1a")
	owner := Human(tn.owner.ID)

	folder := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "Hồ sơ", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, folder, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	mf := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "My Folder", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET system_kind = 'my_folder' WHERE id = $1`, mf.ID); err != nil {
		t.Fatal(err)
	}
	f.share(t, mf, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	inFolder := f.arDoc(t, tn, arDocSpec{title: "Trong thư mục", parent: folder.ID, visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, inFolder, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)

	// Page, workspace scope.
	page := f.report(t, owner, tn.wsA, DocumentAccessReportQuery{})
	arSame(t, "page", arIDs(page), []string{inFolder.ID})

	// Page, folder scope: the root is a scope, not a row.
	page = f.report(t, owner, tn.wsA, DocumentAccessReportQuery{FolderID: folder.ID})
	arSame(t, "page in folder", arIDs(page), []string{inFolder.ID})
	if page.FolderID != folder.ID {
		t.Fatalf("folder scope = %q", page.FolderID)
	}

	// Export: no row names a folder title.
	var buf bytes.Buffer
	if _, err := f.svc.ExportDocumentAccessReport(f.ctx, owner, tn.wsA, DocumentAccessReportQuery{}, AccessReportFormatCSV, &buf); err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{"Hồ sơ", "My Folder"} {
		for _, line := range strings.Split(buf.String(), "\n") {
			if strings.HasPrefix(line, `"`+title+`"`) || strings.HasPrefix(line, title+",") {
				t.Errorf("export lists the folder %q: %s", title, line)
			}
		}
	}
	if !strings.Contains(buf.String(), "Trong thư mục") {
		t.Fatalf("export lost the document in the folder:\n%s", buf.String())
	}

	// Summary: tiles count the one document only.
	sum, err := f.svc.DocumentAccessReportSummary(f.ctx, owner, tn.wsA, DocumentAccessReportQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Tiles.Documents != 1 || sum.MatchingDocuments != 1 {
		t.Fatalf("summary documents = %d matching = %d, want 1 and 1", sum.Tiles.Documents, sum.MatchingDocuments)
	}

	// Principals: the creator holds rows on the two folders only, so they
	// are not a principal; the member (on a document) is.
	pr, err := f.svc.DocumentAccessReportPrincipals(f.ctx, owner, tn.wsA, DocumentAccessReportPrincipalsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var sawMember bool
	for _, p := range pr.Principals {
		switch p.PrincipalID {
		case tn.creator.ID:
			t.Errorf("principals lists %s, who holds rows on folders only", p.PrincipalName)
		case tn.member.ID:
			sawMember = true
		}
	}
	if !sawMember {
		t.Fatal("principals lost the member who holds a row on a document")
	}
}

// arCandidateReads counts the candidate reads a traced pool sends.
type arCandidateReads struct{ n atomic.Int64 }

func (c *arCandidateReads) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	if strings.Contains(d.SQL, "name: ListDocumentAccessReportWorkspaceCandidates") {
		c.n.Add(1)
	}
	return ctx
}

func (c *arCandidateReads) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// UNI-2039 r1 F3: a page reads its whole scan window (10 x limit candidates)
// in ONE candidate query and works through it in chunks in memory; before, a
// caller who manages few documents re-ran the candidate query up to 10 times.
func TestAccessReportPageReadsOneCandidateWindow(t *testing.T) {
	f := newDocPermFixture(t)
	cfg := f.pool.Config()
	reads := &arCandidateReads{}
	cfg.ConnConfig.Tracer = reads
	cPool, err := pgxpool.NewWithConfig(f.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cPool.Close)
	traced := newDocumentServiceForTest(cPool, db.New(cPool))

	tn := f.tenant(t, "fx1c")
	member := Human(tn.member.ID)
	base := time.Now().UTC().Truncate(time.Second).Add(-500 * time.Hour)
	n := 0
	mk := func(managed bool) {
		spec := arDocSpec{visibility: "workspace"} // edit for the member: listed only when managed
		if managed {
			spec.aclOwner = tn.member.ID
		}
		d := f.arDoc(t, tn, spec)
		n++
		f.arSetCreated(t, d.ID, base.Add(time.Duration(n)*time.Minute))
	}
	for i := 0; i < 3; i++ {
		mk(true)
	}
	for i := 0; i < 25; i++ {
		mk(false)
	}
	for i := 0; i < 3; i++ {
		mk(true)
	}

	reads.n.Store(0)
	p, err := traced.DocumentAccessReport(f.ctx, member, tn.wsA, DocumentAccessReportQuery{Limit: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Items) != 4 || p.Candidates != 29 || p.Skipped != 25 {
		t.Fatalf("page: %d items, %d candidates, %d skipped, want 4, 29, 25", len(p.Items), p.Candidates, p.Skipped)
	}
	if got := reads.n.Load(); got != 1 {
		t.Fatalf("candidate reads for one page = %d, want 1", got)
	}
}
