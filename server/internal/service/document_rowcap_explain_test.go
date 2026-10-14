package service

// FD-03 (UNI-1463, addendum §3.2 r2) row-cap evidence: ListLiveDocumentSubtreeIDs
// must stop the walk after archiveBound()+1 live rows instead of walking the
// whole subtree and sorting it. The test is gated behind FD03_EXPLAIN=1
// because it seeds 10^5/10^6 rows; the default suite skips it.
//
// It EXPLAINs the exact statement the generated query sends: a recording DBTX
// captures the SQL and the arguments from the real call, and the plan runs
// with those same arguments. FD03_EXPLAIN_REPORT names a file the markdown
// evidence is written to (the run report the lead reads).
//
// Each shape is seeded into its own workspace: a workspace holding every seed
// at once is a layout no product data has, and the planner would measure that
// layout, not the shape.

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// sqlCapture wraps a DBTX and remembers the last statement and arguments, so
// the evidence test EXPLAINs exactly what the generated code executed.
type sqlCapture struct {
	db.DBTX
	mu   sync.Mutex
	sql  string
	args []any
}

func (c *sqlCapture) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.mu.Lock()
	c.sql, c.args = sql, append([]any(nil), args...)
	c.mu.Unlock()
	return c.DBTX.Query(ctx, sql, args...)
}

func (c *sqlCapture) last() (string, []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sql, c.args
}

// planNode is one EXPLAIN line carrying its actual row count.
type planNode struct {
	text string
	rows int
}

var planRowRe = regexp.MustCompile(`^(.*)\(actual time=[0-9.]+\.\.[0-9.]+ rows=([0-9]+) loops=[0-9]+\)`)

func parsePlanNodes(lines []string) []planNode {
	var out []planNode
	for _, line := range lines {
		m := planRowRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[2])
		if err != nil {
			continue
		}
		out = append(out, planNode{text: strings.TrimSpace(m[1]), rows: n})
	}
	return out
}

// walkProbe is one measurement: the ids the walk returned, the statement the
// generated query sent and the EXPLAIN of that statement.
type walkProbe struct {
	ids       []string
	queryWall time.Duration
	plan      string
	planWall  time.Duration
	walkRows  int
	heapRows  int
	indexRows int
}

// measureWalk runs the generated query through a recording DBTX and then
// EXPLAINs the captured statement with the captured arguments. Both calls are
// time-boxed: a plan that degenerates must fail the evidence run loudly
// instead of holding a connection.
func measureWalk(t *testing.T, pool *pgxpool.Pool, params db.ListLiveDocumentSubtreeIDsParams) walkProbe {
	t.Helper()
	capture := &sqlCapture{DBTX: pool}
	q := db.New(capture)
	queryCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	start := time.Now()
	ids, err := q.ListLiveDocumentSubtreeIDs(queryCtx, params)
	if err != nil {
		t.Fatalf("ListLiveDocumentSubtreeIDs: %v", err)
	}
	probe := walkProbe{ids: ids, queryWall: time.Since(start)}
	sqlText, args := capture.last()
	if sqlText == "" {
		t.Fatal("the generated query did not reach the recording DBTX")
	}
	explainCtx, cancelExplain := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancelExplain()
	start = time.Now()
	rows, err := pool.Query(explainCtx, "EXPLAIN (ANALYZE, BUFFERS) "+sqlText, args...)
	if err != nil {
		t.Fatalf("EXPLAIN: %v", err)
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
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	probe.planWall = time.Since(start)
	probe.plan = strings.Join(lines, "\n")
	for _, node := range parsePlanNodes(lines) {
		switch {
		case strings.Contains(node.text, "Recursive Union"):
			probe.walkRows = node.rows
		case strings.Contains(node.text, "Bitmap Index Scan"):
			probe.indexRows += node.rows
		case strings.Contains(node.text, "Seq Scan"), strings.Contains(node.text, "Bitmap Heap Scan"),
			strings.Contains(node.text, "Index Scan") && !strings.Contains(node.text, "Index Only Scan"):
			if node.rows > probe.heapRows {
				probe.heapRows = node.rows
			}
		}
	}
	return probe
}

// newWorkspace adds one workspace to the fixture's organization, so each
// measured shape can live in a workspace of its own.
func (f *docPermFixture) newWorkspace(t *testing.T, tn docTenant, label string) string {
	t.Helper()
	w, err := f.svc.ws.CreateInOrg(f.ctx, tn.owner.ID, tn.orgID, "FD03 "+label, "fd03"+strings.ToLower(util.NewID()[19:]))
	if err != nil {
		t.Fatalf("create workspace %s: %v", label, err)
	}
	return w.ID
}

// liftWorkspaceQuota raises the plan's workspace cap (the default plan allows
// two) so the evidence can give each shape its own workspace.
func (f *docPermFixture) liftWorkspaceQuota(t *testing.T, orgID string, n int) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `
		UPDATE subscriptions
		SET overrides = jsonb_set(COALESCE(overrides, '{}'::jsonb), '{workspaces.max}', to_jsonb($2::bigint))
		WHERE organization_id = $1`, orgID, n); err != nil {
		t.Fatalf("lift the workspace quota: %v", err)
	}
}

