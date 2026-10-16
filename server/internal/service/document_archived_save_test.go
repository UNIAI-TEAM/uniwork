package service

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// TestUploadRefusalOrder pins what UploadDocumentFile answers per actor class
// now that the preflight (tenant, archived, kind) runs before the permission
// comparison (UNI-1345 BEF6-7): a view-only actor on a live folder or page
// gets the kind refusal, on a live file the permission refusal, on an
// archived file not_found; a manager on an archived folder gets
// document_archived because the tombstone is decided before the kind.
func TestUploadRefusalOrder(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	manager := human(env.tn.member)
	viewer := human(env.tn.creator)
	body := func() DocumentUploadInput {
		return DocumentUploadInput{Filename: "x.pdf", Body: bytes.NewReader(pdfBody("x"))}
	}
	restrictForViewer := func(t *testing.T, id string) {
		t.Helper()
		if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		env.f.share(t, env.doc(t, id), DocumentPrincipalUser, env.tn.creator.ID, DocumentLevelView, env.tn.member.ID)
	}

	folder, err := env.svc.CreatePage(ctx, manager, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	mustf(t, err, "create folder")
	page, err := env.svc.CreatePage(ctx, manager, env.tn.wsA, CreatePageInput{Title: "Trang"})
	mustf(t, err, "create page")
	file := env.createFile(t, manager, "order.pdf", pdfBody("order"))
	restrictForViewer(t, folder.Document.ID)
	restrictForViewer(t, page.Document.ID)
	restrictForViewer(t, file.Document.ID)

	t.Run("view-only on a live folder: 422 folder_not_supported", func(t *testing.T) {
		_, err := env.svc.UploadDocumentFile(ctx, viewer, folder.Document.ID, body())
		if ce := wantCode(t, err, "folder_not_supported"); ce.Status != 422 {
			t.Fatalf("status = %d", ce.Status)
		}
	})
	t.Run("view-only on a live page: 400 validation", func(t *testing.T) {
		_, err := env.svc.UploadDocumentFile(ctx, viewer, page.Document.ID, body())
		var ve ValidationError
		if !errors.As(err, &ve) || ve.Msg != "chỉ tài liệu file nhận phiên bản tệp" {
			t.Fatalf("view-only on a page = %v, want the kind validation", err)
		}
	})
	t.Run("view-only on a live file: 403 forbidden", func(t *testing.T) {
		_, err := env.svc.UploadDocumentFile(ctx, viewer, file.Document.ID, body())
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("view-only on a live file = %v, want forbidden", err)
		}
	})
	t.Run("view-only on an archived file: 404 not_found", func(t *testing.T) {
		archived := env.createFile(t, manager, "order-archived.pdf", pdfBody("order-archived"))
		restrictForViewer(t, archived.Document.ID)
		_, err := env.svc.ArchiveDocument(ctx, manager, archived.Document.ID, ArchiveDocumentInput{})
		mustf(t, err, "archive file")
		_, err = env.svc.UploadDocumentFile(ctx, viewer, archived.Document.ID, body())
		wantNotFound(t, err)
	})
	t.Run("manager on an archived folder: 403 document_archived", func(t *testing.T) {
		gone, err := env.svc.CreatePage(ctx, manager, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục cũ"})
		mustf(t, err, "create folder")
		_, err = env.svc.ArchiveDocument(ctx, manager, gone.Document.ID, ArchiveDocumentInput{})
		mustf(t, err, "archive folder")
		_, err = env.svc.UploadDocumentFile(ctx, manager, gone.Document.ID, body())
		if ce := wantCode(t, err, "document_archived"); ce.Status != 403 {
			t.Fatalf("status = %d", ce.Status)
		}
	})

	// DOC-05 §4: the save routes stay on the content gate. A workspace admin
	// with no read level (AdminScope only) on a live restricted file gets
	// document_restricted with can_break_glass on upload, commit and restore;
	// on an archived one the archived answer comes first (not_found below
	// edit); a member with no read level and no AdminScope is not_found.
	admin := human(env.tn.wsAdmin)
	stranger := human(env.tn.aclOwner)
	restricted := func(t *testing.T, name string) DocumentFileResult {
		t.Helper()
		created := env.createFile(t, manager, name, pdfBody(name))
		if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, created.Document.ID); err != nil {
			t.Fatal(err)
		}
		return created
	}
	saveRoutes := func(t *testing.T, actor Actor, created DocumentFileResult, uploadID string) map[string]error {
		t.Helper()
		id := created.Document.ID
		_, upErr := env.svc.UploadDocumentFile(ctx, actor, id, body())
		_, commitErr := env.commit(actor, id, uploadID, created.Document.Revision, util.NewID())
		_, restoreErr := env.svc.RestoreFileVersion(ctx, actor, id, RestoreFileVersionInput{
			Version: 1, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
		})
		return map[string]error{"upload": upErr, "commit": commitErr, "restore": restoreErr}
	}
	live := restricted(t, "admin-live.pdf")
	liveStaged := env.upload(t, manager, live.Document.ID, "admin-live-v2.pdf", pdfBody("admin-live-v2"))
	t.Run("AdminScope only on a live restricted file: 403 document_restricted", func(t *testing.T) {
		for route, err := range saveRoutes(t, admin, live, liveStaged.UploadID) {
			var ce CodedError
			if !errors.Is(err, ErrDocumentRestricted) || !errors.As(err, &ce) || ce.Status != 403 || ce.Fields["can_break_glass"] != true {
				t.Fatalf("%s = %v (%+v), want 403 document_restricted with can_break_glass", route, err, ce)
			}
		}
	})
	t.Run("no read level and no AdminScope on a live restricted file: 404", func(t *testing.T) {
		for route, err := range saveRoutes(t, stranger, live, liveStaged.UploadID) {
			if !errors.Is(err, ErrNotFound) || errors.Is(err, ErrDocumentRestricted) {
				t.Fatalf("%s = %v, want not_found", route, err)
			}
		}
	})
	t.Run("AdminScope only on an archived restricted file: 404 not_found", func(t *testing.T) {
		gone := restricted(t, "admin-archived.pdf")
		staged := env.upload(t, manager, gone.Document.ID, "admin-archived-v2.pdf", pdfBody("admin-archived-v2"))
		_, err := env.svc.ArchiveDocument(ctx, manager, gone.Document.ID, ArchiveDocumentInput{})
		mustf(t, err, "archive file")
		for route, err := range saveRoutes(t, admin, gone, staged.UploadID) {
			if !errors.Is(err, ErrNotFound) || errors.Is(err, ErrDocumentRestricted) {
				t.Fatalf("%s = %v, want not_found", route, err)
			}
		}
	})
}

