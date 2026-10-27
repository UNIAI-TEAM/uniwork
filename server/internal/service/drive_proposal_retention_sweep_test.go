package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	dbtestutil "github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type driveProposalPurgeMetricsSpy struct {
	mu     sync.Mutex
	purged int64
	calls  []int64
}

func (s *driveProposalPurgeMetricsSpy) ObserveTaskProposalsPurged(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purged += n
	s.calls = append(s.calls, n)
}

func (s *driveProposalPurgeMetricsSpy) total() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.purged
}

func (s *driveProposalPurgeMetricsSpy) snapshotCalls() []int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]int64, len(s.calls))
	copy(out, s.calls)
	return out
}

func clearDriveProposalRetentionTables(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	for _, table := range []string{"drive_task_proposals", "drive_task_proposal_links"} {
		if _, err := pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %s`, table)); err != nil {
			t.Fatalf("clear %s: %v", table, err)
		}
	}
}

func seedDriveProposalRow(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	id, orgID, wsID, status string,
	expiresAt time.Time,
	withItems bool,
) {
	t.Helper()
	var items []byte
	if withItems {
		items = []byte(`[{"index":0,"title":"Task","excerpt":{"section":"S1","quote":"Sensitive excerpt"}}]`)
	}
	var statusChangedAt any
	if status != DriveProposalStatusReady {
		statusChangedAt = expiresAt.Add(-time.Hour)
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO drive_task_proposals (
			id, organization_id, workspace_id, drive_file_id, connection_id,
			requested_by, requested_by_kind, prompt, items, truncated,
			usage_event_id, status, status_changed_at, created_at, expires_at
		) VALUES (
			$1, $2, $3, 'df-1', 'dc-1',
			'u-1', 'human', '', $4, false,
			'ue-1', $5, $6, $7, $8
		)
	`, id, orgID, wsID, items, status, statusChangedAt, expiresAt.Add(-driveProposalTTL), expiresAt)
	if err != nil {
		t.Fatalf("insert proposal %s: %v", id, err)
	}
}

func seedDriveProposalLinkRow(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	id, orgID, wsID, proposalID string,
	itemIndex int,
	taskID string,
) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO drive_task_proposal_links (
			id, organization_id, workspace_id, proposal_id, item_index,
			task_id, drive_file_id, external_file_id, created_by, created_by_kind
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, 'df-1', 'ext-1', 'u-1', 'human'
		)
	`, id, orgID, wsID, proposalID, itemIndex, taskID)
	if err != nil {
		t.Fatalf("insert proposal link %s: %v", id, err)
	}
}

func driveProposalRowExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table, id string) bool {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE id = $1`, table), id).Scan(&n); err != nil {
		t.Fatalf("check %s %s: %v", table, id, err)
	}
	return n == 1
}

