package service

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeCommit: engine output becomes a Document version through
// the one commit path (G2-02c on G1-03). The office_jobs row is seeded in the
// shape SubmitOfficeJob leaves once the engine settles - the lifecycle suite
// covers how it got there. Runs on filesfake, local storage and MinIO.
func TestDocumentOfficeCommit(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		member := human(env.tn.member)

		t.Run("a scripted engine job lands its output end to end", func(t *testing.T) {
			// PDF: the provider output has no filename (FS-C1 §4), so the bytes
			// alone must sniff to the document's format on the real backends.
			created := env.createFile(t, member, "e2e.pdf", pdfBody("e2e-v1"))
			eng := newScriptedEngine()
			eng.fake = env.fake // nil on the real backends: the grant's URL is used
			jobs := NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc,
				MaxDeadline: time.Minute,
			})
			row, err := jobs.StartOfficeJob(context.Background(), member, OfficeJobInput{
				OrganizationID: created.Document.OrganizationID, WorkspaceID: created.Document.WorkspaceID,
				DocumentID: created.Document.ID, BaseVersionID: created.Document.FileVersionID.String,
				BaseRevision: created.Document.Revision, Operation: office.OperationSerialize, Format: office.FormatPDF,
				IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start job")
			// The engine PUTs its output to the grant's write target - on the
			// real backends this is the signed URL FileService issued.
			out := pdfBody("e2e-engine")
			eng.finish(t, row.ID, out, "application/pdf")
			done, err := jobs.GetOfficeJob(context.Background(), member, created.Document.OrganizationID, created.Document.WorkspaceID, row.ID)
			mustf(t, err, "refresh")
			if done.State != "completed" || done.OutputChecksum.String != sha(out) {
				t.Fatalf("job did not verify its output: %+v", done)
			}
			res, err := env.commit(member, created.Document.ID, done.OutputFileID.String, done.BaseRevision, util.NewID())
			mustf(t, err, "commit")
			if res.Version.Version != 2 || res.Version.FileID.String != done.OutputFileID.String {
				t.Fatalf("version = %+v", res.Version)
			}
			if got := env.job(t, row.ID); got.CommittedVersionID.String != res.Version.ID {
				t.Fatal("job not marked committed")
			}
			if got := env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, out) {
				t.Fatal("the version does not serve the engine's bytes")
			}
		})

		t.Run("a completed job commits exactly one version", func(t *testing.T) {
			created := env.createFile(t, member, "office.pdf", pdfBody("office-v1"))
			body := pdfBody("office-v2")
			job := env.officeJob(t, member, created.Document, body, "completed")
			res, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			mustf(t, err, "commit office output")
			if res.Version.Version != 2 || res.Version.Reason != "upload" || res.Version.FileID.String != job.OutputFileID.String {
				t.Fatalf("version = %+v", res.Version)
			}
			if res.Version.EngineVersion.String != office.TrustedEngineVersion ||
				res.Version.ContractVersion.String != office.ContractVersion {
				t.Fatalf("office provenance not stamped server-side: %+v", res.Version)
			}
			if res.Document.Revision != created.Document.Revision+1 || res.Document.FileVersionID.String != res.Version.ID {
				t.Fatalf("document = rev %d ptr %s", res.Document.Revision, res.Document.FileVersionID.String)
			}
			if got := env.job(t, job.ID); !got.CommittedVersionID.Valid || got.CommittedVersionID.String != res.Version.ID {
				t.Fatalf("job not marked committed to the version: %+v", got)
			}
			if got := env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, body) {
				t.Fatal("download does not return the engine bytes")
			}
			if vs := env.versions(t, created.Document); len(vs) != 2 {
				t.Fatalf("versions = %d, want exactly 2", len(vs))
			}
			if n := env.countAudit(t, audit.ActionDocumentVersionCreated, created.Document.ID); n != 1 {
				t.Fatalf("audit rows = %d, want 1", n)
			}
			if n := env.countOutbox(t, "document.version_created", created.Document.ID); n != 1 {
				t.Fatalf("outbox rows = %d, want 1", n)
			}
			if env.real != nil {
				if st := env.sessionStatus(t, job.OutputFileID.String); st != "claimed" {
					t.Fatalf("provider output session = %s, want claimed", st)
				}
			}
		})

		t.Run("a document off the job's base conflicts and leaves the output staged", func(t *testing.T) {
			created := env.createFile(t, member, "base-moved.pdf", pdfBody("moved-v1"))
			job := env.officeJob(t, member, created.Document, pdfBody("moved-v2"), "completed")
			// Another commit wins the document before the office output lands.
			up := env.upload(t, member, created.Document.ID, "moved-upload.pdf", pdfBody("moved-upload"))
			winner, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "winning commit")
			_, err = env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			ce := wantCode(t, err, "document_version_conflict")
			if ce.Status != 409 || ce.Fields["current_revision"] == "" {
				t.Fatalf("conflict = %+v", ce)
			}
			d := env.doc(t, created.Document.ID)
			if d.Revision != winner.Document.Revision || len(env.versions(t, d)) != 2 {
				t.Fatal("the losing commit still wrote a version")
			}
			got := env.job(t, job.ID)
			if got.State != "completed" || got.CommittedVersionID.Valid {
				t.Fatalf("losing commit touched the job: %+v", got)
			}
			if env.real != nil {
				if st := env.sessionStatus(t, job.OutputFileID.String); st != "staged" {
					t.Fatalf("losing output session = %s, want staged", st)
				}
			}
		})

		t.Run("a job cancelled before commit never attaches its output", func(t *testing.T) {
			created := env.createFile(t, member, "cancelled.pdf", pdfBody("cancelled-v1"))
			job := env.officeJob(t, member, created.Document, pdfBody("cancelled-v2"), "cancelled")
			_, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_upload_invalid"); ce.Fields["reason"] != "office_job_cancelled" {
				t.Fatalf("cancelled commit = %+v", ce)
			}
			d := env.doc(t, created.Document.ID)
			if d.Revision != created.Document.Revision || len(env.versions(t, d)) != 1 {
				t.Fatal("a cancelled job still wrote a version")
			}
			if got := env.job(t, job.ID); got.CommittedVersionID.Valid {
				t.Fatal("a cancelled job was marked committed")
			}
			if env.real != nil {
				if st := env.sessionStatus(t, job.OutputFileID.String); st != "staged" {
					t.Fatalf("cancelled output session = %s, want staged", st)
				}
			}
		})

		t.Run("an export job's output is never a version", func(t *testing.T) {
			created := env.createFile(t, member, "export.pdf", pdfBody("export-v1"))
			job := env.officeJobOp(t, member, created.Document, pdfBody("export-out"), "completed", office.OperationExport)
			_, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_upload_invalid"); ce.Fields["reason"] != "office_job_export_not_a_version" {
				t.Fatalf("export commit = %+v", ce)
			}
			d := env.doc(t, created.Document.ID)
			if d.Revision != created.Document.Revision || len(env.versions(t, d)) != 1 {
				t.Fatal("an export job still wrote a version")
			}
			if got := env.job(t, job.ID); got.CommittedVersionID.Valid {
				t.Fatal("an export job was marked committed")
			}
		})

		t.Run("a live or failed job is not committable either", func(t *testing.T) {
			created := env.createFile(t, member, "states.pdf", pdfBody("states-v1"))
			running := env.officeJob(t, member, created.Document, pdfBody("states-run"), "running")
			failed := env.officeJob(t, member, created.Document, pdfBody("states-fail"), "failed")
			for _, job := range []db.OfficeJob{running, failed} {
				_, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
				if ce := wantCode(t, err, "document_upload_invalid"); ce.Fields["reason"] != "office_job_"+job.State {
					t.Fatalf("%s commit = %+v", job.State, ce)
				}
			}
			if len(env.versions(t, env.doc(t, created.Document.ID))) != 1 {
				t.Fatal("a non-completed job still wrote a version")
			}
		})

		t.Run("output for another document is not this document's upload", func(t *testing.T) {
			one := env.createFile(t, member, "one-office.pdf", pdfBody("one-office"))
			two := env.createFile(t, member, "two-office.pdf", pdfBody("two-office"))
			job := env.officeJob(t, member, two.Document, pdfBody("two-output"), "completed")
			_, err := env.commit(member, one.Document.ID, job.OutputFileID.String, one.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_upload_invalid"); ce.Fields["reason"] != "office_job_document" {
				t.Fatalf("cross-document commit = %+v", ce)
			}
		})

		t.Run("retry of the same key replays; a new key sees a spent output", func(t *testing.T) {
			created := env.createFile(t, member, "replay.pdf", pdfBody("replay-v1"))
			body := pdfBody("replay-v2")
			job := env.officeJob(t, member, created.Document, body, "completed")
			key := util.NewID()
			res, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, key)
			mustf(t, err, "commit")
			again, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, key)
			mustf(t, err, "replay")
			if again.Version.ID != res.Version.ID {
				t.Fatalf("replay made another version: %s vs %s", again.Version.ID, res.Version.ID)
			}
			d := env.doc(t, created.Document.ID)
			_, err = env.commit(member, created.Document.ID, job.OutputFileID.String, d.Revision, util.NewID())
			wantCode(t, err, "upload_already_committed")
			if vs := env.versions(t, d); len(vs) != 2 {
				t.Fatalf("versions = %d, want exactly 2", len(vs))
			}
			if got := env.job(t, job.ID); got.CommittedVersionID.String != res.Version.ID {
				t.Fatal("job lost its committed version")
			}
		})

		t.Run("document ACL gates the office commit", func(t *testing.T) {
			created := env.createFile(t, member, "acl.pdf", pdfBody("acl-v1"))
			if _, err := env.f.pool.Exec(context.Background(),
				`UPDATE documents SET visibility = 'restricted' WHERE id = $1`, created.Document.ID); err != nil {
				t.Fatal(err)
			}
			job := env.officeJob(t, member, created.Document, pdfBody("acl-v2"), "completed")
			// A stranger never learns the document exists.
			_, err := env.commit(human(env.tn.bMember), created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			wantNotFound(t, err)
			// A viewer reads the document but cannot save onto it, and an
			// agent with no grant on a restricted document never learns it
			// exists.
			view := env.f.share(t, created.Document, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelView, env.tn.member.ID)
			_, err = env.commit(human(env.tn.creator), created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("viewer commit = %v, want forbidden", err)
			}
			_, err = env.commit(agentActor(env.tn.agent), created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			wantNotFound(t, err)
			// On a workspace document an agent sees the document and is still
			// refused the write (ADR 0010).
			open := env.createFile(t, member, "acl-open.pdf", pdfBody("acl-open"))
			openJob := env.officeJob(t, member, open.Document, pdfBody("acl-open-v2"), "completed")
			_, err = env.commit(agentActor(env.tn.agent), open.Document.ID, openJob.OutputFileID.String, open.Document.Revision, util.NewID())
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("agent commit = %v, want forbidden", err)
			}
			// The refused attempts left the job committable; an editor still lands it.
			env.f.revoke(t, view, env.tn.member.ID)
			env.f.share(t, created.Document, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelEdit, env.tn.member.ID)
			res, err := env.commit(human(env.tn.creator), created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			mustf(t, err, "editor commit")
			if got := env.job(t, job.ID); got.CommittedVersionID.String != res.Version.ID {
				t.Fatal("editor commit did not mark the job")
			}
		})
	})
}