// TestArchivedSaveRecheckInTransaction proves the in-transaction gate of
// commit and file restore (UNI-1345 BEF6-2, BEF6-9): when the document is
// archived after the preflight but before the row lock, an edit peer and a
// manager both get 403 document_archived - the answer of the preflight - and
// nothing is written; a commit also releases its intent claim.
func TestArchivedSaveRecheckInTransaction(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	manager := human(env.tn.member)
	for _, actor := range []struct {
		name string
		who  Actor
	}{{"manager", manager}, {"edit peer", human(env.tn.creator)}} {
		archiveNow := func(t *testing.T, id string) {
			t.Helper()
			env.svc.store.beforeSaveLock = func() {
				env.svc.store.beforeSaveLock = nil
				if _, err := env.f.pool.Exec(ctx, `UPDATE documents SET archived_at = now(), archived_by = $2 WHERE id = $1`, id, env.tn.member.ID); err != nil {
					t.Error(err)
				}
			}
			t.Cleanup(func() { env.svc.store.beforeSaveLock = nil })
		}
		unchanged := func(t *testing.T, versions int, id string, revision int64) {
			t.Helper()
			d := env.doc(t, id)
			if got := len(env.versions(t, d)); d.Revision != revision || got != versions {
				t.Fatalf("a refused save wrote: revision %d (was %d), versions %d (was %d)", d.Revision, revision, got, versions)
			}
		}

		t.Run(actor.name+" commit", func(t *testing.T) {
			created := env.createFile(t, manager, "race-commit.pdf", pdfBody("race-commit"))
			id := created.Document.ID
			up := env.upload(t, manager, id, "race-commit-v2.pdf", pdfBody("race-commit-v2"))
			key := util.NewID()
			archiveNow(t, id)
			_, err := env.commit(actor.who, id, up.UploadID, created.Document.Revision, key)
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 || !errors.Is(err, ErrDocumentArchived) {
				t.Fatalf("commit racing an archive = %+v (err=%v), want 403 document_archived", ce, err)
			}
			if !env.doc(t, id).ArchivedAt.Valid {
				t.Fatal("the seam did not archive the row before the lock")
			}
			unchanged(t, 1, id, created.Document.Revision)
			var committed, live int
			if err := env.f.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE state = 'committed'), count(*) FILTER (WHERE claim_expires_at > clock_timestamp())
				FROM document_commit_intents WHERE idempotency_key = $1`, key).Scan(&committed, &live); err != nil {
				t.Fatal(err)
			}
			if committed != 0 || live != 0 {
				t.Fatalf("intent after a refused commit: committed=%d live claims=%d, want a released claim", committed, live)
			}
		})

		t.Run(actor.name+" restore", func(t *testing.T) {
			created := env.createFile(t, manager, "race-restore.pdf", pdfBody("race-restore"))
			id := created.Document.ID
			up := env.upload(t, manager, id, "race-restore-v2.pdf", pdfBody("race-restore-v2"))
			v2, err := env.commit(manager, id, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit v2")
			archiveNow(t, id)
			_, err = env.svc.RestoreFileVersion(ctx, actor.who, id, RestoreFileVersionInput{
				Version: 1, BaseRevision: v2.Document.Revision, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "document_archived"); ce.Status != 403 || !errors.Is(err, ErrDocumentArchived) {
				t.Fatalf("restore racing an archive = %+v (err=%v), want 403 document_archived", ce, err)
			}
			if !env.doc(t, id).ArchivedAt.Valid {
				t.Fatal("the seam did not archive the row before the lock")
			}
			unchanged(t, 2, id, v2.Document.Revision)
		})
	}
}
