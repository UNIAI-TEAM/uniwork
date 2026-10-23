package service

// FD-04 (UNI-1464, phụ lục thư mục §3.4) evidence: the archive-impact read
// must not get more expensive as the subtree grows. The walk stops after
// archiveBound()+1 live rows (FD-03's row cap) and the count runs on that same
// id set, so a wide folder costs the bound, not N - and past the bound the
// answer is too_large with no count and no per-node check.
//
// The test is gated behind FD04_EXPLAIN=1 because it seeds 10^4/10^5 rows; the
// default suite skips it. FD04_EXPLAIN_REPORT names a file the markdown
// evidence is written to (the run report the lead reads).
//
// The last shape is workspace-dominant: one workspace holds 1M rows (a
// sibling folder's children) plus a 951-node 20-level spine. The walk is the
// statement both archive and archive-impact send, and its recursive term has
// no archived_at predicate - it MUST traverse archived rows - so the partial
// idx_documents_ws_parent of migration 949 cannot serve it and only the
// non-partial idx_documents_ws_parent_all (BE-FD03-1 / BE-FD04-1) keeps the
// planner off a sequential scan of the workspace per level. The shape asserts
// the walk's plan uses that index, no node sequential-scans documents, and the
// walk answers well under a second; without the index the same shape answers
// seconds late (measured by dropping it in the test database).
//
// Every measurement runs the statement the generated code sends: a recording
// DBTX captures the SQL and the arguments, and the plan runs with those same
// arguments. The end-to-end number is the real DocumentService.ArchiveImpact
// call on the same shape.

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// measureCount runs the count query for one id set through a recording DBTX
// and EXPLAINs the captured statement with the captured arguments.
func measureCount(t *testing.T, pool *pgxpool.Pool, params db.CountLiveDocumentSubtreeByKindParams) walkProbe {
	t.Helper()
	capture := &sqlCapture{DBTX: pool}
	q := db.New(capture)
	queryCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	start := time.Now()
	rows, err := q.CountLiveDocumentSubtreeByKind(queryCtx, params)
	if err != nil {
		t.Fatalf("CountLiveDocumentSubtreeByKind: %v", err)
	}
	probe := walkProbe{queryWall: time.Since(start)}
	for _, r := range rows {
		probe.ids = append(probe.ids, fmt.Sprintf("%s=%d", r.Kind, r.N))
	}
	sqlText, args := capture.last()
	if sqlText == "" {
		t.Fatal("the count query did not reach the recording DBTX")
	}
	explainCtx, cancelExplain := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancelExplain()
	start = time.Now()
	planRows, err := pool.Query(explainCtx, "EXPLAIN (ANALYZE, BUFFERS) "+sqlText, args...)
	if err != nil {
		t.Fatalf("EXPLAIN: %v", err)
	}
	defer planRows.Close()
	var lines []string
	for planRows.Next() {
		var line string
		if err := planRows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	if err := planRows.Err(); err != nil {
		t.Fatal(err)
	}
	probe.planWall = time.Since(start)
	probe.plan = compactPlan(strings.Join(lines, "\n"))
	for _, node := range parsePlanNodes(lines) {
		if strings.Contains(node.text, "Seq Scan") || strings.Contains(node.text, "Bitmap Heap Scan") {
			if node.rows > probe.heapRows {
				probe.heapRows = node.rows
			}
		}
	}
	return probe
}

// assertWalkUsesTheParentAllIndex fails loudly with the plan when the walk's
// recursive term falls back to a sequential scan of the whole workspace. That
// is the BE-FD03-1 / BE-FD04-1 shape: the recursive term carries no
// archived_at predicate (it must traverse archived rows), so the partial
// idx_documents_ws_parent cannot serve it and the planner picks a hash join
// plus a seq scan of the workspace per level - seconds on a workspace of
// millions of rows. The non-partial idx_documents_ws_parent_all is what keeps
// the nested loop in place.
func assertWalkUsesTheParentAllIndex(t *testing.T, probe walkProbe) {
	t.Helper()
	if strings.Contains(probe.plan, "Seq Scan on documents") {
		t.Fatalf("the walk sequential-scans documents; idx_documents_ws_parent_all should serve the recursive term:\n%s", probe.plan)
	}
	if !strings.Contains(probe.plan, "idx_documents_ws_parent_all") {
		t.Fatalf("the walk's plan does not use idx_documents_ws_parent_all:\n%s", probe.plan)
	}
}

// planArrayRe matches an id array literal a plan echoes back (the count query
// carries up to archiveBound()+1 ids): a thousand ids in one line would hide
// the shape the evidence is about.
var planArrayRe = regexp.MustCompile(`'\{[^']{64,}\}'`)

// compactPlan replaces each long array literal with its element count.
func compactPlan(plan string) string {
	return planArrayRe.ReplaceAllStringFunc(plan, func(m string) string {
		body := strings.Trim(m, "'")
		if strings.HasPrefix(body, "{") && strings.HasSuffix(body, "}") {
			body = body[1 : len(body)-1]
		}
		n := 0
		if body != "" {
			n = strings.Count(body, ",") + 1
		}
		return fmt.Sprintf("'<%d ids elided>'", n)
	})
}

// fd04Impact runs the real read and times it.
func (f *docPermFixture) fd04Impact(t *testing.T, actor Actor, root string) (DocumentArchiveImpact, time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	start := time.Now()
	got, err := f.svc.ArchiveImpact(ctx, actor, root)
	wall := time.Since(start)
	if err != nil {
		t.Fatalf("ArchiveImpact on %s: %v", root, err)
	}
	return got, wall
}

// TestDocumentArchiveWalkIndexExists is the cheap default-suite guard for
// BE-FD03-1 / BE-FD04-1: the non-partial (workspace_id, parent_id) index the
// archive walk needs is present, valid and shaped the way the recursive term
// requires once every migration has run. The expensive measurement - 200k+
// rows in one workspace, the plan and the latency - lives in
// TestFD04ArchiveImpactEvidence behind FD04_EXPLAIN.
//
// The shape is the assertion: the recursive term has no archived_at or
// owner_id predicate (it must traverse archived rows), so an index carrying
// either cannot serve it, which is why migration 949's partial index is kept
// for the tree listing and this non-partial one is added beside it.
func TestDocumentArchiveWalkIndexExists(t *testing.T) {
	f := newDocPermFixture(t)
	var def string
	var valid bool
	if err := f.pool.QueryRow(f.ctx, `
		SELECT pg_get_indexdef(i.indexrelid), i.indisvalid
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		WHERE c.relname = 'idx_documents_ws_parent_all'`).Scan(&def, &valid); err != nil {
		t.Fatalf("idx_documents_ws_parent_all: %v", err)
	}
	if !valid {
		t.Fatalf("idx_documents_ws_parent_all is present but not valid: %s", def)
	}
	if !strings.Contains(def, "(workspace_id, parent_id)") {
		t.Fatalf("index = %s, want (workspace_id, parent_id)", def)
	}
	// The index must NOT be partial. A partial index is only usable when the
	// query proves its predicate, and ListLiveDocumentSubtreeIDs carries no
	// owner_id or archived_at predicate, so either would leave the planner
	// free to keep the sequential scan (measured: 15.7 s on a 2M-row
	// workspace, against 6.5 ms with this index).
	if strings.Contains(def, "WHERE") {
		t.Fatalf("index = %s: a partial predicate makes it unusable for the archive walk", def)
	}
}

func TestFD04ArchiveImpactEvidence(t *testing.T) {
	if os.Getenv("FD04_EXPLAIN") != "1" {
		t.Skip("set FD04_EXPLAIN=1 to run the FD-04 archive-impact evidence (seeds 10^4+ rows)")
	}
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fd04cap")
	f.liftWorkspaceQuota(t, tn.orgID, 16)
	owner := Human(tn.owner.ID)
	bound := f.svc.archiveBound()
	maxRows := int32(bound) + 1
	walkParams := func(ws, root string) db.ListLiveDocumentSubtreeIDsParams {
		return db.ListLiveDocumentSubtreeIDsParams{
			OrganizationID: tn.orgID, WorkspaceID: ws, RootID: root,
			MaxRows: maxRows, MaxLevel: subtreeMaxLevel(),
		}
	}

	sizes := []int{10000, 100000}
	if raw := os.Getenv("FD04_EXPLAIN_SIZES"); raw != "" {
		sizes = nil
		for _, part := range strings.Split(raw, ",") {
			n, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				t.Fatalf("FD04_EXPLAIN_SIZES: %v", err)
			}
			sizes = append(sizes, n)
		}
	}

	var md strings.Builder
	fmt.Fprintf(&md, "# FD-04 EXPLAIN evidence - archive-impact counts (§3.4)\n\n")
	fmt.Fprintf(&md, "archiveBound() = %d, max_rows = %d, max_level = %d (2*maxDocumentDepth).\n", bound, maxRows, subtreeMaxLevel())
	fmt.Fprintf(&md, "Each measurement runs the statement the generated code sends: a recording DBTX captures the SQL and its arguments.\n")
	fmt.Fprintf(&md, "The end-to-end number is the real DocumentService.ArchiveImpact on the same shape; each shape is seeded into its own workspace and documents is analyzed after the seed.\n\n")

	// Wide, at the bound: 1 root + 999 children. The read must count all 1000
	// rows and stay cheap.
	wideWS := f.newWorkspace(t, tn, "wide-1000")
	wideRoot := f.seedFlatTree(t, tn, wideWS, bound-1)
	f.analyzeDocuments(t)
	wideImpact, wideWall := f.fd04Impact(t, owner, wideRoot)
	if wideImpact.Folders != 0 || wideImpact.Documents != bound-1 || wideImpact.Total != bound || wideImpact.TooLarge {
		t.Fatalf("wide impact = %+v, want folders=0 documents=%d total=%d", wideImpact, bound-1, bound)
	}
	wideWalk := measureWalk(t, f.pool, walkParams(wideWS, wideRoot))
	if len(wideWalk.ids) != bound || wideWalk.walkRows > int(maxRows)+1 {
		t.Fatalf("wide walk ids=%d recursive-union rows=%d, want %d / <= %d", len(wideWalk.ids), wideWalk.walkRows, bound, maxRows+1)
	}
	wideCount := measureCount(t, f.pool, db.CountLiveDocumentSubtreeByKindParams{
		OrganizationID: tn.orgID, WorkspaceID: wideWS, Ids: wideWalk.ids, RootID: wideRoot,
	})
	fmt.Fprintf(&md, "## Wide shape at the bound: 1 root + %d live children\n\n", bound-1)
	fmt.Fprintf(&md, "impact %+v, end-to-end %s\n", wideImpact, wideWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "walk ids=%d recursive-union rows=%d largest heap node=%d, walk query %s, walk EXPLAIN %s\n",
		len(wideWalk.ids), wideWalk.walkRows, wideWalk.heapRows, wideWalk.queryWall.Round(time.Microsecond), wideWalk.planWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "count rows=%v, count query %s, count EXPLAIN %s\n\n", wideCount.ids, wideCount.queryWall.Round(time.Microsecond), wideCount.planWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "```\n%s\n```\n\n```\n%s\n```\n\n", wideWalk.plan, wideCount.plan)
	f.dropShape(t, wideWS)

	// Past the bound: N direct children. The walk stops after bound+1 rows, so
	// the read is flat in N; the answer carries no count.
	walls := map[int]time.Duration{}
	for _, n := range sizes {
		ws := f.newWorkspace(t, tn, fmt.Sprintf("over-%d", n))
		root := f.seedFlatTree(t, tn, ws, n)
		f.analyzeDocuments(t)
		got, wall := f.fd04Impact(t, owner, root)
		if !got.TooLarge || got.Total != 0 || got.Folders != 0 || got.Documents != 0 {
			t.Fatalf("N=%d impact = %+v, want too_large with no counts", n, got)
		}
		probe := measureWalk(t, f.pool, walkParams(ws, root))
		if len(probe.ids) != int(maxRows) || probe.walkRows > int(maxRows)+1 {
			t.Fatalf("N=%d walk ids=%d recursive-union rows=%d, want %d / <= %d", n, len(probe.ids), probe.walkRows, maxRows, maxRows+1)
		}
		if probe.heapRows > int(maxRows)+2 {
			t.Fatalf("N=%d: a node fetched %d heap rows, want <= %d (early stop)", n, probe.heapRows, maxRows+2)
		}
		walls[n] = wall
		fmt.Fprintf(&md, "## Past the bound: 1 root + %d live direct children\n\n", n)
		fmt.Fprintf(&md, "impact too_large, end-to-end %s\n", wall.Round(time.Microsecond))
		fmt.Fprintf(&md, "walk ids=%d recursive-union rows=%d largest heap node=%d, walk query %s, walk EXPLAIN %s\n\n",
			len(probe.ids), probe.walkRows, probe.heapRows, probe.queryWall.Round(time.Microsecond), probe.planWall.Round(time.Microsecond))
		fmt.Fprintf(&md, "```\n%s\n```\n\n", probe.plan)
		f.dropShape(t, ws)
	}
	// Latency flat in N: the 10^5 read must not run away from the 10^4 one.
	if small, ok := walls[sizes[0]]; ok && len(sizes) > 1 {
		big := walls[sizes[len(sizes)-1]]
		if big > 5*small+50*time.Millisecond {
			t.Fatalf("latency grew with N: %d rows %s, %d rows %s", sizes[0], small, sizes[len(sizes)-1], big)
		}
		fmt.Fprintf(&md, "Latency flat in N: %d rows %s vs %d rows %s.\n\n", sizes[0], small.Round(time.Microsecond), sizes[len(sizes)-1], big.Round(time.Microsecond))
	}

	// Deep: 20 levels x 50 children per spine node, 951 nodes - counted whole.
	const levels, fanout = 20, 50
	deepWS := f.newWorkspace(t, tn, "deep")
	deepRoot := f.seedSpineTree(t, tn, deepWS, levels, fanout)
	f.analyzeDocuments(t)
	deepImpact, deepWall := f.fd04Impact(t, owner, deepRoot)
	if deepImpact.Total != 1+(levels-1)*fanout || deepImpact.Documents != (levels-1)*fanout {
		t.Fatalf("deep impact = %+v, want %d documents and %d total", deepImpact, (levels-1)*fanout, 1+(levels-1)*fanout)
	}
	deepWalk := measureWalk(t, f.pool, walkParams(deepWS, deepRoot))
	deepCount := measureCount(t, f.pool, db.CountLiveDocumentSubtreeByKindParams{
		OrganizationID: tn.orgID, WorkspaceID: deepWS, Ids: deepWalk.ids, RootID: deepRoot,
	})
	fmt.Fprintf(&md, "## Deep shape: %d levels x %d children per spine node (%d nodes)\n\n", levels, fanout, 1+(levels-1)*fanout)
	fmt.Fprintf(&md, "impact %+v, end-to-end %s\n", deepImpact, deepWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "walk ids=%d recursive-union rows=%d largest heap node=%d, walk query %s, walk EXPLAIN %s\n",
		len(deepWalk.ids), deepWalk.walkRows, deepWalk.heapRows, deepWalk.queryWall.Round(time.Microsecond), deepWalk.planWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "count rows=%v, count query %s, count EXPLAIN %s\n\n", deepCount.ids, deepCount.queryWall.Round(time.Microsecond), deepCount.planWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "```\n%s\n```\n\n```\n%s\n```\n\n", deepWalk.plan, deepCount.plan)
	f.dropShape(t, deepWS)

	// Workspace-dominant: one workspace holds the bulk of the table (a sibling
	// folder's children) plus a 951-node 20-level spine, the layout the FD-03
	// review measured at 11 s before the non-partial index existed. The walk is
	// the statement both archive and archive-impact send, so this is the
	// archive walk's plan on the shape that broke it.
	domSizes := []int{1000000}
	if raw := os.Getenv("FD04_EXPLAIN_DOMINANT_SIZES"); raw != "" {
		domSizes = nil
		for _, part := range strings.Split(raw, ",") {
			n, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				t.Fatalf("FD04_EXPLAIN_DOMINANT_SIZES: %v", err)
			}
			domSizes = append(domSizes, n)
		}
	}
	for _, n := range domSizes {
		domWS := f.newWorkspace(t, tn, fmt.Sprintf("dominant-%d", n))
		// The workspace's bulk: sibling folders with n live children between
		// them, so the walk's per-level lookup has n rows to look through.
		// Several parents, not one: a workspace whose million rows hang off a
		// single folder is not a product shape, and its skewed parent_id
		// statistics would measure the statistics, not the index.
		bulkFolders := 200
		for i := 0; i < bulkFolders; i++ {
			f.seedFlatTree(t, tn, domWS, n/bulkFolders)
		}
		domRoot := f.seedSpineTree(t, tn, domWS, levels, fanout)
		f.analyzeDocuments(t)
		domImpact, domWall := f.fd04Impact(t, owner, domRoot)
		if domImpact.Total != 1+(levels-1)*fanout || domImpact.TooLarge {
			t.Fatalf("dominant impact = %+v, want %d total and not too_large", domImpact, 1+(levels-1)*fanout)
		}
		domWalk := measureWalk(t, f.pool, walkParams(domWS, domRoot))
		if len(domWalk.ids) != 1+(levels-1)*fanout {
			t.Fatalf("dominant walk returned %d ids, want %d", len(domWalk.ids), 1+(levels-1)*fanout)
		}
		assertWalkUsesTheParentAllIndex(t, domWalk)
		if domWalk.queryWall >= time.Second {
			t.Fatalf("dominant walk took %s (>= 1s) on a %d-row workspace; idx_documents_ws_parent_all should serve it:\n%s",
				domWalk.queryWall, n, domWalk.plan)
		}
		if domWall >= 3*time.Second {
			t.Fatalf("dominant end-to-end archive-impact took %s (>= 3s) on a %d-row workspace:\n%s",
				domWall, n, domWalk.plan)
		}
		domCount := measureCount(t, f.pool, db.CountLiveDocumentSubtreeByKindParams{
			OrganizationID: tn.orgID, WorkspaceID: domWS, Ids: domWalk.ids, RootID: domRoot,
		})
		fmt.Fprintf(&md, "## Workspace-dominant: 1 workspace with %d bulk rows + a %d-node %d-level spine\n\n", n, 1+(levels-1)*fanout, levels)
		fmt.Fprintf(&md, "impact %+v, end-to-end %s\n", domImpact, domWall.Round(time.Microsecond))
		fmt.Fprintf(&md, "walk ids=%d recursive-union rows=%d largest heap node=%d, walk query %s, walk EXPLAIN %s\n",
			len(domWalk.ids), domWalk.walkRows, domWalk.heapRows, domWalk.queryWall.Round(time.Microsecond), domWalk.planWall.Round(time.Microsecond))
		fmt.Fprintf(&md, "count rows=%v, count query %s, count EXPLAIN %s\n\n", domCount.ids, domCount.queryWall.Round(time.Microsecond), domCount.planWall.Round(time.Microsecond))
		fmt.Fprintf(&md, "```\n%s\n```\n\n```\n%s\n```\n\n", domWalk.plan, domCount.plan)
		f.dropShape(t, domWS)
	}

	if path := os.Getenv("FD04_EXPLAIN_REPORT"); path != "" {
		if err := os.WriteFile(path, []byte(md.String()), 0o644); err != nil {
			t.Fatalf("write report: %v", err)
		}
		t.Logf("evidence written to %s", path)
	} else {
		t.Log(md.String())
	}
}
