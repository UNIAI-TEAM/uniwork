package service

import (
	"context"
	"testing"
)

// UNI-2045 zip r1 F5: settled jobs drop their requested ids, the short sweep
// closes stuck jobs and purges old rows.

func TestDocumentDownloadJobClearsRequestedIDsOnceSettled(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Done", "d.txt", []byte("done"))
	job := z.create(t, member, doc)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := z.env.f.pool.QueryRow(ctx, `SELECT cardinality(document_ids) FROM document_download_jobs WHERE id = $1`, job.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("settled job keeps %d requested ids (%v), want none", n, err)
	}
}

func TestDocumentDownloadSweepClosesStuckAndPurgesOldJobs(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Sweep", "s.txt", []byte("sweep"))
	stuck := z.create(t, member, doc)
	fresh := z.create(t, member, doc)
	old := z.create(t, human(z.env.tn.creator), doc)
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_download_jobs SET status = 'running', started_at = now() - interval '2 hours' WHERE id = $1`, stuck.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_download_jobs SET status = 'failed', error = 'build_failed', finished_at = now() - interval '8 days' WHERE id = $1`, old.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.svc.SweepDocumentDownloads(ctx); err != nil {
		t.Fatal(err)
	}
	status := func(id string) string {
		var s string
		if err := z.env.f.pool.QueryRow(ctx, `SELECT status FROM document_download_jobs WHERE id = $1`, id).Scan(&s); err != nil {
			return "gone"
		}
		return s
	}
	if got := status(stuck.ID); got != "failed" {
		t.Fatalf("stuck running job = %s, want failed", got)
	}
	if got := status(fresh.ID); got != "queued" {
		t.Fatalf("fresh job = %s, want it left queued", got)
	}
	if got := status(old.ID); got != "gone" {
		t.Fatalf("8-day-old settled job = %s, want purged", got)
	}
}