// TestDriveProposalRetentionSweepStatesAndLinks verifies that the sweep deletes
// expired ready rows, converted rows, and discarded rows across organizations,
// preserves unexpired ready rows, leaves drive_task_proposal_links untouched,
// increments drive_task_proposals_purged_total, and writes no audit row.
func TestDriveProposalRetentionSweepStatesAndLinks(t *testing.T) {
	pool := dbtestutil.DB(t)
	ctx := context.Background()
	clearDriveProposalRetentionTables(t, ctx, pool)

	now := time.Now().UTC().Truncate(time.Microsecond)
	expired := now.Add(-time.Hour)
	future := now.Add(6 * 24 * time.Hour)
	nearFuture := now.Add(time.Minute)

	seedDriveProposalRow(t, ctx, pool, "p-exp", "org-1", "ws-1", DriveProposalStatusReady, expired, true)
	seedDriveProposalRow(t, ctx, pool, "p-conv", "org-1", "ws-1", DriveProposalStatusConverted, future, false)
	seedDriveProposalRow(t, ctx, pool, "p-disc", "org-1", "ws-1", DriveProposalStatusDiscarded, future, false)
	seedDriveProposalRow(t, ctx, pool, "p-org2", "org-2", "ws-2", DriveProposalStatusReady, expired, true)
	seedDriveProposalRow(t, ctx, pool, "p-ready-1", "org-1", "ws-1", DriveProposalStatusReady, future, true)
	seedDriveProposalRow(t, ctx, pool, "p-ready-2", "org-2", "ws-2", DriveProposalStatusReady, nearFuture, true)

	seedDriveProposalLinkRow(t, ctx, pool, "lnk-1", "org-1", "ws-1", "p-conv", 0, "t-1")
	seedDriveProposalLinkRow(t, ctx, pool, "lnk-2", "org-1", "ws-1", "p-exp", 1, "t-2")

	q := db.New(pool)
	propSvc := NewDriveTaskProposalService(pool, q, nil, nil, nil, nil, nil)
	spy := &driveProposalPurgeMetricsSpy{}
	sweeper := NewDriveProposalRetentionSweeper(propSvc, nil)
	sweeper.SetClock(func() time.Time { return now })
	sweeper.SetMetrics(spy)

	n, err := sweeper.Sweep(ctx)
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n != 4 {
		t.Fatalf("swept %d rows, want 4 (expired ready + converted + discarded + other-org expired)", n)
	}
	if got := spy.total(); got != 4 {
		t.Fatalf("spy purged = %d, want 4", got)
	}

	for _, id := range []string{"p-exp", "p-conv", "p-disc", "p-org2"} {
		if driveProposalRowExists(t, ctx, pool, "drive_task_proposals", id) {
			t.Fatalf("proposal %s survived sweep", id)
		}
	}
	for _, id := range []string{"p-ready-1", "p-ready-2"} {
		if !driveProposalRowExists(t, ctx, pool, "drive_task_proposals", id) {
			t.Fatalf("unexpired ready proposal %s was deleted", id)
		}
	}
	for _, id := range []string{"lnk-1", "lnk-2"} {
		if !driveProposalRowExists(t, ctx, pool, "drive_task_proposal_links", id) {
			t.Fatalf("provenance link %s was deleted", id)
		}
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE resource_type = 'drive_task_proposal'`).Scan(&auditCount); err != nil {
		t.Fatalf("count audit_events: %v", err)
	}
	if auditCount != 0 {
		t.Fatalf("audit_events count = %d, want 0 (retention sweep writes no audit row)", auditCount)
	}
}

// TestDriveProposalRetentionSweepConcurrentSkipLocked verifies that two
// concurrent sweepers split the work via FOR UPDATE SKIP LOCKED without
// blocking on each other's uncommitted batch or deleting the same row twice.
func TestDriveProposalRetentionSweepConcurrentSkipLocked(t *testing.T) {
	pool := dbtestutil.DB(t)
	ctx := context.Background()
	clearDriveProposalRetentionTables(t, ctx, pool)

	now := time.Now().UTC().Truncate(time.Microsecond)
	expired := now.Add(-2 * time.Hour)
	future := now.Add(5 * 24 * time.Hour)

	const totalPurgeable = 600
	for i := range totalPurgeable {
		id := fmt.Sprintf("p-c-%03d", i)
		seedDriveProposalRow(t, ctx, pool, id, "org-1", "ws-1", DriveProposalStatusReady, expired.Add(time.Duration(i)*time.Second), false)
	}
	seedDriveProposalRow(t, ctx, pool, "p-c-keep", "org-1", "ws-1", DriveProposalStatusReady, future, true)

	q := db.New(pool)
	propSvc := NewDriveTaskProposalService(pool, q, nil, nil, nil, nil, nil)
	spy := &driveProposalPurgeMetricsSpy{}

	w1 := NewDriveProposalRetentionSweeper(propSvc, nil)
	w1.SetClock(func() time.Time { return now })
	w1.SetMetrics(spy)

	w2 := NewDriveProposalRetentionSweeper(propSvc, nil)
	w2.SetClock(func() time.Time { return now })
	w2.SetMetrics(spy)

	round1Locked := make(chan struct{})
	releaseRound1 := make(chan struct{})
	var once sync.Once
	w1.testBeforeRoundCommit = func(round int, deleted int64) {
		if round == 0 && deleted == int64(DriveProposalRetentionSweepBatch) {
			once.Do(func() {
				close(round1Locked)
				<-releaseRound1
			})
		}
	}

	var (
		n1, n2     int64
		err1, err2 error
		wg         sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		n1, err1 = w1.Sweep(ctx)
	}()

	// Wait until w1 has locked and deleted its first 500-row batch inside its
	// open transaction before committing.
	select {
	case <-round1Locked:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for w1 round 0 lock")
	}

	// While w1 holds locks on the first 500 rows, w2 must skip them via
	// SKIP LOCKED, delete the remaining 100 rows, and finish without blocking.
	w2Ctx, cancelW2 := context.WithTimeout(ctx, 5*time.Second)
	defer cancelW2()
	n2, err2 = w2.Sweep(w2Ctx)
	close(releaseRound1)
	wg.Wait()

	if err1 != nil {
		t.Fatalf("w1.Sweep: %v", err1)
	}
	if err2 != nil {
		t.Fatalf("w2.Sweep (concurrent under held locks): %v", err2)
	}
	if n1 != 500 || n2 != 100 {
		t.Fatalf("concurrent sweep counts = (w1=%d, w2=%d), want (500, 100)", n1, n2)
	}
	if n1+n2 != totalPurgeable {
		t.Fatalf("combined deleted = %d, want %d", n1+n2, totalPurgeable)
	}
	if got := spy.total(); got != totalPurgeable {
		t.Fatalf("metric purged total = %d, want %d", got, totalPurgeable)
	}

	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM drive_task_proposals`).Scan(&remaining); err != nil {
		t.Fatalf("count remaining: %v", err)
	}
	if remaining != 1 || !driveProposalRowExists(t, ctx, pool, "drive_task_proposals", "p-c-keep") {
		t.Fatalf("remaining proposals = %d, want only p-c-keep", remaining)
	}
}

