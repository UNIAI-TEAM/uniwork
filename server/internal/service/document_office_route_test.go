package service

import (
	"context"
	"errors"
	"strings"
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

// OQ-P1 (a1) reaches the office job submission - both the document-scoped
// wrapper (StartOfficeJobForDocument) and loadBase (StartOfficeJob): a base
// behind a rename still describes the same bytes, so the job starts on the
// document's current revision and both submit paths store that revision as
// the job's base_revision; a base behind a content change is still
// base_version_mismatch and writes no job row.
func TestDocumentOfficeSubmitAcceptsAMetadataBase(t *testing.T) {
	ctx := context.Background()
	serialize := func(key string) OfficeJobRequest {
		return OfficeJobRequest{Operation: string(office.OperationSerialize), IdempotencyKey: key}
	}

	t.Run("the document-scoped submit takes the base rule", func(t *testing.T) {
		f := newOfficeFixture(t, "rename base\n")
		svc := f.service(newScriptedEngine())
		title := "Tài liệu đổi tên"
		renamed, err := f.docs.UpdateDocument(ctx, f.actor, f.doc, UpdateDocumentInput{Revision: f.rev, Title: &title})
		mustf(t, err, "rename")
		if renamed.Document.Revision <= f.rev || renamed.Document.ContentRevision != f.rev {
			t.Fatalf("rename: revision %d content_revision %d, want a metadata bump", renamed.Document.Revision, renamed.Document.ContentRevision)
		}
		req := serialize("k-route-rename")
		req.HasBaseRevision, req.BaseRevision = true, f.rev
		row, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req)
		mustf(t, err, "job on the pre-rename base")
		if row.BaseRevision != renamed.Document.Revision {
			t.Fatalf("job base = %d, want the current revision %d", row.BaseRevision, renamed.Document.Revision)
		}
		// A content change moves content_revision: the pre-change base is refused.
		up, err := f.docs.UploadDocumentFile(ctx, f.actor, f.doc, DocumentUploadInput{Filename: "note-v2.md", Body: strings.NewReader("v2\n")})
		mustf(t, err, "upload")
		if _, err := f.docs.CommitFileVersion(ctx, f.actor, f.doc, CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: row.BaseRevision}); err != nil {
			t.Fatalf("commit: %v", err)
		}
		before := f.officeJobCount(t, f.doc)
		req.IdempotencyKey = "k-route-rename-stale"
		req.BaseRevision = renamed.Document.Revision
		if _, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req); office.ErrorCode(err) != "base_version_mismatch" {
			t.Fatalf("job on a base behind a content change: %v", err)
		}
		if n := f.officeJobCount(t, f.doc); n != before {
			t.Fatalf("the stale submit wrote %d job rows", n-before)
		}
	})

	t.Run("loadBase takes the base rule", func(t *testing.T) {
		f := newOfficeFixture(t, "rename job\n")
		svc := f.service(newScriptedEngine())
		title := "Tài liệu job"
		renamed, err := f.docs.UpdateDocument(ctx, f.actor, f.doc, UpdateDocumentInput{Revision: f.rev, Title: &title})
		mustf(t, err, "rename")
		in := f.input("k-loadbase-rename")
		in.BaseRevision = f.rev // the pre-rename base; the version id is unchanged
		row, err := svc.StartOfficeJob(ctx, f.actor, in)
		mustf(t, err, "job on the pre-rename base")
		if row.BaseRevision != renamed.Document.Revision {
			t.Fatalf("job base = %d, want %d", row.BaseRevision, renamed.Document.Revision)
		}
		// A base behind a content change is still refused.
		other, ver, rev := f.seedDocument(t, "loadbase other\n")
		up, err := f.docs.UploadDocumentFile(ctx, f.actor, other, DocumentUploadInput{Filename: "other-v2.md", Body: strings.NewReader("v2\n")})
		mustf(t, err, "upload")
		if _, err := f.docs.CommitFileVersion(ctx, f.actor, other, CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: rev}); err != nil {
			t.Fatalf("commit: %v", err)
		}
		bad := f.input("k-loadbase-stale")
		bad.DocumentID, bad.BaseVersionID, bad.BaseRevision = other, ver, rev
		if _, err := svc.StartOfficeJob(ctx, f.actor, bad); office.ErrorCode(err) != "base_version_mismatch" {
			t.Fatalf("job on a base behind a content change: %v", err)
		}
	})

	t.Run("both submit paths store the same base for a pre-rename base", func(t *testing.T) {
		f := newOfficeFixture(t, "one base\n")
		svc := f.service(newScriptedEngine())
		title := "Tài liệu một gốc"
		renamed, err := f.docs.UpdateDocument(ctx, f.actor, f.doc, UpdateDocumentInput{Revision: f.rev, Title: &title})
		mustf(t, err, "rename")
		if renamed.Document.Revision <= f.rev || renamed.Document.ContentRevision != f.rev {
			t.Fatalf("rename: revision %d content_revision %d, want a metadata bump",
				renamed.Document.Revision, renamed.Document.ContentRevision)
		}

		req := serialize("k-same-base-route")
		req.HasBaseRevision, req.BaseRevision = true, f.rev
		route, err := svc.StartOfficeJobForDocument(ctx, f.actor, f.doc, req)
		mustf(t, err, "the document-scoped submit")

		in := f.input("k-same-base-raw")
		in.BaseRevision = f.rev
		// A different model reference: the second live job is not the same work.
		in.DocumentModelRef = "model-other"
		raw, err := svc.StartOfficeJob(ctx, f.actor, in)
		mustf(t, err, "the raw submit")

		if route.BaseRevision != raw.BaseRevision {
			t.Fatalf("submit paths store different bases: %d and %d", route.BaseRevision, raw.BaseRevision)
		}
		if raw.BaseRevision != renamed.Document.Revision {
			t.Fatalf("job base = %d, want the current revision %d", raw.BaseRevision, renamed.Document.Revision)
		}
	})

	t.Run("a raw retry with the pre-rename base replays the same job", func(t *testing.T) {
		f := newOfficeFixture(t, "retry base\n")
		svc := f.service(newScriptedEngine())
		title := "Tài liệu thử lại"
		renamed, err := f.docs.UpdateDocument(ctx, f.actor, f.doc, UpdateDocumentInput{Revision: f.rev, Title: &title})
		mustf(t, err, "rename")
		if renamed.Document.Revision <= f.rev || renamed.Document.ContentRevision != f.rev {
			t.Fatalf("rename: revision %d content_revision %d, want a metadata bump",
				renamed.Document.Revision, renamed.Document.ContentRevision)
		}

		in := f.input("k-raw-retry")
		in.BaseRevision = f.rev // the pre-rename base the client supplied
		first, err := svc.StartOfficeJob(ctx, f.actor, in)
		mustf(t, err, "the first raw submit")
		if first.BaseRevision != renamed.Document.Revision {
			t.Fatalf("job base = %d, want the current revision %d", first.BaseRevision, renamed.Document.Revision)
		}
		rows := f.officeJobCount(t, f.doc)

		// The same key, input and supplied base: the stored base differs from
		// it, yet the fingerprint binds the supplied one, so this replays.
		again, err := svc.StartOfficeJob(ctx, f.actor, in)
		mustf(t, err, "the retry with the same pre-rename base")
		if again.ID != first.ID {
			t.Fatalf("retry answered job %s, want %s", again.ID, first.ID)
		}
		if n := f.officeJobCount(t, f.doc); n != rows {
			t.Fatalf("the retry wrote %d job rows", n-rows)
		}

		// The same key with another supplied base is a different payload.
		other := in
		other.BaseRevision = renamed.Document.Revision
		if _, err := svc.StartOfficeJob(ctx, f.actor, other); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("retry with a different base: %v, want payload_fingerprint_mismatch", err)
		}
		if n := f.officeJobCount(t, f.doc); n != rows {
			t.Fatalf("the mismatched retry wrote %d job rows", n-rows)
		}
	})
}