// officeJob stages the shape a settled SubmitOfficeJob leaves: a verified
// provider output in FileService and the office_jobs row in the named state
// (completed, cancelled, running, failed), on the document's current base.
func (e *docStorageEnv) officeJob(t *testing.T, actor Actor, d db.Document, body []byte, state string) db.OfficeJob {
	t.Helper()
	return e.officeJobOp(t, actor, d, body, state, office.OperationSerialize)
}

// officeJobOp is officeJob for a named operation: serialize is the committable
// one, export and convert are the operations the commit path refuses.
func (e *docStorageEnv) officeJobOp(t *testing.T, actor Actor, d db.Document, body []byte, state string, op office.Operation) db.OfficeJob {
	t.Helper()
	ctx := context.Background()
	jobID := util.NewID()
	scope := files.Scope{OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID}
	out, err := e.fs.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actor, Purpose: files.DocumentFile, Scope: scope,
		OperationID: jobID, Deadline: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register provider output: %v", err)
	}
	if e.fake != nil {
		if err := e.fake.WriteProviderOutput(out, body, "application/pdf"); err != nil {
			t.Fatalf("provider write: %v", err)
		}
	} else {
		putWriteTarget(t, out.WriteTarget, body, "application/pdf")
	}
	sum := sha(body)
	done, err := e.fs.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actor, Scope: scope, FileID: out.FileID, OperationID: jobID, ChecksumSHA256: sum,
	})
	if err != nil {
		t.Fatalf("complete provider output: %v", err)
	}
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	job, err := e.f.q.InsertOfficeJob(ctx, db.InsertOfficeJobParams{
		ID: jobID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID,
		Operation: string(op), Format: string(office.FormatPDF),
		BaseRevision: d.Revision, BaseVersionID: d.FileVersionID.String,
		IdempotencyKey: util.NewID(), PayloadFingerprint: util.NewID(),
		InputChecksum: sum, InputLength: done.SizeBytes, GrantID: util.NewID(),
		OutputFileID: pgtype.Text{String: string(out.FileID), Valid: true}, DeadlineAt: now,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind), Now: now,
	})
	if err != nil {
		t.Fatalf("insert job: %v", err)
	}
	switch state {
	case "completed":
		job, err = e.f.q.CompleteOfficeJob(ctx, db.CompleteOfficeJobParams{
			ID: jobID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
			OutputChecksum: pgText(sum), OutputLength: pgtype.Int8{Int64: done.SizeBytes, Valid: true}, Now: now,
		})
	case "cancelled":
		job, err = e.f.q.CancelOfficeJob(ctx, db.CancelOfficeJobParams{
			ID: jobID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
			ErrorReason: pgText("test"), Now: now,
		})
	case "running":
		job, err = e.f.q.MarkOfficeJobRunning(ctx, db.MarkOfficeJobRunningParams{
			ID: jobID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, Now: now,
		})
	case "failed":
		job, err = e.f.q.SettleOfficeJob(ctx, db.SettleOfficeJobParams{
			ID: jobID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
			State: "failed", ErrorCode: pgText("engine_crashed"), ErrorReason: pgText("test"), Now: now,
		})
	default:
		t.Fatalf("officeJob state %q", state)
	}
	if err != nil {
		t.Fatalf("job to %s: %v", state, err)
	}
	if job.State != state {
		t.Fatalf("job state = %s, want %s", job.State, state)
	}
	return job
}

func (e *docStorageEnv) job(t *testing.T, id string) db.OfficeJob {
	t.Helper()
	job, err := e.f.q.GetOfficeJob(context.Background(), db.GetOfficeJobParams{
		ID: id, OrganizationID: e.tn.orgID, WorkspaceID: e.tn.wsA,
	})
	if err != nil {
		t.Fatal(err)
	}
	return job
}
