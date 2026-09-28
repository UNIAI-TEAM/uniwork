package service

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentUpload: bytes in through FileService, the editor format check,
// bytes out through the authorized proxy (the @files-smoke round trip).
func TestDocumentUpload(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)

		t.Run("create a file document and download the same bytes", func(t *testing.T) {
			body := sizedPDF("smoke", 300<<10)
			res := env.createFile(t, member, "bao-cao.pdf", body)
			if res.Document.Kind != DocumentKindFile || res.Document.CurrentVersion != 1 || res.Document.Revision != 1 {
				t.Fatalf("document = %+v", res.Document)
			}
			if res.File.ChecksumSHA256 != sha(body) || res.File.SizeBytes != int64(len(body)) ||
				res.File.MimeType != "application/pdf" || res.File.Filename != "bao-cao.pdf" {
				t.Fatalf("file block = %+v", res.File)
			}
			if res.Access.Level != DocumentLevelManage || res.Document.AclOwnerID.String != env.tn.member.ID {
				t.Fatalf("creator access = %+v acl=%v", res.Access, res.Document.AclOwnerID)
			}
			got := env.read(t, member, res.Document.ID, 0, DocumentByteRange{})
			if sha(got) != sha(body) {
				t.Fatalf("@files-smoke: downloaded checksum %s, uploaded %s", sha(got), sha(body))
			}
			part := env.read(t, member, res.Document.ID, 0, DocumentByteRange{Offset: 5, Length: 10})
			if !bytes.Equal(part, body[5:15]) {
				t.Fatalf("range read = %q, want %q", part, body[5:15])
			}
			if n := env.accessLogs(t, res.Document.ID, DocumentAccessDownload); n != 1 {
				t.Fatalf("download access-log rows = %d, want 1 (reads coalesce within 5 minutes)", n)
			}
		})

		t.Run("readers outside the document see nothing", func(t *testing.T) {
			res := env.createFile(t, member, "private.pdf", pdfBody("private"))
			for _, u := range []db.User{env.tn.bMember, env.tn.outsider, env.tn.deact} {
				_, err := env.svc.OpenDocumentFile(ctx, human(u), res.Document.ID, 0, DocumentByteRange{})
				if err == nil {
					t.Fatalf("%s read a document outside their workspace", u.ID)
				}
				_, err = env.svc.UploadDocumentFile(ctx, human(u), res.Document.ID, DocumentUploadInput{Filename: "x.pdf", Body: bytes.NewReader(pdfBody("x"))})
				if err == nil {
					t.Fatalf("%s uploaded into a document outside their workspace", u.ID)
				}
			}
			other := env.f.tenant(t, "g103o"+strings.ToLower(util.NewID()[21:]))
			_, err := env.svc.OpenDocumentFile(ctx, human(other.owner), res.Document.ID, 0, DocumentByteRange{})
			wantNotFound(t, err)
		})

		t.Run("a broken file is refused and canceled", func(t *testing.T) {
			res := env.createFile(t, member, "strict.pdf", pdfBody("strict"))
			broken := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("x"), 4096)...)
			_, err := env.svc.UploadDocumentFile(ctx, member, res.Document.ID, DocumentUploadInput{Filename: "broken.pdf", Body: bytes.NewReader(broken)})
			if ce := wantCode(t, err, "unsupported_media_type"); ce.Status != 415 || ce.Fields["reason"] != "pdf_trailer" {
				t.Fatalf("broken pdf = %+v", ce)
			}
			_, err = env.svc.UploadDocumentFile(ctx, member, res.Document.ID, DocumentUploadInput{
				Filename: "tool.pdf", Body: bytes.NewReader(append([]byte("MZ\x90\x00"), make([]byte, 60)...)),
			})
			wantCode(t, err, "unsupported_media_type")
			_, err = env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
				Filename: "empty-docx.docx", Body: bytes.NewReader(docxBodyWithout(t)),
			})
			wantCode(t, err, "unsupported_media_type")
		})

		t.Run("a canceled upload cannot be committed", func(t *testing.T) {
			res := env.createFile(t, member, "cancel.pdf", pdfBody("cancel"))
			up := env.upload(t, member, res.Document.ID, "cancel-v2.pdf", pdfBody("cancel-v2"))
			scope := files.Scope{OrganizationID: res.Document.OrganizationID, WorkspaceID: res.Document.WorkspaceID}
			if err := env.fs.CancelUpload(ctx, files.CancelInput{Actor: member, Scope: scope, FileID: files.FileID(up.UploadID)}); err != nil {
				t.Fatal(err)
			}
			_, err := env.commit(member, res.Document.ID, up.UploadID, res.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_upload_invalid"); ce.Fields["reason"] != files.CodeUploadCanceled {
				t.Fatalf("canceled upload = %+v", ce)
			}
		})

		t.Run("page asset", func(t *testing.T) {
			page := env.f.doc(t, env.tn, docSpec{ws: env.tn.wsA, visibility: "workspace", createdBy: env.tn.member.ID})
			img := pngBody(t, 12, 7)
			asset, err := env.svc.UploadDocumentAsset(ctx, member, page.ID, DocumentUploadInput{Filename: "so-do.png", Body: bytes.NewReader(img)})
			mustf(t, err, "asset upload")
			if asset.MimeType != "image/png" || asset.SizeBytes != int64(len(img)) || asset.Width.Int32 != 12 || asset.Height.Int32 != 7 {
				t.Fatalf("asset = %+v", asset)
			}
			rd, err := env.svc.OpenDocumentAsset(ctx, member, page.ID, asset.ID, DocumentByteRange{})
			mustf(t, err, "asset open")
			got := readBytes(t, rd.Body)
			_ = rd.Close()
			if !bytes.Equal(got, img) {
				t.Fatal("asset bytes differ")
			}
			if n := env.countAudit(t, audit.ActionDocumentAssetUploaded, page.ID); n != 1 {
				t.Fatalf("asset audit rows = %d", n)
			}
			_, err = env.svc.OpenDocumentAsset(ctx, human(env.tn.bMember), page.ID, asset.ID, DocumentByteRange{})
			wantNotFound(t, err)
			// A page takes images, a file document does not take assets.
			fileDoc := env.createFile(t, member, "noasset.pdf", pdfBody("noasset"))
			_, err = env.svc.UploadDocumentAsset(ctx, member, fileDoc.Document.ID, DocumentUploadInput{Filename: "a.png", Body: bytes.NewReader(img)})
			if err == nil {
				t.Fatal("a file document accepted an asset")
			}
			_, err = env.svc.UploadDocumentAsset(ctx, member, page.ID, DocumentUploadInput{Filename: "notes.pdf", Body: bytes.NewReader(pdfBody("asset"))})
			wantCode(t, err, "unsupported_media_type")
		})
	})
}