// archiveCommand runs the archive command and returns its answer and wall
// time; the caller asserts the answer.
func (f *docPermFixture) archiveCommand(t *testing.T, tn docTenant, root string) (int, time.Duration, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	start := time.Now()
	res, err := f.svc.ArchiveDocument(ctx, Human(tn.owner.ID), root, ArchiveDocumentInput{})
	wall := time.Since(start)
	if err != nil {
		return 0, wall, err
	}
	return len(res.Affected), wall, nil
}

// seedFlatTree inserts a live folder root plus n live direct children: the
// shape a "folder with N items" degenerates into.
func (f *docPermFixture) seedFlatTree(t *testing.T, tn docTenant, ws string, n int) string {
	t.Helper()
	root := util.NewID()
	insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": root, "organization_id": tn.orgID, "workspace_id": ws,
		"kind": "folder", "title": "Nguồn", "acl_owner_id": tn.aclOwner.ID,
		"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
	}))
	f.seedChildren(t, tn, ws, root, n, false)
	return root
}

// seedChildren bulk-inserts n live or archived pages under one parent.
func (f *docPermFixture) seedChildren(t *testing.T, tn docTenant, ws, parent string, n int, archived bool) {
	t.Helper()
	_, err := f.pool.Exec(f.ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, parent_id, kind, title, visibility,
			created_by, created_by_kind, updated_by, updated_by_kind, archived_at, archived_by, purge_after)
		SELECT 'fd03' || $3 || lpad(i::text, 10, '0'), $1, $2, $3, 'page', 'con ' || i,
			'workspace', $4, 'human', $4, 'human',
			CASE WHEN $5 THEN now() ELSE NULL END,
			CASE WHEN $5 THEN $4::text ELSE NULL END,
			CASE WHEN $5 THEN now() + interval '30 days' ELSE NULL END
		FROM generate_series(1, $6::int) AS i`,
		tn.orgID, ws, parent, tn.aclOwner.ID, archived, n)
	if err != nil {
		t.Fatalf("seed %d children of %s: %v", n, parent, err)
	}
}

// analyzeDocuments keeps the planner's statistics in step with the bulk seed;
// a plan measured on stale statistics is not the plan production gets.
func (f *docPermFixture) analyzeDocuments(t *testing.T) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, "ANALYZE documents"); err != nil {
		t.Fatalf("analyze documents: %v", err)
	}
}

// dropShape removes one shape's rows after it was measured, so the next shape
// is measured in a table of its own size, not one grown by the previous N.
// The vacuum matters: without it the next plan reads the million dead tuples
// the delete left behind and measures the delete, not the shape.
func (f *docPermFixture) dropShape(t *testing.T, ws string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, "DELETE FROM documents WHERE workspace_id = $1", ws); err != nil {
		t.Fatalf("drop shape %s: %v", ws, err)
	}
	if _, err := f.pool.Exec(f.ctx, "VACUUM (ANALYZE, PARALLEL 0) documents"); err != nil {
		t.Fatalf("vacuum after dropping %s: %v", ws, err)
	}
}

// seedSpineTree inserts a tree of `levels` levels with `fanout` children per
// spine node (the first child continues the spine): (levels-1)*fanout + 1 nodes.
func (f *docPermFixture) seedSpineTree(t *testing.T, tn docTenant, ws string, levels, fanout int) string {
	t.Helper()
	root := util.NewID()
	insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": root, "organization_id": tn.orgID, "workspace_id": ws,
		"kind": "folder", "title": "Trục", "acl_owner_id": tn.aclOwner.ID,
		"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
	}))
	spine := root
	for lvl := 2; lvl <= levels; lvl++ {
		rows, err := f.pool.Query(f.ctx, `
			INSERT INTO documents (id, organization_id, workspace_id, parent_id, kind, title, visibility,
				created_by, created_by_kind, updated_by, updated_by_kind)
			SELECT $3 || lpad(g::text, 2, '0') || lpad($4::text, 2, '0'), $1, $2, $3, 'page', 'muc',
				'workspace', $5, 'human', $5, 'human'
			FROM generate_series(1, $6::int) AS g
			RETURNING id`, tn.orgID, ws, spine, strconv.Itoa(lvl), tn.aclOwner.ID, fanout)
		if err != nil {
			t.Fatalf("seed level %d: %v", lvl, err)
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		spine = ids[0]
	}
	return root
}

// seedArchivedPath inserts a live root, a chain of archived folders with a
// live page under the deepest one, and archived siblings at the root: the
// walk must traverse every archived node to reach the live child.
func (f *docPermFixture) seedArchivedPath(t *testing.T, tn docTenant, ws string, depth, siblings int) (root, live string) {
	t.Helper()
	root = util.NewID()
	insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": root, "organization_id": tn.orgID, "workspace_id": ws,
		"kind": "folder", "title": "Gốc", "acl_owner_id": tn.aclOwner.ID,
		"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
	}))
	f.seedChildren(t, tn, ws, root, siblings, true)
	parent := root
	for i := 0; i < depth; i++ {
		id := util.NewID()
		insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
			"id": id, "organization_id": tn.orgID, "workspace_id": ws, "parent_id": parent,
			"kind": "folder", "title": fmt.Sprintf("Lưu trữ %d", i), "acl_owner_id": tn.aclOwner.ID,
			"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
			"archived_at": time.Now(), "archived_by": tn.aclOwner.ID,
			"purge_after": time.Now().Add(30 * 24 * time.Hour),
		}))
		parent = id
	}
	live = util.NewID()
	insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": live, "organization_id": tn.orgID, "workspace_id": ws, "parent_id": parent,
		"kind": "page", "title": "Còn sống", "acl_owner_id": tn.aclOwner.ID,
		"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
	}))
	return root, live
}

func TestFD03RowCapEvidence(t *testing.T) {
	if os.Getenv("FD03_EXPLAIN") != "1" {
		t.Skip("set FD03_EXPLAIN=1 to run the FD-03 row-cap evidence (seeds 10^5+ rows)")
	}
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fd03cap")
	f.liftWorkspaceQuota(t, tn.orgID, 16)
	bound := f.svc.archiveBound()
	maxRows := int32(bound + 1)
	params := func(ws, root string) db.ListLiveDocumentSubtreeIDsParams {
		return db.ListLiveDocumentSubtreeIDsParams{
			OrganizationID: tn.orgID, WorkspaceID: ws, RootID: root,
			MaxRows: maxRows, MaxLevel: subtreeMaxLevel(),
		}
	}

	sizes := []int{100000, 1000000}
	if raw := os.Getenv("FD03_EXPLAIN_SIZES"); raw != "" {
		sizes = nil
		for _, part := range strings.Split(raw, ",") {
			n, err := strconv.Atoi(strings.TrimSpace(part))
			if err != nil {
				t.Fatalf("FD03_EXPLAIN_SIZES: %v", err)
			}
			sizes = append(sizes, n)
		}
	}

	var md strings.Builder
	fmt.Fprintf(&md, "# FD-03 EXPLAIN evidence - ListLiveDocumentSubtreeIDs row cap\n\n")
	fmt.Fprintf(&md, "archiveBound() = %d, max_rows = %d, max_level = %d (2*maxDocumentDepth).\n", bound, maxRows, subtreeMaxLevel())
	fmt.Fprintf(&md, "Every measurement runs the statement the generated code sends: a recording DBTX captures the SQL and its arguments.\n")
	fmt.Fprintf(&md, "Each shape is seeded into its own workspace, and documents is analyzed after each seed.\n\n")

	// The wide shape: one root with N live direct children. Reads must stop at
	// the cap, not walk N.
	for _, n := range sizes {
		ws := f.newWorkspace(t, tn, fmt.Sprintf("wide-%d", n))
		root := f.seedFlatTree(t, tn, ws, n)
		f.analyzeDocuments(t)
		probe := measureWalk(t, f.pool, params(ws, root))
		if len(probe.ids) != int(maxRows) {
			t.Fatalf("N=%d: walk returned %d ids, want %d", n, len(probe.ids), maxRows)
		}
		if probe.walkRows > int(maxRows)+1 {
			t.Fatalf("N=%d: the recursive walk read %d rows, want <= %d (early stop)", n, probe.walkRows, maxRows+1)
		}
		if probe.heapRows > int(maxRows)+2 {
			t.Fatalf("N=%d: a node fetched %d heap rows, want <= %d (early stop)", n, probe.heapRows, maxRows+2)
		}
		affected, wall, err := f.archiveCommand(t, tn, root)
		wantCode(t, err, "folder_too_large")
		if affected != 0 {
			t.Fatalf("N=%d: the refusal touched %d rows, want 0", n, affected)
		}
		fmt.Fprintf(&md, "## Wide shape: 1 root + %d live children\n\n", n)
		fmt.Fprintf(&md, "walk ids=%d, recursive-union rows=%d, largest heap node=%d, bitmap index rows=%d\n",
			len(probe.ids), probe.walkRows, probe.heapRows, probe.indexRows)
		fmt.Fprintf(&md, "query %s, EXPLAIN (ANALYZE, BUFFERS) %s, archive command (refusal) %s\n\n",
			probe.queryWall.Round(time.Microsecond), probe.planWall.Round(time.Microsecond), wall.Round(time.Microsecond))
		fmt.Fprintf(&md, "```\n%s\n```\n\n", probe.plan)
		f.dropShape(t, ws)
	}

	// The deep shape: 20 levels x fanout, about a thousand nodes.
	const levels, fanout = 20, 50
	deepWS := f.newWorkspace(t, tn, "deep")
	deepRoot := f.seedSpineTree(t, tn, deepWS, levels, fanout)
	f.analyzeDocuments(t)
	deepProbe := measureWalk(t, f.pool, params(deepWS, deepRoot))
	if deepProbe.walkRows > int(maxRows)+1 {
		t.Fatalf("deep tree: the recursive walk read %d rows, want <= %d", deepProbe.walkRows, maxRows+1)
	}
	if deepProbe.heapRows > int(maxRows)+2 {
		t.Fatalf("deep tree: a node fetched %d heap rows, want <= %d", deepProbe.heapRows, maxRows+2)
	}
	// The tree sits inside the bound, so the command archives it whole: the
	// cost of a full 20-level archive, not just its walk.
	deepAffected, deepWall, err := f.archiveCommand(t, tn, deepRoot)
	if err != nil || deepAffected != 1+(levels-1)*fanout {
		t.Fatalf("deep tree archive = %d rows, %v", deepAffected, err)
	}
	fmt.Fprintf(&md, "## Deep shape: %d levels x %d children per spine node (%d nodes)\n\n", levels, fanout, 1+(levels-1)*fanout)
	fmt.Fprintf(&md, "walk ids=%d, recursive-union rows=%d, largest heap node=%d\n", len(deepProbe.ids), deepProbe.walkRows, deepProbe.heapRows)
	fmt.Fprintf(&md, "query %s, EXPLAIN (ANALYZE, BUFFERS) %s, archive command (951 rows archived) %s\n\n",
		deepProbe.queryWall.Round(time.Microsecond), deepProbe.planWall.Round(time.Microsecond), deepWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "```\n%s\n```\n\n", deepProbe.plan)
	f.dropShape(t, deepWS)

	// Many archived nodes on the path: the walk has to traverse them (they are
	// the way to the live child), so their count is the cost - it is the path,
	// not the tree, and the live cap stays intact.
	archWS := f.newWorkspace(t, tn, "archived-path")
	archRoot, liveID := f.seedArchivedPath(t, tn, archWS, 20, 100000)
	f.analyzeDocuments(t)
	archProbe := measureWalk(t, f.pool, params(archWS, archRoot))
	var foundLive bool
	for _, id := range archProbe.ids {
		if id == liveID {
			foundLive = true
		}
	}
	if !foundLive || len(archProbe.ids) != 2 {
		t.Fatalf("archived path: walk returned %d ids (live child present=%v), want the 2 live rows", len(archProbe.ids), foundLive)
	}
	archAffected, archWall, err := f.archiveCommand(t, tn, archRoot)
	if err != nil || archAffected != 2 {
		t.Fatalf("archived path: the command touched %d rows, %v", archAffected, err)
	}
	fmt.Fprintf(&md, "## Archived nodes on the path: 1 root + 100000 archived siblings + 20 archived ancestors + 1 live leaf\n\n")
	fmt.Fprintf(&md, "walk ids=%d (the live child was reached), recursive-union rows=%d, largest heap node=%d\n",
		len(archProbe.ids), archProbe.walkRows, archProbe.heapRows)
	fmt.Fprintf(&md, "query %s, EXPLAIN (ANALYZE, BUFFERS) %s, archive command (2 rows archived) %s\n\n",
		archProbe.queryWall.Round(time.Microsecond), archProbe.planWall.Round(time.Microsecond), archWall.Round(time.Microsecond))
	fmt.Fprintf(&md, "```\n%s\n```\n\n", archProbe.plan)

	if path := os.Getenv("FD03_EXPLAIN_REPORT"); path != "" {
		if err := os.WriteFile(path, []byte(md.String()), 0o644); err != nil {
			t.Fatalf("write report: %v", err)
		}
		t.Logf("evidence written to %s", path)
	} else {
		t.Log(md.String())
	}
}
