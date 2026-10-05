package outbox

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Lane is a class of outbox work with its own claim loop. Every topic belongs
// to exactly one lane, so a lane only ever claims its own rows: a backlog of
// LiveKit calls or LLM summaries cannot sit in front of a join_request.approved
// frame, because the realtime lane never claims those rows to begin with.
//
// A row is still one unit of delivery state (status, attempts, lease, dead
// letter all live on outbox_events). A topic read by consumers registered on
// different lanes runs on the slowest of them, and the row's consumers run side
// by side, so the fast consumer's work is not serialised behind the slow one.
type Lane string

const (
	// LaneRealtime carries topics whose consumers only touch memory, Redis or
	// one indexed read: socket fan-out and cache invalidation. It also claims
	// every topic no other lane owns, so a topic nobody consumes yet is
	// completed rather than left pending, and it is the lane that sweeps
	// expired claims, because it is the one that never waits on a downstream.
	LaneRealtime Lane = "realtime"
	// LaneNotify carries topics a database fan-out consumer reads (inbox
	// notifications, chat/task sync). Their realtime frames ride on the same
	// row, delivered concurrently with the fan-out.
	LaneNotify Lane = "notify"
	// LaneProvider carries provider.* instructions: RPCs to LiveKit.
	LaneProvider Lane = "provider"
	// LanePush carries web push delivery to third-party push gateways.
	LanePush Lane = "push"
	// LaneSlow carries work measured in tens of seconds: LLM summaries and
	// audit exports.
	LaneSlow Lane = "slow"
)

// lanes lists every lane from fastest to slowest; a topic whose consumers sit
// on several lanes runs on the last of them in this order.
var lanes = []Lane{LaneRealtime, LaneNotify, LaneProvider, LanePush, LaneSlow}

// laneSpec is how a lane delivers: workers is how many ordering groups it
// runs side by side, batch caps a claim (zero means Options.Batch). The lanes
// that wait on a third party claim little at a time, so a claimed row starts
// well inside its lease instead of queueing behind siblings that may each run
// for seconds (LiveKit) or minutes (an export).
type laneSpec struct {
	workers int
	batch   int32
}

var laneSpecs = map[Lane]laneSpec{
	LaneRealtime: {workers: 4},
	LaneNotify:   {workers: 2},
	LaneProvider: {workers: 2, batch: 16},
	LanePush:     {workers: 2, batch: 8},
	LaneSlow:     {workers: 2, batch: 2},
}

func laneRank(l Lane) int {
	for i, x := range lanes {
		if x == l {
			return i
		}
	}
	return -1
}

// laneClaim is one running lane: which rows it claims and how it delivers
// them. Exactly one of topics / except applies: a lane with all set claims
// every topic not in except.
type laneClaim struct {
	name    Lane
	topics  []string
	except  []string
	all     bool
	reap    bool
	workers int
	batch   int32
}

// claims returns the lanes Run starts. The realtime lane always runs (it owns
// the unclaimed topics and sweeps stale claims); another lane runs only when
// some consumer put a topic on it.
func (d *Dispatcher) claims() []laneClaim {
	byLane := map[Lane][]string{}
	for topic, l := range d.topicLane {
		byLane[l] = append(byLane[l], topic)
	}
	var owned []string
	for l, topics := range byLane {
		if l != LaneRealtime {
			owned = append(owned, topics...)
		}
	}
	sort.Strings(owned)
	out := make([]laneClaim, 0, len(lanes))
	for _, l := range lanes {
		spec := laneSpecs[l]
		batch := d.batch
		if spec.batch > 0 && spec.batch < batch {
			batch = spec.batch
		}
		c := laneClaim{name: l, workers: spec.workers, batch: batch}
		if l == LaneRealtime {
			c.all, c.except, c.reap = true, owned, true
		} else {
			if len(byLane[l]) == 0 {
				continue
			}
			c.topics = append([]string(nil), byLane[l]...)
			sort.Strings(c.topics)
		}
		out = append(out, c)
	}
	return out
}

