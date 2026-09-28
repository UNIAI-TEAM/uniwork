package metrics

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// DocumentLagCollector exposes the age of the oldest work item each document
// maintenance worker is behind on (G1-09, UNI-683). A gauge, not a sweep
// counter: it shows a worker that is not keeping up even while every sweep
// "succeeds", and it returns to 0 as soon as the queue is drained.
//
//   - autoversion: the oldest page that was saved past the 10-minute quiet
//     window and has no snapshot covering that save, i.e. the document the
//     next tick is behind on. The predicate matches
//     ListDocumentsForAutoVersion (C-01 §6.3).
//   - purge: the oldest item past its due time - an archived document whose
//     30-day purge_after elapsed, or an orphaned asset of a live document past
//     the 7-day grace. The predicates match ListDocumentsForPurge and
//     ListOrphanedDocumentAssets (same tenant-triple join, same live-parent
//     filter: an archived document's assets purge with it).
//
// The queries are fleet-wide aggregates with fixed worker labels only. They
// run at most once per cacheTTL whatever the scrape rate, under a 2s
// timeout, and never fail the scrape: a query that errors leaves its worker's
// gauge absent and sets uniwork_document_worker_lag_up{worker} to 0, so a
// broken read is never mistaken for an empty queue. Compaction is a daily,
// bounded sweep: its lag is not sampled, its outcome is in
// uniwork_document_worker_sweeps_total.
type DocumentLagCollector struct {
	pool     *pgxpool.Pool
	desc     *prometheus.Desc
	up       *prometheus.Desc
	cacheTTL time.Duration
	now      func() time.Time

	mu      sync.Mutex
	sampled time.Time
	samples []documentLagSample
}

type documentLagSample struct {
	worker string
	age    float64
	ok     bool
}

const (
	documentAutoVersionQuietWindow = 10 * time.Minute
	documentLagCacheTTL            = 30 * time.Second
)

func NewDocumentLagCollector(pool *pgxpool.Pool) *DocumentLagCollector {
	return &DocumentLagCollector{
		pool: pool,
		desc: prometheus.NewDesc(
			"uniwork_document_worker_oldest_pending_seconds",
			"Age of the oldest due work item of a document maintenance worker (autoversion, purge).",
			[]string{"worker"}, nil,
		),
		up: prometheus.NewDesc(
			"uniwork_document_worker_lag_up",
			"1 when the last lag read of a document worker succeeded, 0 when it failed (the lag gauge is then absent).",
			[]string{"worker"}, nil,
		),
		cacheTTL: documentLagCacheTTL,
		now:      time.Now,
	}
}

func (c *DocumentLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.desc
	ch <- c.up
}

func (c *DocumentLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	for _, s := range c.read() {
		up := 0.0
		if s.ok {
			up = 1
			ch <- prometheus.MustNewConstMetric(c.desc, prometheus.GaugeValue, s.age, s.worker)
		}
		ch <- prometheus.MustNewConstMetric(c.up, prometheus.GaugeValue, up, s.worker)
	}
}

// read returns the cached samples while they are fresh, else queries again.
func (c *DocumentLagCollector) read() []documentLagSample {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if c.samples != nil && now.Sub(c.sampled) < c.cacheTTL {
		return c.samples
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	auto, autoErr := c.autoVersionLag(ctx)
	purge, purgeErr := c.purgeLag(ctx)
	c.samples = []documentLagSample{
		{worker: "autoversion", age: auto, ok: autoErr == nil},
		{worker: "purge", age: purge, ok: purgeErr == nil},
	}
	c.sampled = now
	return c.samples
}

func (c *DocumentLagCollector) autoVersionLag(ctx context.Context) (float64, error) {
	var age float64
	err := c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(content_saved_at))), 0)::float8
		FROM documents
		WHERE kind = 'page'
		  AND archived_at IS NULL
		  AND content_saved_at IS NOT NULL
		  AND content_saved_at < now() - make_interval(secs => $1)
		  AND (last_version_at IS NULL OR last_version_at < content_saved_at)
	`, documentAutoVersionQuietWindow.Seconds()).Scan(&age)
	return age, err
}

func (c *DocumentLagCollector) purgeLag(ctx context.Context) (float64, error) {
	var age float64
	if err := c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(purge_after))), 0)::float8
		FROM documents
		WHERE archived_at IS NOT NULL
		  AND purge_after IS NOT NULL
		  AND owner_id IS NULL
		  AND purge_after < now()
	`).Scan(&age); err != nil {
		return 0, err
	}
	var assetAge float64
	if err := c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - (min(a.orphaned_at) + interval '7 days'))), 0)::float8
		FROM document_assets a
		JOIN documents d
		  ON d.organization_id = a.organization_id
		 AND d.workspace_id = a.workspace_id
		 AND d.id = a.document_id
		WHERE a.orphaned_at IS NOT NULL
		  AND a.orphaned_at < now() - interval '7 days'
		  AND d.archived_at IS NULL
	`).Scan(&assetAge); err != nil {
		return 0, err
	}
	if assetAge > age {
		return assetAge, nil
	}
	return age, nil
}
