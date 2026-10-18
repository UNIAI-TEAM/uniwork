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
		t.Run("a .txt engine output commit keeps text/plain and .txt across storage backends", func(t *testing.T) {
			env.svc.SetFlags(staticDocFlags{"office_txt_open": true})
			t.Cleanup(func() { env.svc.SetFlags(nil) })
			created := env.createFile(t, member, "ghi-chu.txt", []byte("dong 1\ndong 2\n"))
			eng := newScriptedEngine()
			eng.fake = env.fake
			jobs := NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc,
				MaxDeadline: time.Minute,
			})
			row, err := jobs.StartOfficeJobForDocument(context.Background(), member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start .txt job")
			if row.Format != string(office.FormatMD) {
				t.Fatalf(".txt job format = %q, want %q", row.Format, office.FormatMD)
			}
			out := []byte("dong 1\ndong 2 engine\n")
			eng.finish(t, row.ID, out, "text/plain")
			done, err := jobs.GetOfficeJob(context.Background(), member, created.Document.OrganizationID, created.Document.WorkspaceID, row.ID)
			mustf(t, err, "refresh .txt job")
			res, err := env.commit(member, created.Document.ID, done.OutputFileID.String, done.BaseRevision, util.NewID())
			mustf(t, err, "commit .txt job output")
			if res.File.MimeType != "text/plain" || res.File.Filename != "ghi-chu.txt" {
				t.Fatalf("committed .txt file = %+v", res.File)
			}
			caps, err := jobs.Capability(context.Background(), member, created.Document.ID)
			mustf(t, err, "capability after .txt commit")
			if caps.Format != office.FormatMD {
				t.Fatalf("capability format after .txt commit = %q, want %q", caps.Format, office.FormatMD)
			}
			frame := NewOfficeFrameService(env.svc, "office-frame-test-secret-0123456789abcdef")
			tok, err := frame.Mint(context.Background(), member, created.Document.ID)
			mustf(t, err, "mint frame after .txt commit")
			if tok.Claims.ModuleName() != OfficeFrameModuleMarkdown {
				t.Fatalf("frame module after .txt commit = %q, want %q", tok.Claims.ModuleName(), OfficeFrameModuleMarkdown)
			}
			opened, err := frame.Open(context.Background(), tok.Claims)
			mustf(t, err, "open frame after .txt commit")
			if opened.Module != OfficeFrameModuleMarkdown || opened.File.MimeType != "text/plain" || opened.File.Filename != "ghi-chu.txt" {
				t.Fatalf("opened frame after .txt commit = %+v", opened)
			}

			// BE-UN02-13: a second consecutive .txt engine commit and its
			// idempotent replay keep ghi-chu.txt + text/plain and match a fresh GET.
			row2, err := jobs.StartOfficeJobForDocument(context.Background(), member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start second .txt job")
			eng.finish(t, row2.ID, []byte("dong 1\ndong 2 engine v3\n"), "text/plain")
			done2, err := jobs.GetOfficeJob(context.Background(), member, created.Document.OrganizationID, created.Document.WorkspaceID, row2.ID)
			mustf(t, err, "refresh second .txt job")
			secondKey := util.NewID()
			res2, err := env.commit(member, created.Document.ID, done2.OutputFileID.String, done2.BaseRevision, secondKey)
			mustf(t, err, "commit second .txt job output")
			if res2.Version.Version != 3 || res2.File.MimeType != "text/plain" || res2.File.Filename != "ghi-chu.txt" {
				t.Fatalf("second committed .txt file = %+v (version %d)", res2.File, res2.Version.Version)
			}
			replay2, err := env.commit(member, created.Document.ID, done2.OutputFileID.String, done2.BaseRevision, secondKey)
			mustf(t, err, "replay second .txt job commit")
			if replay2.Version.ID != res2.Version.ID || replay2.File.MimeType != "text/plain" || replay2.File.Filename != "ghi-chu.txt" {
				t.Fatalf("replayed second .txt file = %+v", replay2.File)
			}
			view2, err := env.svc.GetDocument(context.Background(), member, created.Document.ID)
			mustf(t, err, "read .txt document after second commit")
			if view2.File == nil || view2.File.Filename != res2.File.Filename || view2.File.MimeType != res2.File.MimeType {
				t.Fatalf("fresh GET after second .txt commit = %+v, want %+v", view2.File, res2.File)
			}

			// BE-UN02-15: markdown Recents include the engine-committed .txt
			// while the flag is on and exclude it once the flag is turned off.
			recentsOn, err := frame.Recents(context.Background(), tok.Claims, 20)
			mustf(t, err, "recents with flag on")
			foundOn := false
			for _, d := range recentsOn {
				if d.ID == created.Document.ID {
					foundOn = true
					break
				}
			}
			if !foundOn {
				t.Fatalf("markdown Recents with flag on missing %s: %+v", created.Document.ID, recentsOn)
			}
			env.svc.SetFlags(staticDocFlags{"office_txt_open": false})
			recentsOff, err := frame.Recents(context.Background(), tok.Claims, 20)
			mustf(t, err, "recents with flag off")
			for _, d := range recentsOff {
				if d.ID == created.Document.ID {
					t.Fatalf("markdown Recents with flag off still includes %s", created.Document.ID)
				}
			}
		})

		t.Run("a restored .txt engine version recovers its .txt identity across intervening plain uploads", func(t *testing.T) {
			env.svc.SetFlags(staticDocFlags{"office_txt_open": true})
			t.Cleanup(func() { env.svc.SetFlags(nil) })
			created := env.createFile(t, member, "notes.txt", []byte("notes v1\n"))
			eng := newScriptedEngine()
			eng.fake = env.fake
			jobs := NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc,
				MaxDeadline: time.Minute,
			})
			row, err := jobs.StartOfficeJobForDocument(context.Background(), member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start notes.txt job")
			eng.finish(t, row.ID, []byte("notes v2 engine\n"), "text/plain")
			done, err := jobs.GetOfficeJob(context.Background(), member, created.Document.OrganizationID, created.Document.WorkspaceID, row.ID)
			mustf(t, err, "refresh notes.txt job")
			v2, err := env.commit(member, created.Document.ID, done.OutputFileID.String, done.BaseRevision, util.NewID())
			mustf(t, err, "commit notes.txt engine v2")

			up3 := env.upload(t, member, created.Document.ID, "server.log", []byte("2026-10-18 plain log\n"))
			v3, err := env.commit(member, created.Document.ID, up3.UploadID, v2.Document.Revision, util.NewID())
			mustf(t, err, "commit server.log v3")
			if v3.Version.Version != 3 || v3.File.Filename != "server.log" || v3.File.MimeType != "text/plain" {
				t.Fatalf("v3 = %+v / %+v", v3.Version, v3.File)
			}

			v4, err := env.svc.RestoreFileVersion(context.Background(), member, created.Document.ID, RestoreFileVersionInput{
				Version: 2, BaseRevision: v3.Document.Revision, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "restore v2 as v4")
			if v4.Version.Version != 4 || v4.Version.RestoredFrom.Int32 != 2 {
				t.Fatalf("v4 = %+v", v4.Version)
			}
			view, err := env.svc.GetDocument(context.Background(), member, created.Document.ID)
			mustf(t, err, "get document at v4")
			if view.File == nil || view.File.Filename != "notes.txt" || view.File.MimeType != "text/plain" {
				t.Fatalf("restored v4 document file = %+v, want notes.txt + text/plain", view.File)
			}
			caps, err := jobs.Capability(context.Background(), member, created.Document.ID)
			mustf(t, err, "capability at restored v4")
			if caps.Format != office.FormatMD {
				t.Fatalf("capability format at restored v4 = %q, want %q", caps.Format, office.FormatMD)
			}
			frame := NewOfficeFrameService(env.svc, "office-frame-test-secret-0123456789abcdef")
			tok, err := frame.Mint(context.Background(), member, created.Document.ID)
			mustf(t, err, "mint frame at restored v4")
			opened, err := frame.Open(context.Background(), tok.Claims)
			mustf(t, err, "open frame at restored v4")
			if opened.Module != OfficeFrameModuleMarkdown || opened.File.Filename != "notes.txt" || opened.File.MimeType != "text/plain" {
				t.Fatalf("opened frame at restored v4 = %+v", opened)
			}
		})

		// A non-txt engine output resolves by its version mime, so nothing
		// renames it: the document keeps the provider output's placeholder
		// name ("file", FS-C1 §4) exactly as before the .txt fix.
		t.Run("a markdown engine output keeps the provider placeholder name", func(t *testing.T) {
			created := env.createFile(t, member, "ghi-chu.md", []byte("# Ghi chu\n"))
			eng := newScriptedEngine()
			eng.fake = env.fake
			jobs := NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc,
				MaxDeadline: time.Minute,
			})
			row, err := jobs.StartOfficeJobForDocument(context.Background(), member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start md job")
			eng.finish(t, row.ID, []byte("# Ghi chu engine\n"), "text/markdown")
			done, err := jobs.GetOfficeJob(context.Background(), member, created.Document.OrganizationID, created.Document.WorkspaceID, row.ID)
			mustf(t, err, "refresh md job")
			res, err := env.commit(member, created.Document.ID, done.OutputFileID.String, done.BaseRevision, util.NewID())
			mustf(t, err, "commit md job output")
			if res.File.MimeType != "text/markdown" || res.File.Filename != "file" {
				t.Fatalf("committed md file = %+v, want the placeholder name", res.File)
			}
			view, err := env.svc.GetDocument(context.Background(), member, created.Document.ID)
			mustf(t, err, "read md document")
			if view.File == nil || view.File.Filename != "file" {
				t.Fatalf("md document file = %+v, want the placeholder name", view.File)
			}

			// BE-UN02-12: flag off, notes.markdown sniffs as text/plain; its
			// engine output keeps the placeholder "file" on commit and GET, and
			// capability answers format_not_supported as at c86c3565d.
			env.svc.SetFlags(nil)
			mdPlain := env.createFile(t, member, "notes.markdown", []byte("# Notes\n"))
			if mdPlain.File.MimeType != "text/plain" {
				t.Fatalf("notes.markdown initial mime = %q, want text/plain", mdPlain.File.MimeType)
			}
			mdRow, err := jobs.StartOfficeJobForDocument(context.Background(), member, mdPlain.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start notes.markdown job")
			eng.finish(t, mdRow.ID, []byte("# Notes engine\n"), "text/plain")
			mdDone, err := jobs.GetOfficeJob(context.Background(), member, mdPlain.Document.OrganizationID, mdPlain.Document.WorkspaceID, mdRow.ID)
			mustf(t, err, "refresh notes.markdown job")
			mdRes, err := env.commit(member, mdPlain.Document.ID, mdDone.OutputFileID.String, mdDone.BaseRevision, util.NewID())
			mustf(t, err, "commit notes.markdown job output")
			if mdRes.File.MimeType != "text/plain" || mdRes.File.Filename != "file" {
				t.Fatalf("committed notes.markdown file = %+v, want file + text/plain", mdRes.File)
			}
			mdView, err := env.svc.GetDocument(context.Background(), member, mdPlain.Document.ID)
			mustf(t, err, "read notes.markdown document")
			if mdView.File == nil || mdView.File.Filename != "file" || mdView.File.MimeType != "text/plain" {
				t.Fatalf("notes.markdown document file = %+v, want file + text/plain", mdView.File)
			}
			if _, err := jobs.Capability(context.Background(), member, mdPlain.Document.ID); err == nil {
				t.Fatal("notes.markdown engine output answered a capability instead of matching c86c3565d")
			} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "format_not_supported" {
				t.Fatalf("notes.markdown engine output refusal = %+v", ee)
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
