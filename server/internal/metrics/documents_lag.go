package metrics

import (
	"context"
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
//     30-day purge_after elapsed, or an orphaned asset past the 7-day grace.
//     The predicate matches ListDocumentsForPurge and the orphaned-asset
//     sweep.
//
// The queries run with a 2s timeout and never fail the scrape. Compaction is
// a daily, bounded sweep: its lag is not sampled, its outcome is in
// uniwork_document_worker_sweeps_total.
type DocumentLagCollector struct {
	pool *pgxpool.Pool
	desc *prometheus.Desc
}

const documentAutoVersionQuietWindow = 10 * time.Minute

func NewDocumentLagCollector(pool *pgxpool.Pool) *DocumentLagCollector {
	return &DocumentLagCollector{
		pool: pool,
		desc: prometheus.NewDesc(
			"uniwork_document_worker_oldest_pending_seconds",
			"Age of the oldest due work item of a document maintenance worker (autoversion, purge).",
			[]string{"worker"}, nil,
		),
	}
}

func (c *DocumentLagCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.desc
}

func (c *DocumentLagCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ch <- prometheus.MustNewConstMetric(c.desc, prometheus.GaugeValue, c.autoVersionLag(ctx), "autoversion")
	ch <- prometheus.MustNewConstMetric(c.desc, prometheus.GaugeValue, c.purgeLag(ctx), "purge")
}

func (c *DocumentLagCollector) autoVersionLag(ctx context.Context) float64 {
	var age float64
	_ = c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(content_saved_at))), 0)::float8
		FROM documents
		WHERE kind = 'page'
		  AND archived_at IS NULL
		  AND content_saved_at IS NOT NULL
		  AND content_saved_at < now() - make_interval(secs => $1)
		  AND (last_version_at IS NULL OR last_version_at < content_saved_at)
	`, documentAutoVersionQuietWindow.Seconds()).Scan(&age)
	return age
}

func (c *DocumentLagCollector) purgeLag(ctx context.Context) float64 {
	var age float64
	_ = c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(purge_after))), 0)::float8
		FROM documents
		WHERE archived_at IS NOT NULL
		  AND purge_after IS NOT NULL
		  AND owner_id IS NULL
		  AND purge_after < now()
	`).Scan(&age)
	var assetAge float64
	_ = c.pool.QueryRow(ctx, `
		SELECT COALESCE(EXTRACT(EPOCH FROM (now() - (min(orphaned_at) + interval '7 days'))), 0)::float8
		FROM document_assets
		WHERE orphaned_at IS NOT NULL
		  AND orphaned_at < now() - interval '7 days'
	`).Scan(&assetAge)
	if assetAge > age {
		return assetAge
	}
	return age
}
