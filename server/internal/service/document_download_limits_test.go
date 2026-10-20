package service

import (
	"context"
	"testing"
)

// UNI-2045 zip r1 F2: one creator cannot queue unlimited jobs.

func TestDocumentDownloadJobCapsActiveJobsPerCreator(t *testing.T) {
	z := newZipFixture(t)
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Busy", "b.txt", []byte("busy"))

	first := z.create(t, member, doc)
	z.create(t, member, doc)
	_, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), member, z.env.tn.wsA, []string{doc})
	ce := wantCode(t, err, "download_jobs_busy")
	if ce.Status != 429 || ce.Fields["retry_after"] != 30 {
		t.Fatalf("busy refusal = %+v, want 429 with retry_after 30", ce)
	}

	// Another creator is not held by this one's queue.
	other := human(z.env.tn.creator)
	if _, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), other, z.env.tn.wsA, []string{doc}); err != nil {
		t.Fatalf("another creator = %v, want accepted", err)
	}

	// A settled job frees a slot.
	if err := z.run(t, first); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), member, z.env.tn.wsA, []string{doc}); err != nil {
		t.Fatalf("after a job settled = %v, want accepted", err)
	}
}
