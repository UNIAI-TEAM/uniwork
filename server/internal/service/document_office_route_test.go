package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// The document-scoped wrappers the HTTP routes call: the base comes from the
// document, a named format or revision is checked against it, a retried key
// replays its own job, and a job id of another document is refused before
// anything happens to it.
func TestDocumentOfficeLifecycleThroughTheDocumentRoute(t *testing.T) {
	ctx := context.Background()
	serialize := func(key string) OfficeJobRequest {
		return OfficeJobRequest{Operation: string(office.OperationSerialize), IdempotencyKey: key}
	}

	t.Run("a committed key replays with the old, omitted or explicit base", func(t *testing.T) {
		f := newOfficeFixture(t, "commit me\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		req := serialize("k-route-committed")
		req.BaseRevision, req.HasBaseRevision = f.rev, true
		row, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req)
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, []byte("# out\n"), "text/markdown")
		if done, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID); err != nil || done.State != "completed" {
			t.Fatalf("complete: %+v %v", done, err)
		}
		newVersion := util.NewID()
		if _, err := svc.ClaimOfficeJobOutputInTx(ctx, f.q, f.org, f.ws, row.ID, newVersion); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `UPDATE documents SET revision = revision + 1, file_version_id = $1 WHERE id = $2`, newVersion, f.doc); err != nil {
			t.Fatal(err)
		}
		for name, retry := range map[string]OfficeJobRequest{"old base": req, "omitted base": serialize("k-route-committed")} {
			again, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, retry)
			if err != nil || again.ID != row.ID || again.CommittedVersionID.String != newVersion {
				t.Fatalf("%s: committed replay: %+v %v", name, again, err)
			}
		}
		stale := req
		stale.BaseRevision = f.rev + 1
		if _, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, stale); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("another base on a used key: %v", err)
		}
		if len(eng.grants) != 1 {
			t.Fatalf("replay dispatched again: %d grants", len(eng.grants))
		}
	})

	t.Run("an explicit base_revision 0 is a stale base, not the current one", func(t *testing.T) {
		f := newOfficeFixture(t, "zero\n")
		svc := f.service(newScriptedEngine())
		req := serialize("k-route-zero")
		req.HasBaseRevision = true
		if _, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req); office.ErrorCode(err) != "base_version_mismatch" {
			t.Fatalf("explicit zero base: %v", err)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 {
			t.Fatalf("stale base wrote %d job rows", n)
		}
	})

	t.Run("a named format must be the document's", func(t *testing.T) {
		f := newOfficeFixture(t, "format\n")
		svc := f.service(newScriptedEngine())
		req := serialize("k-route-format")
		req.Format = string(office.FormatPDF)
		if _, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req); !errors.Is(err, ErrOfficeJobInvalid) {
			t.Fatalf("mismatched format: %v", err)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 {
			t.Fatalf("mismatched format wrote %d job rows", n)
		}
		req.IdempotencyKey, req.Format = "k-route-format-ok", string(office.FormatMD)
		if _, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req); err != nil {
			t.Fatalf("matching format: %v", err)
		}
	})

	t.Run("cancel through another document's route leaves the job live", func(t *testing.T) {
		f := newOfficeFixture(t, "mine\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		other, _, _ := f.seedDocument(t, "other\n")
		row, err := svc.StartOfficeJobForDocument(ctx, f.actor, other, serialize("k-route-other"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.CancelOfficeJobForDocument(ctx, f.actor, f.doc, row.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("cancel via another document: %v", err)
		}
		if got := svc.mustGet(t, f.org, f.ws, row.ID); got.State != row.State {
			t.Fatalf("cancel via another document changed the job: %s -> %s", row.State, got.State)
		}
		if eng.cancels != 0 {
			t.Fatalf("the engine was told to cancel: %d", eng.cancels)
		}
		if c, err := svc.CancelOfficeJobForDocument(ctx, f.actor, other, row.ID); err != nil || c.State != "cancelled" {
			t.Fatalf("cancel via its own document: %+v %v", c, err)
		}
	})
}
