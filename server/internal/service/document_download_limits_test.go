package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// UNI-2045 zip r2 L3: the cap follows the creator, not the workspace they ask
// from, so a member cannot hold two jobs per workspace.
func TestDocumentDownloadJobCapCountsEveryWorkspaceOfTheCreator(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Elsewhere", "e.txt", []byte("elsewhere"))

	for i := 0; i < documentDownloadMaxActive; i++ {
		if _, err := z.env.f.q.InsertDocumentDownloadJob(ctx, db.InsertDocumentDownloadJobParams{
			ID: util.NewID(), OrganizationID: z.env.tn.orgID, WorkspaceID: z.env.tn.wsB,
			CreatedBy: member.ID, CreatedByKind: string(member.Kind), DocumentIds: []string{doc},
		}); err != nil {
			t.Fatal(err)
		}
	}
	_, err := z.env.svc.CreateDocumentDownloadJob(ctx, member, z.env.tn.wsA, []string{doc})
	ce := wantCode(t, err, "download_jobs_busy")
	if ce.Status != 429 {
		t.Fatalf("busy refusal = %+v, want 429", ce)
	}
}
