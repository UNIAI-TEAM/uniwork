package service

// UNI-1643 perf evidence (contract v1 §9): a folder of 1,000 documents in
// three levels, with mixed user/workspace shares and public links, inside a
// workspace that also holds 4,000 documents outside the folder. It records
// EXPLAIN (ANALYZE, BUFFERS) of the four report queries with the arguments
// the service really sends, the R1 page latency (p50/p95 over repeated first
// pages, and a full keyset walk) and the full export (CSV and XLSX).
//
// Gated behind ACCESS_REPORT_EXPLAIN=1 (it seeds thousands of rows); the
// default suite skips it. ACCESS_REPORT_EXPLAIN_REPORT names the markdown
// file the evidence is written to.

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func arPercentile(d []time.Duration, p float64) time.Duration {
	s := append([]time.Duration(nil), d...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	i := int(p*float64(len(s))+0.5) - 1
	if i < 0 {
		i = 0
	}
	if i >= len(s) {
		i = len(s) - 1
	}
	return s[i]
}

// arCapture records :one statements too (sqlCapture records Query only).
type arCapture struct{ *sqlCapture }

func (c arCapture) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	c.mu.Lock()
	c.sql, c.args = sql, append([]any(nil), args...)
	c.mu.Unlock()
	return c.sqlCapture.DBTX.QueryRow(ctx, sql, args...)
}