func docxBodyWithout(t *testing.T) []byte {
	t.Helper()
	// Content types and word/ styles, but no word/document.xml: FileService
	// verifies DOCX from the parts it sees, the editor needs the main part.
	return docxLike(t, "word/styles.xml")
}

// TestDocumentIdempotency: DOC-005 §3.1 on the commit path.
func TestDocumentIdempotency(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		created := env.createFile(t, member, "idem.pdf", pdfBody("idem"))
		doc := created.Document

		t.Run("same key and payload replays one version", func(t *testing.T) {
			d := env.doc(t, doc.ID)
			up := env.upload(t, member, d.ID, "idem-v2.pdf", pdfBody("idem-v2"))
			key := util.NewID()
			var wg sync.WaitGroup
			results := make([]DocumentFileResult, 3)
			errs := make([]error, 3)
			for i := range results {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					results[i], errs[i] = env.commit(member, d.ID, up.UploadID, d.Revision, key)
				}(i)
			}
			wg.Wait()
			for i, err := range errs {
				mustf(t, err, "commit %d", i)
				if results[i].Version.ID != results[0].Version.ID || results[i].Document.Revision != results[0].Document.Revision {
					t.Fatalf("replay %d answered differently: %s vs %s", i, results[i].Version.ID, results[0].Version.ID)
				}
			}
			if vs := env.versions(t, d); len(vs) != int(d.CurrentVersion)+1 {
				t.Fatalf("versions = %d, want exactly one new", len(vs))
			}
		})

		t.Run("a replayed create answers with the access held now", func(t *testing.T) {
			key := util.NewID()
			in := func() CreateFileDocumentInput {
				return CreateFileDocumentInput{Title: "Idem create", Filename: "idem-create.pdf",
					Body: bytes.NewReader(pdfBody("idem-create")), IdempotencyKey: key}
			}
			first, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, in())
			mustf(t, err, "create")
			again, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, in())
			mustf(t, err, "replay")
			if again.Document.ID != first.Document.ID || again.Access.Level != DocumentLevelManage {
				t.Fatalf("replay = %s %+v, want %s with manage", again.Document.ID, again.Access, first.Document.ID)
			}
			// Restricted and no longer the ACL owner: the member cannot see
			// the document any more, so the replay is not found.
			if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				first.Document.ID, env.tn.wsAdmin.ID); err != nil {
				t.Fatal(err)
			}
			_, err = env.svc.CreateFileDocument(ctx, member, env.tn.wsA, in())
			wantNotFound(t, err)
		})

		t.Run("same key, different payload is refused", func(t *testing.T) {
			d := env.doc(t, doc.ID)
			a := env.upload(t, member, d.ID, "a.pdf", pdfBody("idem-a"))
			b := env.upload(t, member, d.ID, "b.pdf", pdfBody("idem-b"))
			key := util.NewID()
			_, err := env.commit(member, d.ID, a.UploadID, d.Revision, key)
			mustf(t, err, "first")
			_, err = env.commit(member, d.ID, b.UploadID, d.Revision, key)
			if ce := wantCode(t, err, "idempotency_payload_mismatch"); ce.Status != 409 {
				t.Fatalf("mismatch status = %d", ce.Status)
			}
			// A different base with the same bytes is a different payload too.
			_, err = env.commit(member, d.ID, a.UploadID, d.Revision+1, key)
			wantCode(t, err, "idempotency_payload_mismatch")
		})

		t.Run("same key, different actor is refused", func(t *testing.T) {
			d := env.doc(t, doc.ID)
			up := env.upload(t, member, d.ID, "actor.pdf", pdfBody("idem-actor"))
			key := util.NewID()
			_, err := env.commit(member, d.ID, up.UploadID, d.Revision, key)
			mustf(t, err, "first")
			_, err = env.commit(human(env.tn.wsAdmin), d.ID, up.UploadID, d.Revision, key)
			wantCode(t, err, "idempotency_key_reuse")
		})

		t.Run("a ledger row without fingerprint never replays", func(t *testing.T) {
			d := env.doc(t, doc.ID)
			up := env.upload(t, member, d.ID, "legacy.pdf", pdfBody("idem-legacy"))
			key := util.NewID()
			if _, err := env.f.q.InsertIdempotencyKey(ctx, db.InsertIdempotencyKeyParams{
				ID: util.NewID(), OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
				Scope: idempotencyScopeDocumentVersionCommit, Key: key, ActorID: env.tn.member.ID,
			}); err != nil {
				t.Fatal(err)
			}
			if err := env.f.q.CompleteIdempotencyKey(ctx, db.CompleteIdempotencyKeyParams{
				ResponseStatus: pgInt4(200), ResponseBody: []byte(`{}`), OrganizationID: d.OrganizationID,
				WorkspaceID: d.WorkspaceID, Scope: idempotencyScopeDocumentVersionCommit, Key: key,
			}); err != nil {
				t.Fatal(err)
			}
			_, err := env.commit(member, d.ID, up.UploadID, d.Revision, key)
			wantCode(t, err, "idempotency_payload_mismatch")
			if env.doc(t, d.ID).Revision != d.Revision {
				t.Fatal("a refused replay moved the document")
			}
		})

		t.Run("a claimed key without an answer is in flight", func(t *testing.T) {
			d := env.doc(t, doc.ID)
			up := env.upload(t, member, d.ID, "flight.pdf", pdfBody("idem-flight"))
			key := util.NewID()
			if _, err := env.f.q.InsertIdempotencyKey(ctx, db.InsertIdempotencyKeyParams{
				ID: util.NewID(), OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
				Scope: idempotencyScopeDocumentVersionCommit, Key: key, ActorID: env.tn.member.ID,
				PayloadFingerprint: pgText(commitFingerprint(d.ID, d.Revision, up.ChecksumSHA256, DocumentEngineInfo{})),
			}); err != nil {
				t.Fatal(err)
			}
			_, err := env.commit(member, d.ID, up.UploadID, d.Revision, key)
			wantCode(t, err, "idempotency_in_flight")
		})

		t.Run("idempotency is decided before the permission re-check", func(t *testing.T) {
			created := env.createFile(t, member, "order.pdf", pdfBody("order"))
			d := created.Document
			if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, d.ID); err != nil {
				t.Fatal(err)
			}
			editor := human(env.tn.creator)
			sh := env.f.share(t, d, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelEdit, env.tn.member.ID)
			up := env.upload(t, editor, d.ID, "order-v2.pdf", pdfBody("order-v2"))
			key := util.NewID()
			first, err := env.commit(editor, d.ID, up.UploadID, d.Revision, key)
			mustf(t, err, "commit")
			if first.Access.Level != DocumentLevelEdit {
				t.Fatalf("first access = %+v", first.Access)
			}
			// Downgraded to view: DOC-005 puts idempotency before the
			// permission re-check, so the write that already happened is
			// replayed - with the access the caller holds now.
			env.f.revoke(t, sh, env.tn.member.ID)
			view := env.f.share(t, d, DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelView, env.tn.member.ID)
			again, err := env.commit(editor, d.ID, up.UploadID, d.Revision, key)
			mustf(t, err, "replay after a downgrade")
			if again.Version.ID != first.Version.ID || again.Access.Level != DocumentLevelView {
				t.Fatalf("replay = version %s access %+v, want %s with view", again.Version.ID, again.Access, first.Version.ID)
			}
			// A new command from the viewer is refused.
			other := env.upload(t, member, d.ID, "order-v3.pdf", pdfBody("order-v3"))
			_, err = env.commit(editor, d.ID, other.UploadID, env.doc(t, d.ID).Revision, util.NewID())
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("viewer commit = %v, want forbidden", err)
			}
			// View is gone too: the document is not visible at all, and the
			// stored answer is not handed to someone who lost access.
			env.f.revoke(t, view, env.tn.member.ID)
			_, err = env.commit(editor, d.ID, up.UploadID, d.Revision, key)
			wantNotFound(t, err)
		})
	})
}

