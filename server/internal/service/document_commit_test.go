package service

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// TestDocumentCommit: the file save path of C-01 §14.4 in DOC-005 §3 order,
// on filesfake and the real FileService (local, MinIO).
func TestDocumentCommit(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)

		t.Run("commit points the document at a new version", func(t *testing.T) {
			created := env.createFile(t, member, "q3.pdf", pdfBody("v1"))
			body := pdfBody("v2")
			up := env.upload(t, member, created.Document.ID, "q3-v2.pdf", body)
			if up.ChecksumSHA256 != sha(body) || up.SizeBytes != int64(len(body)) {
				t.Fatalf("upload = %+v, want checksum/size of the bytes", up)
			}
			if d := env.doc(t, created.Document.ID); d.CurrentVersion != 1 {
				t.Fatalf("an upload alone created a version: current_version=%d", d.CurrentVersion)
			}
			res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit")
			if res.Version.Version != 2 || res.Version.Reason != "upload" || res.Version.FileID.String != up.UploadID {
				t.Fatalf("version = %+v", res.Version)
			}
			if res.Document.Revision != created.Document.Revision+1 || res.Document.FileVersionID.String != res.Version.ID ||
				res.Document.CurrentVersion != 2 {
				t.Fatalf("document = rev %d ptr %s cur %d", res.Document.Revision, res.Document.FileVersionID.String, res.Document.CurrentVersion)
			}
			if res.File.ChecksumSHA256 != sha(body) || res.File.SizeBytes != int64(len(body)) || res.File.MimeType != "application/pdf" {
				t.Fatalf("file block = %+v", res.File)
			}
			if res.Access.Level != DocumentLevelManage {
				t.Fatalf("access = %+v, want the creator's manage", res.Access)
			}
			if got := env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, body) {
				t.Fatal("download does not return the committed bytes")
			}
			if got := env.read(t, member, created.Document.ID, 1, DocumentByteRange{}); !bytes.Equal(got, pdfBody("v1")) {
				t.Fatal("version 1 download does not return the first bytes")
			}
			if n := env.countAudit(t, audit.ActionDocumentVersionCreated, created.Document.ID); n != 1 {
				t.Fatalf("audit rows = %d, want 1", n)
			}
			if n := env.countOutbox(t, "document.version_created", created.Document.ID); n != 1 {
				t.Fatalf("outbox rows = %d, want 1", n)
			}
			if env.real != nil {
				if st := env.sessionStatus(t, up.UploadID); st != "claimed" {
					t.Fatalf("committed upload session = %s, want claimed", st)
				}
			}
		})

		t.Run("two saves on one base: one wins, the other conflicts", func(t *testing.T) {
			created := env.createFile(t, member, "base.pdf", pdfBody("base"))
			a := env.upload(t, member, created.Document.ID, "a.pdf", pdfBody("a"))
			b := env.upload(t, member, created.Document.ID, "b.pdf", pdfBody("b"))
			var wg sync.WaitGroup
			errs := make([]error, 2)
			for i, up := range []DocumentUpload{a, b} {
				wg.Add(1)
				go func(i int, id string) {
					defer wg.Done()
					_, errs[i] = env.commit(member, created.Document.ID, id, created.Document.Revision, util.NewID())
				}(i, up.UploadID)
			}
			wg.Wait()
			ok, conflicts := 0, 0
			for _, err := range errs {
				switch {
				case err == nil:
					ok++
				default:
					ce := wantCode(t, err, "document_version_conflict")
					if ce.Status != 409 || ce.Fields["current_revision"] != "2" {
						t.Fatalf("conflict = %+v", ce)
					}
					conflicts++
				}
			}
			if ok != 1 || conflicts != 1 {
				t.Fatalf("ok=%d conflicts=%d, want exactly one of each", ok, conflicts)
			}
			if vs := env.versions(t, created.Document); len(vs) != 2 {
				t.Fatalf("versions = %d, want 2 (no overwrite)", len(vs))
			}
		})

		t.Run("permission revoked between put and commit", func(t *testing.T) {
			created := env.createFile(t, member, "shared.pdf", pdfBody("shared"))
			restricted := created.Document
			if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, restricted.ID); err != nil {
				t.Fatal(err)
			}
			editor := human(env.tn.creator)
			sh := env.f.share(t, restricted, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelEdit, env.tn.member.ID)
			up := env.upload(t, editor, restricted.ID, "edit.pdf", pdfBody("edit"))
			env.f.revoke(t, sh, env.tn.member.ID)
			_, err := env.commit(editor, restricted.ID, up.UploadID, restricted.Revision, util.NewID())
			wantNotFound(t, err)
			d := env.doc(t, restricted.ID)
			if d.Revision != restricted.Revision || d.FileVersionID != restricted.FileVersionID {
				t.Fatal("a refused commit moved the document")
			}
			if env.real != nil {
				if st := env.sessionStatus(t, up.UploadID); st != "staged" {
					t.Fatalf("session after a refused commit = %s, want staged", st)
				}
			}
		})

		t.Run("DB error after the put rolls back and the retry commits once", func(t *testing.T) {
			created := env.createFile(t, member, "flaky.pdf", pdfBody("flaky"))
			up := env.upload(t, member, created.Document.ID, "flaky-v2.pdf", pdfBody("flaky-v2"))
			boom := errors.New("injected failure after claim")
			env.svc.store.afterClaim = func() error { return boom }
			key := util.NewID()
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
			env.svc.store.afterClaim = nil
			if !errors.Is(err, boom) {
				t.Fatalf("want the injected failure, got %v", err)
			}
			d := env.doc(t, created.Document.ID)
			if d.Revision != created.Document.Revision || d.FileVersionID != created.Document.FileVersionID {
				t.Fatal("rollback left a moved pointer")
			}
			if vs := env.versions(t, d); len(vs) != 1 {
				t.Fatalf("versions after rollback = %d, want 1", len(vs))
			}
			if env.real != nil {
				if st := env.sessionStatus(t, up.UploadID); st != "staged" {
					t.Fatalf("session after rollback = %s, want staged", st)
				}
			}
			res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
			mustf(t, err, "retry")
			again, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
			mustf(t, err, "replay")
			if again.Version.ID != res.Version.ID {
				t.Fatalf("replay made another version: %s vs %s", again.Version.ID, res.Version.ID)
			}
			if vs := env.versions(t, d); len(vs) != 2 {
				t.Fatalf("versions after retry = %d, want exactly 2", len(vs))
			}
			// The pointer is not broken: it names a version whose file opens.
			if got := env.read(t, member, d.ID, 0, DocumentByteRange{}); !bytes.Equal(got, pdfBody("flaky-v2")) {
				t.Fatal("pointer after retry does not serve the committed bytes")
			}
		})

		t.Run("an upload committed once cannot be committed again", func(t *testing.T) {
			one := env.createFile(t, member, "one.pdf", pdfBody("one"))
			two := env.createFile(t, member, "two.pdf", pdfBody("two"))
			up := env.upload(t, member, one.Document.ID, "shared-upload.pdf", pdfBody("shared-upload"))
			_, err := env.commit(member, one.Document.ID, up.UploadID, one.Document.Revision, util.NewID())
			mustf(t, err, "first commit")
			_, err = env.commit(member, two.Document.ID, up.UploadID, two.Document.Revision, util.NewID())
			wantCode(t, err, "upload_already_committed")
			// The same document too: a new key is a new command.
			d := env.doc(t, one.Document.ID)
			_, err = env.commit(member, one.Document.ID, up.UploadID, d.Revision, util.NewID())
			wantCode(t, err, "upload_already_committed")
		})

		t.Run("tombstone, visibility, kind and format", func(t *testing.T) {
			created := env.createFile(t, member, "gone.pdf", pdfBody("gone"))
			up := env.upload(t, member, created.Document.ID, "gone-v2.pdf", pdfBody("gone-v2"))
			// A stranger never learns the document exists.
			_, err := env.commit(human(env.tn.bMember), created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			wantNotFound(t, err)
			// An agent never writes directly (ADR 0010).
			_, err = env.commit(agentActor(env.tn.agent), created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("agent commit = %v, want forbidden", err)
			}
			if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET archived_at = now(), archived_by = $2 WHERE id = $1`, created.Document.ID, env.tn.member.ID); err != nil {
				t.Fatal(err)
			}
			_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_deleted"); ce.Status != 410 {
				t.Fatalf("document_deleted status = %d", ce.Status)
			}
			_, err = env.commit(human(env.tn.bMember), created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			wantNotFound(t, err)

			pdfDoc := env.createFile(t, member, "fmt.pdf", pdfBody("fmt"))
			docx := env.upload(t, member, pdfDoc.Document.ID, "fmt.docx", docxBody(t, "fmt"))
			_, err = env.commit(member, pdfDoc.Document.ID, docx.UploadID, pdfDoc.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "unsupported_media_type"); ce.Fields["reason"] != "format_changed" {
				t.Fatalf("format change = %+v", ce)
			}
			_, err = env.commit(member, pdfDoc.Document.ID, "01UNKNOWNUPLOAD00000000000", pdfDoc.Document.Revision, util.NewID())
			wantNotFound(t, err)
		})

		t.Run("engine range", func(t *testing.T) {
			created := env.createFile(t, member, "engine.pdf", pdfBody("engine"))
			up := env.upload(t, member, created.Document.ID, "engine-v2.pdf", pdfBody("engine-v2"))
			_, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
				UploadID: up.UploadID, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
				Engine: DocumentEngineInfo{Name: "genoffice", Version: "genoffice@0000000+uniwork-office.9",
					ContractVersion: office.ContractVersion, ProtocolVersion: "1"},
			})
			wantCode(t, err, "engine_incompatible")
			res, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
				UploadID: up.UploadID, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
				Engine: DocumentEngineInfo{Name: "genoffice", Version: office.TrustedEngineVersion,
					ContractVersion: office.ContractVersion, ProtocolVersion: "1"},
			})
			mustf(t, err, "trusted engine")
			if res.Version.EngineVersion.String != office.TrustedEngineVersion || res.Version.ContractVersion.String != office.ContractVersion {
				t.Fatalf("engine metadata not recorded: %+v", res.Version)
			}
		})

		t.Run("restore points back at the old file", func(t *testing.T) {
			v1 := pdfBody("restore-v1")
			created := env.createFile(t, member, "restore.pdf", v1)
			up := env.upload(t, member, created.Document.ID, "restore-v2.pdf", pdfBody("restore-v2"))
			committed, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit v2")
			before := env.usage(t)
			_, err = env.svc.RestoreFileVersion(ctx, member, created.Document.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
			})
			wantCode(t, err, "document_version_conflict")
			res, err := env.svc.RestoreFileVersion(ctx, member, created.Document.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: committed.Document.Revision, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "restore")
			if res.Version.Version != 3 || res.Version.Reason != "restore" || !res.Version.RestoredFrom.Valid || res.Version.RestoredFrom.Int32 != 1 {
				t.Fatalf("restore version = %+v", res.Version)
			}
			if res.Version.FileID != created.Version.FileID || res.Version.ChecksumSha256 != created.Version.ChecksumSha256 {
				t.Fatal("restore did not point back at the first file")
			}
			if after := env.usage(t); after != before {
				t.Fatalf("restore charged storage: %d -> %d", before, after)
			}
			if got := env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, v1) {
				t.Fatal("restored pointer does not serve the first bytes")
			}
			if n := env.countAudit(t, audit.ActionDocumentVersionRestored, created.Document.ID); n != 1 {
				t.Fatalf("restore audit rows = %d", n)
			}
			_, err = env.svc.RestoreFileVersion(ctx, member, created.Document.ID, RestoreFileVersionInput{
				Version: 42, BaseRevision: res.Document.Revision, IdempotencyKey: util.NewID(),
			})
			wantNotFound(t, err)
		})
	})
}