// TestDriveProposalRetentionSweepMultiRoundOver500 verifies that a backlog of
// more than 500 purgeable rows is deleted across multiple 500-row rounds (one
// transaction per round) until a round deletes fewer than 500 rows.
func TestDriveProposalRetentionSweepMultiRoundOver500(t *testing.T) {
	pool := dbtestutil.DB(t)
	ctx := context.Background()
	clearDriveProposalRetentionTables(t, ctx, pool)

	now := time.Now().UTC().Truncate(time.Microsecond)
	expired := now.Add(-3 * time.Hour)
	future := now.Add(4 * 24 * time.Hour)

	const totalPurgeable = 1205
	for i := range totalPurgeable {
		status := DriveProposalStatusReady
		exp := expired.Add(time.Duration(i) * time.Second)
		if i%3 == 1 {
			status = DriveProposalStatusConverted
			exp = future
		} else if i%3 == 2 {
			status = DriveProposalStatusDiscarded
			exp = future
		}
		seedDriveProposalRow(t, ctx, pool, fmt.Sprintf("p-m-%04d", i), "org-1", "ws-1", status, exp, false)
	}
	seedDriveProposalRow(t, ctx, pool, "p-m-keep-1", "org-1", "ws-1", DriveProposalStatusReady, future, true)
	seedDriveProposalRow(t, ctx, pool, "p-m-keep-2", "org-1", "ws-1", DriveProposalStatusReady, future, true)
	seedDriveProposalLinkRow(t, ctx, pool, "lnk-m-1", "org-1", "ws-1", "p-m-0001", 0, "t-m-1")

	q := db.New(pool)
	propSvc := NewDriveTaskProposalService(pool, q, nil, nil, nil, nil, nil)
	spy := &driveProposalPurgeMetricsSpy{}
	propSvc.SetMetrics(&combinedDriveProposalMetricsSpy{purge: spy})

	w := propSvc.NewRetentionSweeper()
	w.SetClock(func() time.Time { return now })
	var roundCounts []int64
	w.testBeforeRoundCommit = func(_ int, deleted int64) {
		roundCounts = append(roundCounts, deleted)
	}

	total, err := w.Sweep(ctx)
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if total != totalPurgeable {
		t.Fatalf("total purged = %d, want %d", total, totalPurgeable)
	}
	wantRounds := []int64{500, 500, 205}
	if len(roundCounts) != len(wantRounds) {
		t.Fatalf("round counts = %v, want %v", roundCounts, wantRounds)
	}
	for i, want := range wantRounds {
		if roundCounts[i] != want {
			t.Fatalf("round %d deleted = %d, want %d (all rounds: %v)", i, roundCounts[i], want, roundCounts)
		}
	}
	if got := spy.total(); got != totalPurgeable {
		t.Fatalf("metric total = %d, want %d", got, totalPurgeable)
	}

	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM drive_task_proposals`).Scan(&remaining); err != nil {
		t.Fatalf("count remaining proposals: %v", err)
	}
	if remaining != 2 {
		t.Fatalf("remaining proposals = %d, want 2", remaining)
	}
	if !driveProposalRowExists(t, ctx, pool, "drive_task_proposal_links", "lnk-m-1") {
		t.Fatal("provenance link lnk-m-1 was deleted")
	}
}

type combinedDriveProposalMetricsSpy struct {
	purge *driveProposalPurgeMetricsSpy
}

func (c *combinedDriveProposalMetricsSpy) ObserveTaskProposal(string) {}
func (c *combinedDriveProposalMetricsSpy) ObserveTaskProposalsPurged(n int64) {
	if c.purge != nil {
		c.purge.ObserveTaskProposalsPurged(n)
	}
}

type fakeProposalSweepDBTX struct {
	mu      sync.Mutex
	batches []int64
	queries []string
	limits  []int32
}

func (f *fakeProposalSweepDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, sql)
	if len(args) >= 2 {
		if lim, ok := args[1].(int32); ok {
			f.limits = append(f.limits, lim)
		}
	}
	var n int64
	if len(f.batches) > 0 {
		n = f.batches[0]
		f.batches = f.batches[1:]
	}
	return pgconn.NewCommandTag(fmt.Sprintf("DELETE %d", n)), nil
}

func (f *fakeProposalSweepDBTX) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, nil
}

func (f *fakeProposalSweepDBTX) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

// TestDriveProposalRetentionSweeperUnitMultiRoundAndMetric verifies the
// multi-round batch loop, SQL shape (FOR UPDATE SKIP LOCKED, LIMIT 500, never
// referencing drive_task_proposal_links), Run shutdown on context cancellation,
// and Prometheus registration of drive_task_proposals_purged_total.
func TestDriveProposalRetentionSweeperUnitMultiRoundAndMetric(t *testing.T) {
	t.Parallel()

	fakeDB := &fakeProposalSweepDBTX{
		batches: []int64{500, 500, 120},
	}
	propSvc := &DriveTaskProposalService{
		q: db.New(fakeDB),
	}
	spy := &driveProposalPurgeMetricsSpy{}
	sweeper := NewDriveProposalRetentionSweeper(propSvc, nil)
	sweeper.SetMetrics(spy)

	ctx, cancel := context.WithCancel(context.Background())
	sweeper.interval = time.Hour
	done := make(chan struct{})
	go func() {
		sweeper.Run(ctx)
		close(done)
	}()

	// Wait until all 3 rounds of the initial pass have run, then cancel ctx.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		fakeDB.mu.Lock()
		nCalls := len(fakeDB.queries)
		fakeDB.mu.Unlock()
		if nCalls == 3 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("sweeper.Run did not stop after ctx cancel")
	}

	fakeDB.mu.Lock()
	defer fakeDB.mu.Unlock()
	if len(fakeDB.queries) != 3 {
		t.Fatalf("executed %d rounds, want 3 (500 + 500 + 120)", len(fakeDB.queries))
	}
	for i, lim := range fakeDB.limits {
		if lim != 500 {
			t.Fatalf("round %d batch_limit = %d, want 500", i, lim)
		}
	}
	for i, q := range fakeDB.queries {
		if !strings.Contains(q, "FOR UPDATE SKIP LOCKED") {
			t.Fatalf("round %d query missing FOR UPDATE SKIP LOCKED: %s", i, q)
		}
		if strings.Contains(q, "drive_task_proposal_links") {
			t.Fatalf("round %d query touched drive_task_proposal_links: %s", i, q)
		}
	}
	if got := spy.total(); got != 1120 {
		t.Fatalf("purged total = %d, want 1120", got)
	}
	if calls := spy.snapshotCalls(); len(calls) != 3 || calls[0] != 500 || calls[1] != 500 || calls[2] != 120 {
		t.Fatalf("metric calls per round = %v, want [500 500 120]", calls)
	}
}