// TestDocumentQuota: storage.bytes counts page bytes and each held file once,
// reserves uploads through the FileService hook, and never lets two parallel
// uploads pass the limit together.
func TestDocumentQuota(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		base := env.usage(t)

		body1 := sizedPDF("quota-1", 40<<10)
		created := env.createFile(t, member, "quota.pdf", body1)
		if got := env.usage(t); got != base+int64(len(body1)) {
			t.Fatalf("usage after create = %d, want %d", got, base+int64(len(body1)))
		}
		snap, err := env.ent.Snapshot(ctx, env.tn.orgID)
		mustf(t, err, "snapshot")
		if e, ok := lookup(snap.Entitlements, FeatureStorageBytes); !ok || !e.Metered || e.Current != env.usage(t) {
			t.Fatalf("storage.bytes entitlement = %+v", e)
		}

		t.Run("commit over the limit is refused and changes nothing", func(t *testing.T) {
			d := env.doc(t, created.Document.ID)
			used := env.usage(t)
			body2 := sizedPDF("quota-2", 30<<10)
			if env.real != nil {
				// The real FileService reserves at upload: the refusal comes
				// before a byte is stored.
				env.setStorageLimit(t, used+int64(len(body2))-1)
				_, err := env.svc.UploadDocumentFile(ctx, member, d.ID, DocumentUploadInput{Filename: "big.pdf", Body: bytes.NewReader(body2)})
				if ce := wantCode(t, err, "quota_exceeded"); ce.Status != 403 {
					t.Fatalf("quota status = %d", ce.Status)
				}
				env.setStorageLimit(t, 1<<40)
			}
			up := env.upload(t, member, d.ID, "big.pdf", body2)
			env.setStorageLimit(t, used+int64(len(body2))-1)
			if env.real != nil {
				// The reservation of the staged upload already counts.
				if got := env.usage(t); got != used+int64(len(body2)) {
					t.Fatalf("usage with a staged upload = %d, want %d", got, used+int64(len(body2)))
				}
			}
			_, err := env.commit(member, d.ID, up.UploadID, d.Revision, util.NewID())
			if ce := wantCode(t, err, "quota_exceeded"); ce.Status != 403 {
				t.Fatalf("commit quota status = %d", ce.Status)
			}
			if env.doc(t, d.ID).Revision != d.Revision {
				t.Fatal("a refused commit moved the document")
			}
			env.setStorageLimit(t, used+int64(len(body2)))
			_, err = env.commit(member, d.ID, up.UploadID, d.Revision, util.NewID())
			mustf(t, err, "commit at exactly the limit")
			if got := env.usage(t); got != used+int64(len(body2)) {
				t.Fatalf("usage after commit = %d, want %d (no double count of the reservation)", got, used+int64(len(body2)))
			}
		})

		t.Run("restore and repeated references count a file once", func(t *testing.T) {
			d := env.doc(t, created.Document.ID)
			used := env.usage(t)
			env.setStorageLimit(t, used) // full: only a no-byte restore may pass
			res, err := env.svc.RestoreFileVersion(ctx, member, d.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: d.Revision, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "restore at a full quota")
			_, err = env.svc.RestoreFileVersion(ctx, member, d.ID, RestoreFileVersionInput{
				Version: 2, BaseRevision: res.Document.Revision, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "second restore")
			if got := env.usage(t); got != used {
				t.Fatalf("usage after restores = %d, want %d", got, used)
			}
			env.setStorageLimit(t, 1<<40)
		})

		t.Run("two parallel uploads cannot pass the limit together", func(t *testing.T) {
			realOnly(t, env)
			d := env.doc(t, created.Document.ID)
			used := env.usage(t)
			size := 20 << 10
			env.setStorageLimit(t, used+int64(size)+int64(size)/2) // room for one
			var wg sync.WaitGroup
			errs := make([]error, 2)
			for i := range errs {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					_, errs[i] = env.svc.UploadDocumentFile(ctx, member, d.ID, DocumentUploadInput{
						Filename: "p.pdf", Body: bytes.NewReader(sizedPDF("parallel-"+string(rune('a'+i)), size)),
					})
				}(i)
			}
			wg.Wait()
			ok, refused := 0, 0
			for _, err := range errs {
				if err == nil {
					ok++
					continue
				}
				wantCode(t, err, "quota_exceeded")
				refused++
			}
			if ok != 1 || refused != 1 {
				t.Fatalf("parallel uploads ok=%d refused=%d, want 1/1", ok, refused)
			}
			if got := env.usage(t); got > used+int64(size)+int64(size)/2 {
				t.Fatalf("usage %d passed the limit", got)
			}
			env.setStorageLimit(t, 1<<40)
		})

		t.Run("a repeated hook call reserves once", func(t *testing.T) {
			realOnly(t, env)
			d := env.doc(t, created.Document.ID)
			up := env.upload(t, member, d.ID, "twice.pdf", sizedPDF("twice", 8<<10))
			used := env.usage(t) // includes the reservation
			env.setStorageLimit(t, used)
			for i := 0; i < 2; i++ {
				if err := env.ent.ReserveFileBytes(ctx, d.OrganizationID, files.FileID(up.UploadID), up.SizeBytes); err != nil {
					t.Fatalf("hook call %d at a full quota: %v", i, err)
				}
			}
			if got := env.usage(t); got != used {
				t.Fatalf("usage after repeated hook calls = %d, want %d", got, used)
			}
			env.setStorageLimit(t, 1<<40)
			scope := files.Scope{OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID}
			mustf(t, env.fs.CancelUpload(ctx, files.CancelInput{Actor: member, Scope: scope, FileID: files.FileID(up.UploadID)}), "cancel")
		})

		t.Run("a reservation ends with its upload", func(t *testing.T) {
			realOnly(t, env)
			d := env.doc(t, created.Document.ID)
			used := env.usage(t)
			up := env.upload(t, member, d.ID, "drop.pdf", sizedPDF("drop", 10<<10))
			if got := env.usage(t); got != used+up.SizeBytes {
				t.Fatalf("reserved usage = %d, want %d", got, used+up.SizeBytes)
			}
			scope := files.Scope{OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID}
			mustf(t, env.fs.CancelUpload(ctx, files.CancelInput{Actor: member, Scope: scope, FileID: files.FileID(up.UploadID)}), "cancel")
			if got := env.usage(t); got != used {
				t.Fatalf("usage after cancel = %d, want %d", got, used)
			}
			// The refused (canceled) broken upload never leaves a reservation.
			_, err := env.svc.UploadDocumentFile(ctx, member, d.ID, DocumentUploadInput{
				Filename: "broken.pdf", Body: bytes.NewReader(append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("y"), 2048)...)),
			})
			wantCode(t, err, "unsupported_media_type")
			if got := env.usage(t); got != used {
				t.Fatalf("usage after a refused file = %d, want %d", got, used)
			}
			// Tasks do not meter storage.bytes: the hook ignores other purposes.
			_, err = env.fs.Upload(ctx, files.UploadInput{
				Actor: member, Purpose: files.TaskAttachment, Scope: scope, IdempotencyKey: util.NewID(),
				Filename: "task.pdf", Body: bytes.NewReader(pdfBody("task")),
			})
			mustf(t, err, "task upload")
			if got := env.usage(t); got != used {
				t.Fatalf("a task attachment moved storage.bytes: %d -> %d", used, got)
			}
		})
	})
}