// claim takes up to limit pending rows for the lane in one short transaction
// that commits before any consumer runs: a consumer that blocks must not hold
// a database transaction open behind it.
func (d *Dispatcher) claim(ctx context.Context, lc laneClaim, limit int32) ([]Row, error) {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := d.q.WithTx(tx)
	lockedBy := pgtype.Text{String: d.nodeID, Valid: true}
	var rows []Row
	switch {
	case lc.all && len(lc.except) == 0:
		rows, err = q.ClaimPendingOutbox(ctx, db.ClaimPendingOutboxParams{
			LockedBy: lockedBy, LeaseSeconds: float64(leaseSeconds), LimitN: limit,
		})
	case lc.all:
		rows, err = q.ClaimPendingOutboxExcept(ctx, db.ClaimPendingOutboxExceptParams{
			LockedBy: lockedBy, LeaseSeconds: float64(leaseSeconds), Excluded: lc.except, LimitN: limit,
		})
	default:
		rows, err = q.ClaimPendingOutboxTopics(ctx, db.ClaimPendingOutboxTopicsParams{
			LockedBy: lockedBy, LeaseSeconds: float64(leaseSeconds), Topics: lc.topics, LimitN: limit,
		})
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return rows, nil
}

// orderingKey groups the rows that must keep their relative order: everything
// in one workspace (a meeting, its lobby, its chat) is delivered in commit
// order on one worker, while different workspaces run side by side.
func orderingKey(r Row) string {
	if r.WorkspaceID.Valid && r.WorkspaceID.String != "" {
		return "ws:" + r.WorkspaceID.String
	}
	if r.OrganizationID.Valid && r.OrganizationID.String != "" {
		return "org:" + r.OrganizationID.String
	}
	return ""
}

// groupRows sorts rows in place into created_at order, the order the claim
// selected them in (UPDATE … RETURNING promises none), and splits them by
// ordering key, keeping the first-seen order of the keys.
func groupRows(rows []Row) [][]Row {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i].CreatedAt.Time, rows[j].CreatedAt.Time
		if !a.Equal(b) {
			return a.Before(b)
		}
		return rows[i].ID < rows[j].ID
	})
	index := map[string]int{}
	var groups [][]Row
	for _, r := range rows {
		k := orderingKey(r)
		i, ok := index[k]
		if !ok {
			i = len(groups)
			index[k] = i
			groups = append(groups, nil)
		}
		groups[i] = append(groups[i], r)
	}
	return groups
}

// deliverBatch delivers claimed rows, up to workers ordering groups at a time,
// and marks the delivered ones done in one statement. A failed row is marked
// on its own (retry or dead letter) and does not stop the rest of its group,
// which is what the single loop did before lanes existed.
func (d *Dispatcher) deliverBatch(ctx context.Context, lane Lane, rows []Row, workers int) {
	groups := groupRows(rows)
	if workers <= 1 && len(groups) > 1 {
		// One worker delivers in plain commit order across every key.
		groups = [][]Row{rows}
	}
	var mu sync.Mutex
	done := make([]string, 0, len(rows))
	run := func(group []Row) {
		for _, row := range group {
			if ctx.Err() != nil {
				// Shutting down: the rest keep their claim and come back when
				// the lease runs out, exactly as an interrupted delivery does.
				return
			}
			if err := d.deliver(ctx, row); err != nil {
				d.fail(ctx, lane, row, err)
				continue
			}
			mu.Lock()
			done = append(done, row.ID)
			mu.Unlock()
		}
	}
	if workers > len(groups) {
		workers = len(groups)
	}
	if workers <= 1 {
		for _, g := range groups {
			run(g)
		}
	} else {
		next := make(chan []Row)
		var wg sync.WaitGroup
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for g := range next {
					run(g)
				}
			}()
		}
		for _, g := range groups {
			next <- g
		}
		close(next)
		wg.Wait()
	}
	d.markDone(ctx, lane, done)
}

// markWriteTimeout bounds the bookkeeping write after a batch. It runs on a
// context detached from shutdown: work that was delivered is recorded as
// delivered even when the process is stopping, instead of being handed out
// again after the lease.
const markWriteTimeout = 5 * time.Second

func (d *Dispatcher) markDone(ctx context.Context, lane Lane, ids []string) {
	if len(ids) == 0 {
		return
	}
	mctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), markWriteTimeout)
	defer cancel()
	if err := d.q.MarkOutboxDoneBatch(mctx, ids); err != nil {
		// The rows stay claimed and are delivered again after the lease:
		// at-least-once, which every consumer already tolerates.
		d.log.Warn("outbox mark done", "lane", string(lane), "rows", len(ids), "err", err)
		return
	}
	if d.metrics != nil {
		for range ids {
			d.metrics.IncOutboxDone()
		}
	}
}
