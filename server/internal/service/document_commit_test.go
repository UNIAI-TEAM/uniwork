package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
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
			// The same document with a new key: the bytes already are the
			// current version, so UNI-1900 answers 200 with that version
			// instead of upload_already_committed.
			d := env.doc(t, one.Document.ID)
			again, err := env.commit(member, one.Document.ID, up.UploadID, d.Revision, util.NewID())
			mustf(t, err, "re-commit of the current bytes")
			if again.Document.FileVersionID.String != d.FileVersionID.String || again.Document.Revision != d.Revision {
				t.Fatalf("re-commit of current bytes moved the pointer: %+v", again.Document)
			}
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
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 {
				t.Fatalf("document_archived status = %d", ce.Status)
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

// TestDocumentCommitIdenticalBytesIsANoOp is UNI-1900 / G7-08 D-E1: a second
// Save of the same bytes answers 200 with the current version. It does not
// mint a version, move the pointer, bump the revision, write audit or
// outbox, claim the staged upload, or consume quota. Pages still refuse the
// same case with 409 document_version_unchanged; the file path answers 200
// so the web dialog, the frame and a deployed desktop all already treat it
// as saved.
func TestDocumentCommitIdenticalBytesIsANoOp(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		peer := human(env.tn.creator)

		t.Run("D-E1 identical bytes, third save, then different bytes", func(t *testing.T) {
			m := &countingDocMetrics{}
			env.svc.SetMetrics(m)
			t.Cleanup(func() { env.svc.SetMetrics(nil) })

			created := env.createFile(t, member, "de1.pdf", pdfBody("de1-v1"))
			body := pdfBody("de1-same")
			upA := env.upload(t, member, created.Document.ID, "de1-a.pdf", body)
			a, err := env.commit(member, created.Document.ID, upA.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit A")
			if a.Version.Version != 2 {
				t.Fatalf("commit A version = %d, want 2", a.Version.Version)
			}
			auditAfterA := env.countAudit(t, audit.ActionDocumentVersionCreated, created.Document.ID)
			outboxAfterA := env.countOutbox(t, "document.version_created", created.Document.ID)

			upSame := env.upload(t, member, created.Document.ID, "de1-again.pdf", body)
			usageAfterUpload := env.usage(t)
			key := util.NewID()
			res, err := env.commit(member, created.Document.ID, upSame.UploadID, a.Document.Revision, key)
			mustf(t, err, "identical commit")
			assertFileCommitNoOp(t, env, a, res, upSame.UploadID, usageAfterUpload, auditAfterA, outboxAfterA)
			if !containsString(m.saves, "file/unchanged") {
				t.Fatalf("saves = %v, want file/unchanged for the no-op", m.saves)
			}

			replay, err := env.commit(member, created.Document.ID, upSame.UploadID, a.Document.Revision, key)
			mustf(t, err, "replay of the no-op key")
			if replay.Version.ID != a.Version.ID || replay.Document.Revision != a.Document.Revision {
				t.Fatalf("replay = ver %s rev %d, want ver %s rev %d", replay.Version.ID, replay.Document.Revision, a.Version.ID, a.Document.Revision)
			}
			if vs := env.versions(t, created.Document); len(vs) != 2 {
				t.Fatalf("versions after replay = %d, want 2", len(vs))
			}
			got, err := env.svc.LookupCommitIntent(ctx, member, created.Document.ID, key)
			mustf(t, err, "intent lookup")
			if got.Outcome != CommitIntentCommitted || got.VersionID != a.Version.ID ||
				got.Version != a.Version.Version || got.Revision != a.Document.Revision {
				t.Fatalf("lookup = %+v, want committed v%d %s rev %d", got, a.Version.Version, a.Version.ID, a.Document.Revision)
			}

			upThird := env.upload(t, member, created.Document.ID, "de1-third.pdf", body)
			usageThird := env.usage(t)
			third, err := env.commit(member, created.Document.ID, upThird.UploadID, a.Document.Revision, util.NewID())
			mustf(t, err, "third identical save")
			assertFileCommitNoOp(t, env, a, third, upThird.UploadID, usageThird, auditAfterA, outboxAfterA)

			upDiff := env.upload(t, member, created.Document.ID, "de1-diff.pdf", pdfBody("de1-different"))
			diff, err := env.commit(member, created.Document.ID, upDiff.UploadID, a.Document.Revision, util.NewID())
			mustf(t, err, "different bytes")
			if diff.Version.Version != 3 || diff.Version.ID == a.Version.ID || diff.Document.Revision != a.Document.Revision+1 {
				t.Fatalf("different-bytes version = %+v doc rev %d, want v3 new id rev %d", diff.Version, diff.Document.Revision, a.Document.Revision+1)
			}
			if vs := env.versions(t, created.Document); len(vs) != 3 {
				t.Fatalf("versions after different bytes = %d, want 3", len(vs))
			}
		})

		t.Run("frame flag is the same no-op", func(t *testing.T) {
			created := env.createFile(t, member, "de1-frame.pdf", pdfBody("frame-v1"))
			body := pdfBody("frame-same")
			upA := env.upload(t, member, created.Document.ID, "frame-a.pdf", body)
			a, err := env.commit(member, created.Document.ID, upA.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit A")
			upSame := env.upload(t, member, created.Document.ID, "frame-again.pdf", body)
			res, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
				UploadID: upSame.UploadID, BaseRevision: a.Document.Revision, IdempotencyKey: util.NewID(), Frame: true,
			})
			mustf(t, err, "identical frame commit")
			if res.Version.ID != a.Version.ID || res.Document.Revision != a.Document.Revision {
				t.Fatalf("frame no-op = ver %s rev %d, want ver %s rev %d", res.Version.ID, res.Document.Revision, a.Version.ID, a.Document.Revision)
			}
			if vs := env.versions(t, created.Document); len(vs) != 2 {
				t.Fatalf("frame versions = %d, want 2", len(vs))
			}
		})

		t.Run("stale base is still 409", func(t *testing.T) {
			created := env.createFile(t, member, "de1-stale.pdf", pdfBody("stale-v1"))
			up := env.upload(t, member, created.Document.ID, "stale-same.pdf", pdfBody("stale-v1"))
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision-1, util.NewID())
			ce := wantCode(t, err, "document_version_conflict")
			if ce.Status != 409 {
				t.Fatalf("stale identical = %+v, want 409", ce)
			}
			if vs := env.versions(t, created.Document); len(vs) != 1 {
				t.Fatalf("stale identical wrote a version: %d", len(vs))
			}
		})

		t.Run("another holder's lock is still 423", func(t *testing.T) {
			created := env.createFile(t, member, "de1-lock.pdf", pdfBody("lock-v1"))
			_, err := env.svc.AcquireDocumentEditLock(ctx, member, created.Document.ID, AcquireDocumentEditLockInput{
				EditorID: "de1-holder", Client: DocumentEditClientWebPage, SessionID: "sid-de1-holder",
			})
			mustf(t, err, "acquire")
			up := env.upload(t, peer, created.Document.ID, "lock-same.pdf", pdfBody("lock-v1"))
			_, err = env.commit(peer, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_locked"); ce.Status != 423 {
				t.Fatalf("locked identical = %+v, want 423", ce)
			}
			if vs := env.versions(t, created.Document); len(vs) != 1 {
				t.Fatalf("locked identical wrote a version: %d", len(vs))
			}
		})

		t.Run("a consumed upload from another document is still 409", func(t *testing.T) {
			// R1-1: the no-op guard must not swallow upload_already_committed.
			// Upload A is committed into document A, so it is consumed; the
			// same upload_id then reaches document B, whose current version
			// carries the same bytes. The bytes match, but the upload is not
			// B's own current file, so the answer is the contract's refusal.
			// Doc A starts on different bytes, so its commit is a real
			// version that consumes the upload.
			body := pdfBody("de1-cross")
			a := env.createFile(t, member, "de1-cross-a.pdf", pdfBody("de1-cross-v1"))
			up := env.upload(t, member, a.Document.ID, "de1-cross-up.pdf", body)
			committed, err := env.commit(member, a.Document.ID, up.UploadID, a.Document.Revision, util.NewID())
			mustf(t, err, "commit A")
			if committed.Version.FileID.String != up.UploadID {
				t.Fatalf("fixture: commit A did not consume the upload: version file %s, upload %s", committed.Version.FileID.String, up.UploadID)
			}
			b := env.createFile(t, member, "de1-cross-b.pdf", body)
			if b.Version.ChecksumSha256.String != committed.Version.ChecksumSha256.String {
				t.Fatalf("fixture: doc B checksum %q != doc A %q", b.Version.ChecksumSha256.String, committed.Version.ChecksumSha256.String)
			}
			_, err = env.commit(member, b.Document.ID, up.UploadID, b.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "upload_already_committed"); ce.Status != 409 {
				t.Fatalf("consumed upload on another document = %+v, want 409 upload_already_committed", ce)
			}
			d := env.doc(t, b.Document.ID)
			if d.Revision != b.Document.Revision || d.FileVersionID.String != b.Version.ID {
				t.Fatalf("doc B moved: rev %d ptr %s, want rev %d ptr %s", d.Revision, d.FileVersionID.String, b.Document.Revision, b.Version.ID)
			}
			if vs := env.versions(t, b.Document); len(vs) != 1 {
				t.Fatalf("doc B versions = %d, want 1", len(vs))
			}
		})

		t.Run("first version and a row with no checksum still commit", func(t *testing.T) {
			created := env.createFile(t, member, "de1-first.pdf", pdfBody("first-v1"))
			if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET file_version_id = NULL WHERE id = $1`, created.Document.ID); err != nil {
				t.Fatal(err)
			}
			up := env.upload(t, member, created.Document.ID, "first-new.pdf", pdfBody("first-v2"))
			res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "current == nil")
			if res.Version.Version != 2 || res.Version.FileID.String != up.UploadID {
				t.Fatalf("nil current version = %+v, want v2 claiming the upload", res.Version)
			}

			missing := env.createFile(t, member, "de1-nocheck.pdf", pdfBody("nocheck-v1"))
			if _, err := env.f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, missing.Version.ID); err != nil {
				t.Fatal(err)
			}
			upSame := env.upload(t, member, missing.Document.ID, "nocheck-same.pdf", pdfBody("nocheck-v1"))
			grew, err := env.commit(member, missing.Document.ID, upSame.UploadID, missing.Document.Revision, util.NewID())
			mustf(t, err, "missing checksum")
			if grew.Version.Version != 2 || grew.Version.ID == missing.Version.ID {
				t.Fatalf("missing checksum version = %+v, want a new v2", grew.Version)
			}
		})

		t.Run("office job output with identical bytes still commits a version", func(t *testing.T) {
			body := pdfBody("office-same")
			created := env.createFile(t, member, "de1-office.pdf", body)
			job := env.officeJob(t, member, created.Document, body, "completed")
			res, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			mustf(t, err, "office identical output")
			if res.Version.Version != 2 || res.Version.FileID.String != job.OutputFileID.String {
				t.Fatalf("office identical = %+v, want a new version claiming the output", res.Version)
			}
			if got := env.job(t, job.ID); !got.CommittedVersionID.Valid || got.CommittedVersionID.String != res.Version.ID {
				t.Fatalf("job not marked committed: %+v", got)
			}
		})
	})
}

func assertFileCommitNoOp(t *testing.T, env *docStorageEnv, a, res DocumentFileResult, uploadID string, usageAfterUpload int64, auditAfterA, outboxAfterA int) {
	t.Helper()
	if res.Version.ID != a.Version.ID || res.Version.Version != a.Version.Version || res.Document.Revision != a.Document.Revision ||
		res.Document.FileVersionID.String != a.Version.ID {
		t.Fatalf("no-op answer = ver %+v doc rev %d ptr %s, want ver %s v%d rev %d",
			res.Version, res.Document.Revision, res.Document.FileVersionID.String, a.Version.ID, a.Version.Version, a.Document.Revision)
	}
	if res.File.VersionID != a.Version.ID || res.File.ChecksumSHA256 != a.File.ChecksumSHA256 || res.File.Filename != a.File.Filename {
		t.Fatalf("no-op file block = %+v, want current %+v", res.File, a.File)
	}
	if vs := env.versions(t, a.Document); len(vs) != 2 {
		t.Fatalf("versions = %d, want 2", len(vs))
	}
	if n := env.countAudit(t, audit.ActionDocumentVersionCreated, a.Document.ID); n != auditAfterA {
		t.Fatalf("audit rows = %d, want %d", n, auditAfterA)
	}
	if n := env.countOutbox(t, "document.version_created", a.Document.ID); n != outboxAfterA {
		t.Fatalf("outbox rows = %d, want %d", n, outboxAfterA)
	}
	if after := env.usage(t); after != usageAfterUpload {
		t.Fatalf("quota usage %d -> %d after a no-op", usageAfterUpload, after)
	}
	var pointed int
	if err := env.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM document_versions WHERE file_id = $1`, uploadID).Scan(&pointed); err != nil {
		t.Fatal(err)
	}
	if pointed != 0 {
		t.Fatalf("staged upload %s is on %d version rows, want unclaimed", uploadID, pointed)
	}
	if env.real != nil {
		if st := env.sessionStatus(t, uploadID); st != "staged" {
			t.Fatalf("upload session = %s, want staged", st)
		}
	}
}

func containsString(got []string, want string) bool {
	for _, s := range got {
		if s == want {
			return true
		}
	}
	return false
}

// TestArchivedDocumentCommitUploadRestore proves F6 (G5-07): on an archived
// file document, commit, upload staging and file-version restore answer
// 403 document_archived to an actor who could save (its manager and a
// non-manager workspace peer at edit), while an actor below edit - a view-only
// share, or no level at all - gets 404 not_found with no existence leak
// (BEF6-1: the same disclosure rule as the lease path).
func TestArchivedDocumentCommitUploadRestore(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	manager := human(env.tn.member)
	peer := human(env.tn.creator)
	nonMember := human(env.tn.bMember)

	created := env.createFile(t, manager, "archived-save.pdf", pdfBody("v1"))
	v2Up := env.upload(t, manager, created.Document.ID, "archived-save-v2.pdf", pdfBody("v2"))
	v2, err := env.commit(manager, created.Document.ID, v2Up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit v2 before archive")
	stagedBeforeArchive := env.upload(t, manager, created.Document.ID, "archived-save-v3.pdf", pdfBody("v3"))

	_, err = env.svc.ArchiveDocument(ctx, manager, created.Document.ID, ArchiveDocumentInput{})
	mustf(t, err, "archive document")

	for _, tc := range []struct {
		name  string
		actor Actor
	}{
		{"manager", manager},
		{"workspace peer", peer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := env.commit(tc.actor, created.Document.ID, stagedBeforeArchive.UploadID, v2.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 || !errors.Is(err, ErrDocumentArchived) {
				t.Fatalf("commit on archived = %+v (err=%v), want 403 document_archived", ce, err)
			}
			_, err = env.svc.UploadDocumentFile(ctx, tc.actor, created.Document.ID, DocumentUploadInput{
				Filename: "after-archive.pdf", Body: bytes.NewReader(pdfBody("after")),
			})
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 || !errors.Is(err, ErrDocumentArchived) {
				t.Fatalf("upload on archived = %+v (err=%v), want 403 document_archived", ce, err)
			}
			_, err = env.svc.RestoreFileVersion(ctx, tc.actor, created.Document.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: v2.Document.Revision, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 || !errors.Is(err, ErrDocumentArchived) {
				t.Fatalf("restore on archived = %+v (err=%v), want 403 document_archived", ce, err)
			}
		})
	}

	// An actor in the same organization who is not a member of the workspace
	// (and has no share) still gets plain not_found on every write path.
	_, err = env.commit(nonMember, created.Document.ID, stagedBeforeArchive.UploadID, v2.Document.Revision, util.NewID())
	wantNotFound(t, err)
	_, err = env.svc.UploadDocumentFile(ctx, nonMember, created.Document.ID, DocumentUploadInput{
		Filename: "stranger.pdf", Body: bytes.NewReader(pdfBody("stranger")),
	})
	wantNotFound(t, err)
	_, err = env.svc.RestoreFileVersion(ctx, nonMember, created.Document.ID, RestoreFileVersionInput{
		Version: 1, BaseRevision: v2.Document.Revision, IdempotencyKey: util.NewID(),
	})
	wantNotFound(t, err)

	// A view-only share learns nothing either: below edit the archived
	// document is not_found on all three routes, while the manager of the
	// same document still gets document_archived (the control).
	viewDoc := env.createFile(t, manager, "archived-view.pdf", pdfBody("view-v1"))
	if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, viewDoc.Document.ID); err != nil {
		t.Fatal(err)
	}
	env.f.share(t, viewDoc.Document, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelView, env.tn.member.ID)
	viewStaged := env.upload(t, manager, viewDoc.Document.ID, "archived-view-v2.pdf", pdfBody("view-v2"))
	_, err = env.svc.ArchiveDocument(ctx, manager, viewDoc.Document.ID, ArchiveDocumentInput{})
	mustf(t, err, "archive view-only document")
	viewer := human(env.tn.creator)
	_, err = env.commit(viewer, viewDoc.Document.ID, viewStaged.UploadID, viewDoc.Document.Revision, util.NewID())
	wantNotFound(t, err)
	_, err = env.svc.UploadDocumentFile(ctx, viewer, viewDoc.Document.ID, DocumentUploadInput{
		Filename: "viewer.pdf", Body: bytes.NewReader(pdfBody("viewer")),
	})
	wantNotFound(t, err)
	_, err = env.svc.RestoreFileVersion(ctx, viewer, viewDoc.Document.ID, RestoreFileVersionInput{
		Version: 1, BaseRevision: viewDoc.Document.Revision, IdempotencyKey: util.NewID(),
	})
	wantNotFound(t, err)
	_, err = env.commit(manager, viewDoc.Document.ID, viewStaged.UploadID, viewDoc.Document.Revision, util.NewID())
	wantCode(t, err, "document_archived")
}

// legacyCFBBody is a minimal OLE CFB header + sector for a legacy .doc/.xls/.ppt
// fixture with a unique marker so checksums differ across tests.
func legacyCFBBody(marker string) []byte {
	b := make([]byte, 1024)
	copy(b, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	binary.LittleEndian.PutUint16(b[24:], 0x003e)
	binary.LittleEndian.PutUint16(b[26:], 0x0003)
	binary.LittleEndian.PutUint16(b[28:], 0xfffe)
	binary.LittleEndian.PutUint16(b[30:], 9)
	binary.LittleEndian.PutUint16(b[32:], 6)
	copy(b[512:], marker)
	return b
}

func xlsxBody(t *testing.T, marker string) []byte {
	t.Helper()
	return docxLike(t, "xl/workbook.xml", "xl/worksheets/"+marker+".xml")
}

func pptxBody(t *testing.T, marker string) []byte {
	t.Helper()
	return docxLike(t, "ppt/presentation.xml", "ppt/slides/"+marker+".xml")
}

// TestDocumentCommitLegacyConversion covers UNI-2213 (C5): committing a
// converted OOXML upload onto a legacy (.doc/.xls/.ppt) document as the next
// version of the same document, plus refusals and unit checks.
func TestDocumentCommitLegacyConversionUnit(t *testing.T) {
	if got, err := normalizeConversion(nil); err != nil || got != nil {
		t.Fatalf("normalizeConversion(nil) = %+v, %v", got, err)
	}
	for _, tc := range []struct {
		from, to string
		wantMime string
	}{
		{" DOC ", " DOCX ", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"xls", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"ppt", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	} {
		got, err := normalizeConversion(&DocumentVersionConversion{FromFormat: tc.from, ToFormat: tc.to})
		if err != nil {
			t.Fatalf("normalizeConversion(%q->%q): %v", tc.from, tc.to, err)
		}
		if mime, ok := ooxmlTargetMime(got.ToFormat); !ok || mime != tc.wantMime {
			t.Fatalf("ooxmlTargetMime(%q) = %q, %v", got.ToFormat, mime, ok)
		}
	}
	for _, bad := range []DocumentVersionConversion{
		{FromFormat: "", ToFormat: "docx"},
		{FromFormat: "pdf", ToFormat: "docx"},
		{FromFormat: "docx", ToFormat: "docx"},
		{FromFormat: "doc", ToFormat: ""},
		{FromFormat: "doc", ToFormat: "pdf"},
		{FromFormat: "doc", ToFormat: "doc"},
	} {
		var ve ValidationError
		if _, err := normalizeConversion(&bad); err == nil {
			t.Fatalf("normalizeConversion(%+v) expected ValidationError", bad)
		} else if !errors.As(err, &ve) || ve.Msg == "" {
			t.Fatalf("normalizeConversion(%+v) = %T (%v), want ValidationError", bad, err, err)
		}
	}

	fpPlain := commitFingerprint("doc-1", 3, "abc", DocumentEngineInfo{})
	fpConvDoc := commitFingerprint("doc-1", 3, "abc", DocumentEngineInfo{}, &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"})
	fpConvXls := commitFingerprint("doc-1", 3, "abc", DocumentEngineInfo{}, &DocumentVersionConversion{FromFormat: "xls", ToFormat: "xlsx"})
	if fpPlain == fpConvDoc || fpConvDoc == fpConvXls {
		t.Fatalf("commitFingerprint must distinguish conversion pairs: plain=%s doc=%s xls=%s", fpPlain, fpConvDoc, fpConvXls)
	}
	for _, tc := range []struct {
		title, from, to string
		wantTitle       string
		wantChanged     bool
	}{
		{"Báo cáo ngân sách.xls", "xls", "xlsx", "Báo cáo ngân sách.xlsx", true},
		{"REPORT.DOC", "doc", "docx", "REPORT.docx", true},
		{"Deck.PpT", "ppt", "pptx", "Deck.pptx", true},
		{"Báo cáo ngân sách", "xls", "xlsx", "Báo cáo ngân sách", false},
		{"x.xls", "doc", "docx", "x.xls", false},
		{"a.xls notes", "xls", "xlsx", "a.xls notes", false},
		{"already.docx", "doc", "docx", "already.docx", false},
		{"backup.xls.bak", "xls", "xlsx", "backup.xls.bak", false},
	} {
		got, changed := rewriteConvertedDocumentTitle(tc.title, tc.from, tc.to)
		if got != tc.wantTitle || changed != tc.wantChanged {
			t.Fatalf("rewriteConvertedDocumentTitle(%q, %q, %q) = (%q, %v), want (%q, %v)",
				tc.title, tc.from, tc.to, got, changed, tc.wantTitle, tc.wantChanged)
		}
	}
}

func TestDocumentCommitLegacyConversion(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	peer := human(env.tn.creator)

	for _, tc := range []struct {
		fromFormat string
		fromName   string
		fromMime   string
		toFormat   string
		toName     string
		toMime     string
		wantFile   string
		buildOOXML func(t *testing.T, marker string) []byte
	}{
		{
			fromFormat: "doc",
			fromName:   "budget.doc",
			fromMime:   "application/msword",
			toFormat:   "docx",
			toName:     "converted.docx",
			toMime:     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			wantFile:   "budget.docx",
			buildOOXML: docxBody,
		},
		{
			fromFormat: "xls",
			fromName:   "sheet.xls",
			fromMime:   "application/vnd.ms-excel",
			toFormat:   "xlsx",
			toName:     "converted.xlsx",
			toMime:     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			wantFile:   "sheet.xlsx",
			buildOOXML: xlsxBody,
		},
		{
			fromFormat: "ppt",
			fromName:   "deck.ppt",
			fromMime:   "application/vnd.ms-powerpoint",
			toFormat:   "pptx",
			toName:     "converted.pptx",
			toMime:     "application/vnd.openxmlformats-officedocument.presentationml.presentation",
			wantFile:   "deck.pptx",
			buildOOXML: pptxBody,
		},
	} {
		t.Run(tc.fromFormat+"_to_"+tc.toFormat, func(t *testing.T) {
			v1Bytes := legacyCFBBody("v1-" + tc.fromFormat)
			created := env.createFile(t, member, tc.fromName, v1Bytes)
			if created.Version.MimeType.String != tc.fromMime {
				t.Fatalf("v1 mime = %q, want %q", created.Version.MimeType.String, tc.fromMime)
			}

			v2Bytes := tc.buildOOXML(t, "v2-"+tc.toFormat)
			up := env.upload(t, member, created.Document.ID, tc.toName, v2Bytes)

			// Without conversion, changing format is still 415 unsupported_media_type (format_changed).
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "unsupported_media_type"); ce.Status != 415 || ce.Fields["reason"] != "format_changed" {
				t.Fatalf("undeclared format change = %+v, want 415 format_changed", ce)
			}

			// With matching conversion, v2 is appended on the same document id.
			key := util.NewID()
			res, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
				UploadID:       up.UploadID,
				BaseRevision:   created.Document.Revision,
				IdempotencyKey: key,
				Conversion: &DocumentVersionConversion{
					FromFormat: tc.fromFormat,
					ToFormat:   tc.toFormat,
				},
			})
			mustf(t, err, "commit converted version")
			if res.Document.ID != created.Document.ID || res.Document.CurrentVersion != 2 || res.Document.Revision != created.Document.Revision+1 {
				t.Fatalf("document = %+v", res.Document)
			}
			wantTitle := "Báo cáo " + tc.wantFile
			if res.Document.Title != wantTitle {
				t.Fatalf("document.title = %q, want %q", res.Document.Title, wantTitle)
			}
			if res.Version.Version != 2 || res.Version.Reason != DocumentVersionReasonConverted {
				t.Fatalf("version = %+v, want v2 reason=%s", res.Version, DocumentVersionReasonConverted)
			}
			if !res.Version.ConvertedFromVersion.Valid || res.Version.ConvertedFromVersion.Int32 != 1 {
				t.Fatalf("converted_from_version = %+v, want 1", res.Version.ConvertedFromVersion)
			}
			if !res.Version.ConvertedFromChecksum.Valid || res.Version.ConvertedFromChecksum.String != sha(v1Bytes) {
				t.Fatalf("converted_from_checksum = %+v, want %s", res.Version.ConvertedFromChecksum, sha(v1Bytes))
			}
			if res.Version.MimeType.String != tc.toMime || res.File.MimeType != tc.toMime {
				t.Fatalf("mime = %q / %q, want %q", res.Version.MimeType.String, res.File.MimeType, tc.toMime)
			}
			if res.File.Filename != tc.wantFile {
				t.Fatalf("file.filename = %q, want %q", res.File.Filename, tc.wantFile)
			}

			// Idempotent replay with same key and conversion returns the same version and rewritten title.
			replay, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
				UploadID:       up.UploadID,
				BaseRevision:   created.Document.Revision,
				IdempotencyKey: key,
				Conversion: &DocumentVersionConversion{
					FromFormat: tc.fromFormat,
					ToFormat:   tc.toFormat,
				},
			})
			mustf(t, err, "replay converted commit")
			if replay.Version.ID != res.Version.ID || replay.Document.Title != wantTitle {
				t.Fatalf("replay version = %s title = %q, want %s %q", replay.Version.ID, replay.Document.Title, res.Version.ID, wantTitle)
			}

			// GET document resolves the rewritten title, search_text, and filename from v1's base name.
			gotDoc, err := env.svc.GetDocument(ctx, member, created.Document.ID)
			mustf(t, err, "get document after conversion")
			if gotDoc.Document.Title != wantTitle || gotDoc.Document.SearchText != documentSearchText(wantTitle, "") {
				t.Fatalf("GetDocument title=%q search_text=%q, want %q / %q",
					gotDoc.Document.Title, gotDoc.Document.SearchText, wantTitle, documentSearchText(wantTitle, ""))
			}
			if gotDoc.File == nil || gotDoc.File.Filename != tc.wantFile || gotDoc.File.MimeType != tc.toMime {
				t.Fatalf("GetDocument file = %+v, want filename=%q mime=%q", gotDoc.File, tc.wantFile, tc.toMime)
			}

			// Download live (version=0) serves v2 OOXML with the rewritten filename;
			// download version=1 serves the original legacy v1 with the original filename.
			dlLive, err := env.svc.OpenDocumentFile(ctx, member, created.Document.ID, 0, DocumentByteRange{}, DocumentAccessDownload)
			mustf(t, err, "open live")
			liveBytes := readBytes(t, dlLive.Reader.Body)
			_ = dlLive.Reader.Close()
			if !bytes.Equal(liveBytes, v2Bytes) || dlLive.Reader.File.Filename != tc.wantFile || dlLive.Version.MimeType.String != tc.toMime {
				t.Fatalf("live download = filename %q mime %q", dlLive.Reader.File.Filename, dlLive.Version.MimeType.String)
			}

			dlV1, err := env.svc.OpenDocumentFile(ctx, member, created.Document.ID, 1, DocumentByteRange{}, DocumentAccessDownload)
			mustf(t, err, "open v1")
			v1Read := readBytes(t, dlV1.Reader.Body)
			_ = dlV1.Reader.Close()
			if !bytes.Equal(v1Read, v1Bytes) || dlV1.Reader.File.Filename != tc.fromName || dlV1.Version.MimeType.String != tc.fromMime {
				t.Fatalf("v1 download = filename %q mime %q", dlV1.Reader.File.Filename, dlV1.Version.MimeType.String)
			}

			// Subsequent OOXML save on v2 commits normally as v3 without conversion.
			v3Bytes := tc.buildOOXML(t, "v3-"+tc.toFormat)
			up3 := env.upload(t, member, created.Document.ID, tc.wantFile, v3Bytes)
			v3, err := env.commit(member, created.Document.ID, up3.UploadID, res.Document.Revision, util.NewID())
			mustf(t, err, "commit v3")
			if v3.Version.Version != 3 || v3.Version.Reason != "upload" {
				t.Fatalf("v3 = %+v", v3.Version)
			}

			// Audit row for the converted commit carries reason=converted_version and provenance.
			var rawChanges, rawMeta []byte
			if err := env.f.pool.QueryRow(ctx,
				`SELECT changes, metadata FROM audit_events WHERE action = $1 AND resource_id = $2 AND changes::jsonb->'reason'->>'to' = $3`,
				audit.ActionDocumentVersionCreated, created.Document.ID, DocumentVersionReasonConverted,
			).Scan(&rawChanges, &rawMeta); err != nil {
				t.Fatal("query audit row:", err)
			}
			var changes map[string]map[string]any
			if err := json.Unmarshal(rawChanges, &changes); err != nil {
				t.Fatal(err)
			}
			if changes["reason"]["to"] != DocumentVersionReasonConverted ||
				changes["converted_from"]["to"] != tc.fromFormat ||
				changes["converted_to"]["to"] != tc.toFormat ||
				changes["title"]["from"] != created.Document.Title ||
				changes["title"]["to"] != wantTitle {
				t.Fatalf("audit changes = %s", rawChanges)
			}
			var meta map[string]any
			if err := json.Unmarshal(rawMeta, &meta); err != nil {
				t.Fatal(err)
			}
			if meta["converted_from"] != tc.fromFormat || meta["converted_to"] != tc.toFormat {
				t.Fatalf("audit metadata = %s", rawMeta)
			}
			// Rename side effects in the same transaction: document.updated audit row + document.updated frame + renamed notice.
			if n := env.countAudit(t, audit.ActionDocumentUpdated, created.Document.ID); n != 1 {
				t.Fatalf("document.updated audit rows = %d, want 1", n)
			}
			if n := env.countOutbox(t, "document.updated", created.Document.ID); n != 1 {
				t.Fatalf("document.updated outbox rows = %d, want 1", n)
			}
		})
	}

	t.Run("title suffix rewrite rules and rename side effects", func(t *testing.T) {
		for _, tc := range []struct {
			name        string
			fromFormat  string
			fromFile    string
			toFormat    string
			toFile      string
			initTitle   string
			wantTitle   string
			wantRenamed bool
			buildOOXML  func(t *testing.T, marker string) []byte
		}{
			{
				name:        "xls title rewritten to xlsx",
				fromFormat:  "xls",
				fromFile:    "bao-cao-ngan-sach.xls",
				toFormat:    "xlsx",
				toFile:      "bao-cao-ngan-sach.xlsx",
				initTitle:   "Báo cáo ngân sách.xls",
				wantTitle:   "Báo cáo ngân sách.xlsx",
				wantRenamed: true,
				buildOOXML:  xlsxBody,
			},
			{
				name:        "uppercase DOC title rewritten to lowercase docx",
				fromFormat:  "doc",
				fromFile:    "report.doc",
				toFormat:    "docx",
				toFile:      "report.docx",
				initTitle:   "REPORT.DOC",
				wantTitle:   "REPORT.docx",
				wantRenamed: true,
				buildOOXML:  docxBody,
			},
			{
				name:        "title without extension unchanged",
				fromFormat:  "xls",
				fromFile:    "sheet.xls",
				toFormat:    "xlsx",
				toFile:      "sheet.xlsx",
				initTitle:   "Báo cáo ngân sách",
				wantTitle:   "Báo cáo ngân sách",
				wantRenamed: false,
				buildOOXML:  xlsxBody,
			},
			{
				name:        "other-family suffix unchanged",
				fromFormat:  "doc",
				fromFile:    "notes.doc",
				toFormat:    "docx",
				toFile:      "notes.docx",
				initTitle:   "x.xls",
				wantTitle:   "x.xls",
				wantRenamed: false,
				buildOOXML:  docxBody,
			},
			{
				name:        "legacy extension in the middle unchanged",
				fromFormat:  "xls",
				fromFile:    "notes.xls",
				toFormat:    "xlsx",
				toFile:      "notes.xlsx",
				initTitle:   "a.xls notes",
				wantTitle:   "a.xls notes",
				wantRenamed: false,
				buildOOXML:  xlsxBody,
			},
		} {
			t.Run(tc.name, func(t *testing.T) {
				v1Bytes := legacyCFBBody("title-v1-" + tc.name)
				created, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
					Title:      tc.initTitle,
					Filename:   tc.fromFile,
					Body:       bytes.NewReader(v1Bytes),
					Visibility: documentVisibilityWorkspace,
				})
				mustf(t, err, "create legacy document")

				v2Bytes := tc.buildOOXML(t, "title-v2-"+tc.name)
				up := env.upload(t, member, created.Document.ID, tc.toFile, v2Bytes)
				res, err := env.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
					UploadID:       up.UploadID,
					BaseRevision:   created.Document.Revision,
					IdempotencyKey: util.NewID(),
					Conversion: &DocumentVersionConversion{
						FromFormat: tc.fromFormat,
						ToFormat:   tc.toFormat,
					},
				})
				mustf(t, err, "commit converted version")
				if res.Document.Title != tc.wantTitle {
					t.Fatalf("response document.title = %q, want %q", res.Document.Title, tc.wantTitle)
				}
				stored := env.doc(t, created.Document.ID)
				if stored.Title != tc.wantTitle {
					t.Fatalf("stored document.title = %q, want %q", stored.Title, tc.wantTitle)
				}
				if stored.SearchText != documentSearchText(tc.wantTitle, "") {
					t.Fatalf("stored search_text = %q, want %q", stored.SearchText, documentSearchText(tc.wantTitle, ""))
				}

				var renamedNotices int
				if err := env.f.pool.QueryRow(ctx,
					`SELECT count(*) FROM outbox_events WHERE topic = 'document.change_noticed' AND payload::jsonb->>'document_id' = $1 AND payload::jsonb->>'verb' = $2`,
					created.Document.ID, docNoticeRenamed,
				).Scan(&renamedNotices); err != nil {
					t.Fatal(err)
				}
				if tc.wantRenamed {
					if n := env.countAudit(t, audit.ActionDocumentUpdated, created.Document.ID); n != 1 {
						t.Fatalf("document.updated audit rows = %d, want 1", n)
					}
					if n := env.countOutbox(t, "document.updated", created.Document.ID); n != 1 {
						t.Fatalf("document.updated outbox rows = %d, want 1", n)
					}
					if renamedNotices != 1 {
						t.Fatalf("renamed change notices = %d, want 1", renamedNotices)
					}
					var rawChanges []byte
					if err := env.f.pool.QueryRow(ctx,
						`SELECT changes FROM audit_events WHERE action = $1 AND resource_id = $2`,
						audit.ActionDocumentUpdated, created.Document.ID,
					).Scan(&rawChanges); err != nil {
						t.Fatal(err)
					}
					var diff map[string]map[string]any
					if err := json.Unmarshal(rawChanges, &diff); err != nil {
						t.Fatal(err)
					}
					if diff["title"]["from"] != tc.initTitle || diff["title"]["to"] != tc.wantTitle {
						t.Fatalf("document.updated audit diff = %s, want title %q -> %q", rawChanges, tc.initTitle, tc.wantTitle)
					}
				} else {
					if n := env.countAudit(t, audit.ActionDocumentUpdated, created.Document.ID); n != 0 {
						t.Fatalf("document.updated audit rows = %d, want 0 when title unchanged", n)
					}
					if n := env.countOutbox(t, "document.updated", created.Document.ID); n != 0 {
						t.Fatalf("document.updated outbox rows = %d, want 0 when title unchanged", n)
					}
					if renamedNotices != 0 {
						t.Fatalf("renamed change notices = %d, want 0 when title unchanged", renamedNotices)
					}
				}
			})
		}
	})

	t.Run("refusals: not_legacy, target_mismatch, not_ooxml, no save back to legacy, viewer", func(t *testing.T) {
		// 1. Live version is already OOXML (.docx) -> 422 not_legacy.
		docxDoc := env.createFile(t, member, "already.docx", docxBody(t, "already-v1"))
		upDocx := env.upload(t, member, docxDoc.Document.ID, "already-v2.docx", docxBody(t, "already-v2"))
		_, err := env.svc.CommitFileVersion(ctx, member, docxDoc.Document.ID, CommitFileVersionInput{
			UploadID:       upDocx.UploadID,
			BaseRevision:   docxDoc.Document.Revision,
			IdempotencyKey: util.NewID(),
			Conversion:     &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"},
		})
		if ce := wantCode(t, err, "legacy_conversion_invalid"); ce.Status != 422 || ce.Fields["reason"] != "not_legacy" {
			t.Fatalf("already docx with conversion = %+v, want 422 not_legacy", ce)
		}

		// 2. Live version is PDF -> 422 not_legacy.
		pdfDoc := env.createFile(t, member, "file.pdf", pdfBody("pdf-v1"))
		upPdfDocx := env.upload(t, member, pdfDoc.Document.ID, "file.docx", docxBody(t, "from-pdf"))
		_, err = env.svc.CommitFileVersion(ctx, member, pdfDoc.Document.ID, CommitFileVersionInput{
			UploadID:       upPdfDocx.UploadID,
			BaseRevision:   pdfDoc.Document.Revision,
			IdempotencyKey: util.NewID(),
			Conversion:     &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"},
		})
		if ce := wantCode(t, err, "legacy_conversion_invalid"); ce.Status != 422 || ce.Fields["reason"] != "not_legacy" {
			t.Fatalf("pdf with conversion = %+v, want 422 not_legacy", ce)
		}

		// 3. Cross-family pair on a .doc (doc->xlsx, or xls->xlsx on a .doc) -> 422 target_mismatch.
		legacyDoc := env.createFile(t, member, "cross.doc", legacyCFBBody("cross-doc"))
		upXlsx := env.upload(t, member, legacyDoc.Document.ID, "cross.xlsx", xlsxBody(t, "cross-xlsx"))
		for _, conv := range []DocumentVersionConversion{
			{FromFormat: "doc", ToFormat: "xlsx"},
			{FromFormat: "xls", ToFormat: "xlsx"},
		} {
			_, err = env.svc.CommitFileVersion(ctx, member, legacyDoc.Document.ID, CommitFileVersionInput{
				UploadID:       upXlsx.UploadID,
				BaseRevision:   legacyDoc.Document.Revision,
				IdempotencyKey: util.NewID(),
				Conversion:     &conv,
			})
			if ce := wantCode(t, err, "legacy_conversion_invalid"); ce.Status != 422 || ce.Fields["reason"] != "target_mismatch" {
				t.Fatalf("cross pair %+v on .doc = %+v, want 422 target_mismatch", conv, ce)
			}
		}

		// 4. Staged upload is not target OOXML (e.g. a PDF or an XLSX when claiming doc->docx) -> 422 not_ooxml.
		upPdf := env.upload(t, member, legacyDoc.Document.ID, "not-ooxml.pdf", pdfBody("not-ooxml"))
		for _, badUploadID := range []string{upPdf.UploadID, upXlsx.UploadID} {
			_, err = env.svc.CommitFileVersion(ctx, member, legacyDoc.Document.ID, CommitFileVersionInput{
				UploadID:       badUploadID,
				BaseRevision:   legacyDoc.Document.Revision,
				IdempotencyKey: util.NewID(),
				Conversion:     &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"},
			})
			if ce := wantCode(t, err, "legacy_conversion_invalid"); ce.Status != 422 || ce.Fields["reason"] != "not_ooxml" {
				t.Fatalf("non-docx upload with doc->docx = %+v, want 422 not_ooxml", ce)
			}
		}

		// 5. No save back to legacy: once converted to .docx, uploading a .doc is refused (415 without conversion, 400/422 with conversion).
		upGoodDocx := env.upload(t, member, legacyDoc.Document.ID, "cross.docx", docxBody(t, "good-docx"))
		convRes, err := env.svc.CommitFileVersion(ctx, member, legacyDoc.Document.ID, CommitFileVersionInput{
			UploadID:       upGoodDocx.UploadID,
			BaseRevision:   legacyDoc.Document.Revision,
			IdempotencyKey: util.NewID(),
			Conversion:     &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"},
		})
		mustf(t, err, "convert cross.doc to cross.docx")
		upBackToDoc := env.upload(t, member, legacyDoc.Document.ID, "back.doc", legacyCFBBody("back-to-doc"))
		_, err = env.commit(member, legacyDoc.Document.ID, upBackToDoc.UploadID, convRes.Document.Revision, util.NewID())
		if ce := wantCode(t, err, "unsupported_media_type"); ce.Status != 415 || ce.Fields["reason"] != "format_changed" {
			t.Fatalf("save back to .doc without conversion = %+v, want 415 format_changed", ce)
		}

		// 6. Viewer cannot convert (403 forbidden).
		restrictedDoc := env.createFile(t, member, "viewer.doc", legacyCFBBody("viewer-doc"))
		if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, restrictedDoc.Document.ID); err != nil {
			t.Fatal(err)
		}
		env.f.share(t, restrictedDoc.Document, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelView, env.tn.member.ID)
		upViewer := env.upload(t, member, restrictedDoc.Document.ID, "viewer.docx", docxBody(t, "viewer-docx"))
		_, err = env.svc.CommitFileVersion(ctx, peer, restrictedDoc.Document.ID, CommitFileVersionInput{
			UploadID:       upViewer.UploadID,
			BaseRevision:   restrictedDoc.Document.Revision,
			IdempotencyKey: util.NewID(),
			Conversion:     &DocumentVersionConversion{FromFormat: "doc", ToFormat: "docx"},
		})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer conversion commit = %v, want ErrForbidden", err)
		}
	})
}