// arExplain runs one query through a capturing DBTX, then EXPLAINs the
// captured statement with the captured arguments.
func arExplain(t *testing.T, pool *pgxpool.Pool, name string, run func(q *db.Queries) error) string {
	t.Helper()
	capture := &sqlCapture{DBTX: pool}
	if err := run(db.New(arCapture{capture})); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	sql, args := capture.last()
	rows, err := pool.Query(context.Background(), "EXPLAIN (ANALYZE, BUFFERS) "+sql, args...)
	if err != nil {
		t.Fatalf("explain %s: %v", name, err)
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
	return strings.Join(lines, "\n")
}

func TestAccessReportExplain1000Docs(t *testing.T) {
	if os.Getenv("ACCESS_REPORT_EXPLAIN") != "1" {
		t.Skip("set ACCESS_REPORT_EXPLAIN=1 to seed 5,000 documents and record the plans")
	}
	f := newDocPermFixture(t)
	tn := f.tenant(t, "arperf")
	f.liftWorkspaceQuota(t, tn.orgID, 100000)
	ctx := f.ctx

	// The folder: root -> 10 folders -> 100 folders -> 889 documents = 1,000.
	root := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "Perf root"})
	seed := func(sql string, args ...any) {
		t.Helper()
		if _, err := f.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	// ids: a fixed prefix + a zero-padded counter keeps them unique, sortable
	// and inside the folder; visibility alternates; every 4th has an ACL owner.
	const docInsert = `INSERT INTO documents (id, organization_id, workspace_id, parent_id, kind, title, visibility,
		acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind, position)
		SELECT $1 || lpad(g::text, 6, '0'), $2, $3, %s, $4, 'Perf ' || g, CASE WHEN g %% 2 = 0 THEN 'restricted' ELSE 'workspace' END,
		CASE WHEN g %% 4 = 0 THEN $5 ELSE NULL END, $6, 'human', $6, 'human', g
		FROM generate_series($7::int, $8::int) g`
	prefix := root.ID[:14]
	seed(fmt.Sprintf(docInsert, "$9"), prefix+"A", tn.orgID, tn.wsA, DocumentKindFolder, tn.aclOwner.ID, tn.owner.ID, 1, 10, root.ID)
	seed(fmt.Sprintf(docInsert, "$9 || lpad((1 + (g - 1) / 10)::text, 6, '0')"), prefix+"B", tn.orgID, tn.wsA, DocumentKindFolder, tn.aclOwner.ID, tn.owner.ID, 1, 100, prefix+"A")
	seed(fmt.Sprintf(docInsert, "$9 || lpad((1 + (g - 1) % 100)::text, 6, '0')"), prefix+"C", tn.orgID, tn.wsA, "page", tn.aclOwner.ID, tn.owner.ID, 1, 889, prefix+"B")
	// 4,000 documents of the same workspace outside the folder.
	seed(fmt.Sprintf(docInsert, "NULL"), prefix+"Z", tn.orgID, tn.wsA, "page", tn.aclOwner.ID, tn.owner.ID, 1, 4000)
	// Shares: a user share on every 3rd, a workspace share on every 5th; a
	// live link on every 7th document of the folder.
	seed(`INSERT INTO document_shares (id, organization_id, workspace_id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind)
		SELECT 'SH' || d.id, d.organization_id, d.workspace_id, d.id, 'user', $2, 'view', $3, 'human'
		FROM documents d WHERE d.workspace_id = $1 AND CASE WHEN d.id ~ '[0-9]{6}$' THEN right(d.id, 6)::int % 3 = 0 ELSE false END`, tn.wsA, tn.member.ID, tn.owner.ID)
	seed(`INSERT INTO document_shares (id, organization_id, workspace_id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind)
		SELECT 'SW' || d.id, d.organization_id, d.workspace_id, d.id, 'workspace', $2, 'edit', $3, 'human'
		FROM documents d WHERE d.workspace_id = $1 AND CASE WHEN d.id ~ '[0-9]{6}$' THEN right(d.id, 6)::int % 5 = 0 ELSE false END`, tn.wsA, tn.wsB, tn.owner.ID)
	seed(`INSERT INTO document_share_links (id, organization_id, workspace_id, document_id, token_hash, expires_at, created_by, created_by_kind)
		SELECT 'LK' || d.id, d.organization_id, d.workspace_id, d.id, 'hash' || d.id, now() + interval '7 days', $2, 'human'
		FROM documents d WHERE d.workspace_id = $1 AND d.kind = 'page' AND CASE WHEN d.id ~ '[0-9]{6}$' THEN right(d.id, 6)::int % 7 = 0 ELSE false END`, tn.wsA, tn.owner.ID)
	seed(`ANALYZE documents`)
	seed(`ANALYZE document_shares`)
	seed(`ANALYZE document_share_links`)

	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1`, tn.wsA).Scan(&n); err != nil {
		t.Fatal(err)
	}

	var out strings.Builder
	fmt.Fprintf(&out, "# UNI-1643 access report - perf evidence (1,000-document folder)\n\n")
	fmt.Fprintf(&out, "Generated by `TestAccessReportExplain1000Docs` (ACCESS_REPORT_EXPLAIN=1) on %s.\n\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(&out, "Seed: workspace with %d documents; folder `Perf root` = 1 + 10 + 100 folders + 889 pages (1,000 nodes, 3 levels below the root); "+
		"half restricted; every 4th has an ACL owner; user share on every 3rd, workspace share on every 5th, live public link on every 7th page; "+
		"4,000 documents outside the folder. Tables ANALYZEd.\n\n", n)

	// The first page the service reads, by the owner over the folder.
	page, err := f.svc.DocumentAccessReport(ctx, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{FolderID: root.ID, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(page.Items))
	for _, it := range page.Items {
		ids = append(ids, it.Item.Document.ID)
	}
	plans := []struct {
		name string
		run  func(q *db.Queries) error
	}{
		{"Q1 ListDocumentAccessReportWorkspaceCandidates (limit 50)", func(q *db.Queries) error {
			_, err := q.ListDocumentAccessReportWorkspaceCandidates(ctx, db.ListDocumentAccessReportWorkspaceCandidatesParams{
				OrganizationID: tn.orgID, WorkspaceID: tn.wsA, MaxRows: 50,
			})
			return err
		}},
		{"Q2 ListDocumentAccessReportSubtreeCandidates (folder, limit 50)", func(q *db.Queries) error {
			_, err := q.ListDocumentAccessReportSubtreeCandidates(ctx, db.ListDocumentAccessReportSubtreeCandidatesParams{
				OrganizationID: tn.orgID, WorkspaceID: tn.wsA, RootID: root.ID, MaxLevel: subtreeMaxLevel(), MaxRows: 50,
			})
			return err
		}},
		{"Q2c CountDocumentAccessReportSubtree (export cap)", func(q *db.Queries) error {
			_, err := q.CountDocumentAccessReportSubtree(ctx, db.CountDocumentAccessReportSubtreeParams{
				OrganizationID: tn.orgID, WorkspaceID: tn.wsA, RootID: root.ID, MaxLevel: subtreeMaxLevel(), MaxNodes: 10000,
			})
			return err
		}},
		{"Q3 ListLiveDocumentSharesForReport (page of 50)", func(q *db.Queries) error {
			_, err := q.ListLiveDocumentSharesForReport(ctx, db.ListLiveDocumentSharesForReportParams{
				OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentIds: ids,
			})
			return err
		}},
		{"Q4 CountLiveDocumentShareLinksForDocuments (page of 50)", func(q *db.Queries) error {
			_, err := q.CountLiveDocumentShareLinksForDocuments(ctx, db.CountLiveDocumentShareLinksForDocumentsParams{
				OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentIds: ids,
			})
			return err
		}},
	}
	out.WriteString("## Query plans (EXPLAIN (ANALYZE, BUFFERS), the statement and arguments the generated code sends)\n\n")
	for _, p := range plans {
		plan := arExplain(t, f.pool, p.name, p.run)
		if strings.Contains(plan, "Seq Scan on documents") {
			t.Errorf("%s sequential-scans documents:\n%s", p.name, plan)
		}
		fmt.Fprintf(&out, "### %s\n\n```\n%s\n```\n\n", p.name, plan)
	}

	// R1 latency: the first folder page, 30 times per caller, and a full walk.
	out.WriteString("## R1 page latency (service call, warm, limit 50)\n\n| Caller | Runs | p50 | p95 | max |\n| --- | --- | --- | --- | --- |\n")
	for _, c := range []struct {
		name  string
		actor Actor
	}{{"workspace owner (manage all)", Human(tn.owner.ID)}, {"ACL owner, plain member (share read + skipped)", Human(tn.aclOwner.ID)}} {
		var d []time.Duration
		for i := 0; i < 30; i++ {
			start := time.Now()
			if _, err := f.svc.DocumentAccessReport(ctx, c.actor, tn.wsA, DocumentAccessReportQuery{FolderID: root.ID, Limit: 50}); err != nil {
				t.Fatal(err)
			}
			d = append(d, time.Since(start))
		}
		p95 := arPercentile(d, 0.95)
		if p95 > time.Second {
			t.Errorf("%s: R1 p95 %s over 1 s", c.name, p95)
		}
		fmt.Fprintf(&out, "| %s | 30 | %s | %s | %s |\n", c.name, arPercentile(d, 0.5).Round(time.Microsecond), p95.Round(time.Microsecond), arPercentile(d, 1).Round(time.Microsecond))
	}
	walkStart := time.Now()
	pages, listed, rows := 0, 0, 0
	after := ""
	for {
		p, err := f.svc.DocumentAccessReport(ctx, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{FolderID: root.ID, Limit: 100, AfterID: after})
		if err != nil {
			t.Fatal(err)
		}
		pages++
		listed += len(p.Items)
		for _, it := range p.Items {
			rows += len(it.Rows)
		}
		if p.NextAfterID == "" {
			break
		}
		after = p.NextAfterID
	}
	walk := time.Since(walkStart)
	if listed != 1000 {
		t.Errorf("the folder walk listed %d documents, want 1000", listed)
	}
	fmt.Fprintf(&out, "\nFull keyset walk of the folder by the owner (limit 100): %d pages, %d documents, %d rows in %s.\n\n", pages, listed, rows, walk.Round(time.Millisecond))

	// R2: the full export of the folder, both formats.
	out.WriteString("## R2 full export of the folder (one snapshot, service call incl. audit row)\n\n| Format | Runs | Rows | Bytes | p50 | p95 |\n| --- | --- | --- | --- | --- | --- |\n")
	for _, format := range []string{AccessReportFormatCSV, AccessReportFormatXLSX} {
		var d []time.Duration
		var res DocumentAccessReportExport
		size := 0
		for i := 0; i < 10; i++ {
			var buf bytes.Buffer
			start := time.Now()
			r, err := f.svc.ExportDocumentAccessReport(ctx, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{FolderID: root.ID}, format, &buf)
			if err != nil {
				t.Fatal(err)
			}
			d = append(d, time.Since(start))
			res, size = r, buf.Len()
		}
		p95 := arPercentile(d, 0.95)
		if p95 > time.Second {
			t.Errorf("export %s p95 %s over 1 s", format, p95)
		}
		fmt.Fprintf(&out, "| %s | 10 | %d | %d | %s | %s |\n", format, res.Rows, size, arPercentile(d, 0.5).Round(time.Millisecond), p95.Round(time.Millisecond))
	}

	if path := os.Getenv("ACCESS_REPORT_EXPLAIN_REPORT"); path != "" {
		if err := os.WriteFile(path, []byte(out.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Log(out.String())
}