// TestDocumentReferences: the Documents providers hold every committed file
// (current, old, archived), the collector keeps them, and an upload nobody
// committed stays collectable.
func TestDocumentReferences(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		created := env.createFile(t, member, "refs.pdf", pdfBody("refs-1"))
		up := env.upload(t, member, created.Document.ID, "refs-2.pdf", pdfBody("refs-2"))
		committed, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
		mustf(t, err, "commit")
		orphan := env.upload(t, member, created.Document.ID, "orphan.pdf", pdfBody("refs-orphan"))
		page := env.f.doc(t, env.tn, docSpec{ws: env.tn.wsA, visibility: "workspace", createdBy: env.tn.member.ID})
		asset, err := env.svc.UploadDocumentAsset(ctx, member, page.ID, DocumentUploadInput{Filename: "a.png", Body: bytes.NewReader(pngBody(t, 2, 2))})
		mustf(t, err, "asset")

		old, cur := files.FileID(created.Version.FileID.String), files.FileID(committed.Version.FileID.String)
		holds, err := DocumentVersionReferenceProvider{}.HeldBy(ctx, env.f.q, []files.FileID{old, cur, files.FileID(orphan.UploadID)})
		mustf(t, err, "version holds")
		if holds[cur] != files.HoldActive || holds[old] != files.HoldVersionHistory {
			t.Fatalf("version holds = %v", holds)
		}
		if _, held := holds[files.FileID(orphan.UploadID)]; held {
			t.Fatal("an uncommitted upload is held by a document")
		}
		aholds, err := DocumentAssetReferenceProvider{}.HeldBy(ctx, env.f.q, []files.FileID{files.FileID(asset.FileID)})
		mustf(t, err, "asset holds")
		if aholds[files.FileID(asset.FileID)] != files.HoldActive {
			t.Fatalf("asset holds = %v", aholds)
		}
		if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET archived_at = now(), archived_by = $2 WHERE id = $1`, created.Document.ID, env.tn.member.ID); err != nil {
			t.Fatal(err)
		}
		holds, err = DocumentVersionReferenceProvider{}.HeldBy(ctx, env.f.q, []files.FileID{old, cur})
		mustf(t, err, "archived holds")
		if holds[cur] != files.HoldSoftDeleted || holds[old] != files.HoldSoftDeleted {
			t.Fatalf("archived holds = %v", holds)
		}

		if env.real == nil {
			return
		}
		// The registry opens the Document purposes only with their providers.
		if err := env.real.refs.coverage(env.real.registry); err != nil {
			t.Fatalf("reference coverage with Documents open: %v", err)
		}
		// Even a (wrong) release of committed files does not let the
		// collector take them: it re-asks the providers under lock.
		mustf(t, env.inTx(t, func(q *db.Queries) error { return env.real.ReleaseInTx(ctx, q, []files.FileID{old, cur}) }), "release")
		env.clock.Advance(26 * time.Hour)
		env.clock.Advance(env.real.gc.nextRun(env.clock.Now()).Sub(env.clock.Now()))
		rep, err := env.real.SweepFiles(ctx)
		mustf(t, err, "sweep")
		for _, e := range rep.Entries {
			if (e.FileID == old || e.FileID == cur) && e.Action == FileGCDeleted {
				t.Fatalf("collector deleted committed file %s", e.FileID)
			}
		}
		for _, id := range []files.FileID{old, cur} {
			var status string
			mustf(t, env.f.pool.QueryRow(ctx, `SELECT status FROM files WHERE id = $1`, string(id)).Scan(&status), "status")
			if status != string(files.StatusReady) {
				t.Fatalf("committed file %s is %s after the sweep", id, status)
			}
		}
		var orphanStatus string
		mustf(t, env.f.pool.QueryRow(ctx, `SELECT status FROM files WHERE id = $1`, orphan.UploadID).Scan(&orphanStatus), "orphan")
		if orphanStatus != string(files.StatusDeleted) {
			t.Fatalf("uncommitted upload after the claim window and a sweep = %s, want deleted", orphanStatus)
		}
	})
}

// TestDocumentFileCreateTree (G1-04b, UNI-678 r2): a file create under a
// parent is a tree write like a page create - the child inherits the
// parent's visibility, a parent id outside the workspace answers not_found
// without ever being locked, and a replayed key survives losing the parent
// afterwards because the parent check lives inside the transaction behind
// the ledger claim.
func TestDocumentFileCreateTree(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	t.Run("a file under a restricted page inherits its visibility", func(t *testing.T) {
		parent := env.f.treeDoc(t, env.tn, treeDocSpec{ws: env.tn.wsA, visibility: "restricted", aclOwner: env.tn.member.ID, createdBy: env.tn.member.ID})
		res, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
			ParentID: parent.ID, Filename: "child.pdf", Body: bytes.NewReader(pdfBody("r2-restricted-child")), IdempotencyKey: util.NewID(),
		})
		mustf(t, err, "create under a restricted parent")
		if res.Document.Visibility != "restricted" {
			t.Fatalf("file visibility = %q, want the parent's restricted", res.Document.Visibility)
		}
		if res.Document.ParentID.String != parent.ID {
			t.Fatalf("parent_id = %v, want %s", res.Document.ParentID, parent.ID)
		}
		// An ordinary member without a share cannot read the child.
		_, err = env.svc.OpenDocumentFile(ctx, human(env.tn.creator), res.Document.ID, 0, DocumentByteRange{})
		wantNotFound(t, err)
	})

	t.Run("a foreign-workspace parent id is not found", func(t *testing.T) {
		parent := env.f.treeDoc(t, env.tn, treeDocSpec{ws: env.tn.wsB, visibility: "workspace", aclOwner: env.tn.aclOwner.ID, createdBy: env.tn.aclOwner.ID})
		_, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
			ParentID: parent.ID, Filename: "x.pdf", Body: bytes.NewReader(pdfBody("r2-foreign-parent")), IdempotencyKey: util.NewID(),
		})
		wantNotFound(t, err)
	})

	t.Run("a replayed create survives losing the parent", func(t *testing.T) {
		parent := env.f.treeDoc(t, env.tn, treeDocSpec{ws: env.tn.wsA, visibility: "workspace", aclOwner: env.tn.member.ID, createdBy: env.tn.member.ID})
		key := util.NewID()
		in := func() CreateFileDocumentInput {
			return CreateFileDocumentInput{ParentID: parent.ID, Title: "Lặp", Filename: "replay.pdf",
				Body: bytes.NewReader(pdfBody("r2-replay-parent")), IdempotencyKey: key}
		}
		first, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, in())
		mustf(t, err, "create")
		// The parent drops out of the caller's reach after the commit; the
		// retried key still replays the committed child (R2-03).
		if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`, parent.ID, env.tn.wsAdmin.ID); err != nil {
			t.Fatal(err)
		}
		again, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, in())
		mustf(t, err, "replay after losing the parent")
		if again.Document.ID != first.Document.ID {
			t.Fatalf("replay = %s, want %s", again.Document.ID, first.Document.ID)
		}
	})

	t.Run("a create racing the parent's archive never orphans", func(t *testing.T) {
		// R1-02: the workspace tree lock serializes the two - either the
		// file lands first and joins the archive batch, or the archive
		// lands first and the create finds the parent gone. A live file
		// under an archived parent is the one impossible outcome.
		for i := 0; i < 4; i++ {
			parent := env.f.treeDoc(t, env.tn, treeDocSpec{ws: env.tn.wsA, visibility: "workspace", aclOwner: env.tn.member.ID, createdBy: env.tn.member.ID})
			start := make(chan struct{})
			var wg sync.WaitGroup
			var createErr error
			var createdID string
			var batch string
			wg.Add(2)
			go func() {
				defer wg.Done()
				<-start
				res, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
					ParentID: parent.ID, Filename: "race.pdf", Body: bytes.NewReader(pdfBody("r2-race-" + util.NewID())), IdempotencyKey: util.NewID(),
				})
				if err == nil {
					createdID = res.Document.ID
				}
				createErr = err
			}()
			go func() {
				defer wg.Done()
				<-start
				res, err := env.svc.ArchiveDocument(ctx, member, parent.ID, ArchiveDocumentInput{})
				if err == nil {
					batch = res.BatchID
				} else {
					t.Errorf("archive %d: %v", i, err)
				}
			}()
			close(start)
			wg.Wait()
			if p := env.doc(t, parent.ID); !p.ArchivedAt.Valid {
				t.Fatalf("race %d: parent still live", i)
			}
			if createErr != nil {
				wantNotFound(t, createErr)
				continue
			}
			got := env.doc(t, createdID)
			if !got.ArchivedAt.Valid || got.ArchiveBatchID.String != batch {
				t.Fatalf("race %d: created file archived=%v batch=%q, want archived in %q", i, got.ArchivedAt.Valid, got.ArchiveBatchID.String, batch)
			}
		}
	})
}

func (e *docStorageEnv) inTx(t *testing.T, fn func(q *db.Queries) error) error {
	t.Helper()
	ctx := context.Background()
	tx, err := e.f.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(e.f.q.WithTx(tx)); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}
