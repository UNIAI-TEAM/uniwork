package service

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestContentBaseCurrent: the closed range [content_revision, revision].
func TestContentBaseCurrent(t *testing.T) {
	d := db.Document{ContentRevision: 3, Revision: 5}
	for base, want := range map[int64]bool{2: false, 3: true, 4: true, 5: true, 6: false} {
		if got := contentBaseCurrent(d, base); got != want {
			t.Errorf("base %d: got %v, want %v", base, got, want)
		}
	}
}

// TestDocumentContentRevision: OQ-P1 (a1, contract-p0 §7.1). A file commit,
// an office job commit and a version restore accept a base between the
// document's content_revision and revision, so a metadata-only bump (move,
// unarchive, rename) never turns an unchanged-content save into a conflict;
// a content change since the base is still document_version_conflict.
func TestDocumentContentRevision(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)

		t.Run("a new document starts with content_revision = revision", func(t *testing.T) {
			created := env.createFile(t, member, "fresh.pdf", pdfBody("fresh"))
			if d := env.doc(t, created.Document.ID); d.ContentRevision != d.Revision {
				t.Fatalf("file: content_revision %d, revision %d", d.ContentRevision, d.Revision)
			}
			p := env.page(t, member, json.RawMessage(`{"type":"doc","content":[]}`))
			if d := env.doc(t, p.Document.ID); d.ContentRevision != d.Revision {
				t.Fatalf("page: content_revision %d, revision %d", d.ContentRevision, d.Revision)
			}
		})

		// T-8: the move-then-save rule is exercised on BOTH commit routes - the
		// web path (Sync false) and the desktop/dispatch path (Sync true, the
		// office_sync_write-gated route G5-07). The compare is shared, but the
		// card's wording is "dispatch", so the sync route is driven literally.
		for _, dispatch := range []struct {
			name string
			sync bool
		}{{"web", false}, {"desktop/dispatch", true}} {
			t.Run("move then "+dispatch.name+" commit is committed", func(t *testing.T) {
				created := env.createFile(t, member, "moved-"+dispatch.name+".pdf", pdfBody("moved-v1"))
				parent := env.page(t, member, json.RawMessage(`{"type":"doc","content":[]}`))
				moved, err := env.svc.MoveDocument(ctx, member, created.Document.ID, MoveDocumentInput{
					ParentID: parent.Document.ID, Revision: created.Document.Revision, IdempotencyKey: util.NewID(),
				})
				mustf(t, err, "move")
				if moved.Document.Revision <= created.Document.Revision {
					t.Fatalf("move did not bump revision: %d", moved.Document.Revision)
				}
				if moved.Document.ContentRevision != created.Document.ContentRevision {
					t.Fatalf("move changed content_revision: %d -> %d", created.Document.ContentRevision, moved.Document.ContentRevision)
				}
				up := env.upload(t, member, created.Document.ID, "moved-v2.pdf", pdfBody("moved-v2"))
				res, err := env.commitSync(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID(), dispatch.sync)
				mustf(t, err, "commit on the pre-move base")
				if res.Document.Revision != moved.Document.Revision+1 || res.Document.ContentRevision != res.Document.Revision {
					t.Fatalf("after commit: revision %d content_revision %d", res.Document.Revision, res.Document.ContentRevision)
				}
			})
		}

		t.Run("unarchive then save is saved", func(t *testing.T) {
			created := env.createFile(t, member, "trash.pdf", pdfBody("trash-v1"))
			_, err := env.svc.ArchiveDocument(ctx, member, created.Document.ID, ArchiveDocumentInput{})
			mustf(t, err, "archive")
			restored, err := env.svc.RestoreDocument(ctx, member, created.Document.ID, ArchiveDocumentInput{})
			mustf(t, err, "unarchive")
			if restored.View.Document.Revision <= created.Document.Revision {
				t.Fatalf("unarchive did not bump revision: %d", restored.View.Document.Revision)
			}
			if restored.View.Document.ContentRevision != created.Document.ContentRevision {
				t.Fatal("unarchive changed content_revision")
			}
			up := env.upload(t, member, created.Document.ID, "trash-v2.pdf", pdfBody("trash-v2"))
			_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "save on the pre-archive base")
		})

		t.Run("rename then save is saved", func(t *testing.T) {
			created := env.createFile(t, member, "rename.pdf", pdfBody("rename-v1"))
			title := "Báo cáo đổi tên"
			renamed, err := env.svc.UpdateDocument(ctx, member, created.Document.ID, UpdateDocumentInput{
				Revision: created.Document.Revision, Title: &title,
			})
			mustf(t, err, "rename")
			if renamed.Document.Revision <= created.Document.Revision || renamed.Document.ContentRevision != created.Document.ContentRevision {
				t.Fatalf("rename: revision %d content_revision %d", renamed.Document.Revision, renamed.Document.ContentRevision)
			}
			up := env.upload(t, member, created.Document.ID, "rename-v2.pdf", pdfBody("rename-v2"))
			_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "save on the pre-rename base")
		})

		t.Run("a content commit in between still conflicts, even after a move", func(t *testing.T) {
			created := env.createFile(t, member, "race.pdf", pdfBody("race-v1"))
			winner := env.upload(t, member, created.Document.ID, "race-a.pdf", pdfBody("race-a"))
			won, err := env.commit(member, created.Document.ID, winner.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "winning commit")
			title := "Báo cáo sau commit"
			_, err = env.svc.UpdateDocument(ctx, member, created.Document.ID, UpdateDocumentInput{
				Revision: won.Document.Revision, Title: &title,
			})
			mustf(t, err, "rename after the winner")
			loser := env.upload(t, member, created.Document.ID, "race-b.pdf", pdfBody("race-b"))
			_, err = env.commit(member, created.Document.ID, loser.UploadID, created.Document.Revision, util.NewID())
			if ce := wantCode(t, err, "document_version_conflict"); ce.Status != 409 {
				t.Fatalf("conflict status = %d", ce.Status)
			}
			// The winner's own base after the rename is still good.
			_, err = env.commit(member, created.Document.ID, loser.UploadID, won.Document.Revision, util.NewID())
			mustf(t, err, "commit on the winner's revision")
		})

		t.Run("a base newer than revision conflicts", func(t *testing.T) {
			created := env.createFile(t, member, "future.pdf", pdfBody("future"))
			up := env.upload(t, member, created.Document.ID, "future-v2.pdf", pdfBody("future-v2"))
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision+1, util.NewID())
			wantCode(t, err, "document_version_conflict")
		})

		t.Run("the office job path takes the same rule", func(t *testing.T) {
			created := env.createFile(t, member, "job.pdf", pdfBody("job-v1"))
			job := env.officeJob(t, member, created.Document, pdfBody("job-v2"), "completed")
			title := "Báo cáo job"
			_, err := env.svc.UpdateDocument(ctx, member, created.Document.ID, UpdateDocumentInput{
				Revision: created.Document.Revision, Title: &title,
			})
			mustf(t, err, "rename while the job ran")
			_, err = env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
			mustf(t, err, "job commit after a rename")

			// A content commit in between is still a conflict for the job.
			other := env.createFile(t, member, "job-race.pdf", pdfBody("job-race-v1"))
			late := env.officeJob(t, member, other.Document, pdfBody("job-race-v2"), "completed")
			up := env.upload(t, member, other.Document.ID, "job-race-up.pdf", pdfBody("job-race-up"))
			_, err = env.commit(member, other.Document.ID, up.UploadID, other.Document.Revision, util.NewID())
			mustf(t, err, "winning upload")
			_, err = env.commit(member, other.Document.ID, late.OutputFileID.String, other.Document.Revision, util.NewID())
			wantCode(t, err, "document_version_conflict")
		})

		t.Run("restore takes the same rule", func(t *testing.T) {
			created := env.createFile(t, member, "restore-rule.pdf", pdfBody("rr-v1"))
			up := env.upload(t, member, created.Document.ID, "restore-rule-v2.pdf", pdfBody("rr-v2"))
			committed, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit v2")
			title := "Báo cáo khôi phục"
			_, err = env.svc.UpdateDocument(ctx, member, created.Document.ID, UpdateDocumentInput{
				Revision: committed.Document.Revision, Title: &title,
			})
			mustf(t, err, "rename")
			// The pre-commit base is behind a content change: conflict.
			_, err = env.svc.RestoreFileVersion(ctx, member, created.Document.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
			})
			wantCode(t, err, "document_version_conflict")
			// The post-commit, pre-rename base only missed metadata: restored.
			res, err := env.svc.RestoreFileVersion(ctx, member, created.Document.ID, RestoreFileVersionInput{
				Version: 1, BaseRevision: committed.Document.Revision, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "restore on the pre-rename base")
			if res.Document.ContentRevision != res.Document.Revision {
				t.Fatalf("restore: content_revision %d revision %d", res.Document.ContentRevision, res.Document.Revision)
			}
			if got := env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, pdfBody("rr-v1")) {
				t.Fatal("restore did not point back at the first bytes")
			}
		})

		t.Run("page content writes move content_revision, a rename does not", func(t *testing.T) {
			p := env.page(t, member, json.RawMessage(`{"type":"doc","content":[]}`))
			saved := env.save(t, member, p.Document.ID, p.Document.Revision,
				json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"một"}]}]}`))
			if saved.Document.ContentRevision != saved.Document.Revision {
				t.Fatalf("content PATCH: content_revision %d revision %d", saved.Document.ContentRevision, saved.Document.Revision)
			}
			title := "Trang mới"
			renamed, err := env.svc.UpdateDocument(ctx, member, p.Document.ID, UpdateDocumentInput{
				Revision: saved.Document.Revision, Title: &title,
			})
			mustf(t, err, "rename page")
			if renamed.Document.ContentRevision != saved.Document.ContentRevision {
				t.Fatalf("page rename moved content_revision: %d -> %d", saved.Document.ContentRevision, renamed.Document.ContentRevision)
			}
		})
	})
}

// TestDocumentsContentRevisionGuard (BE-I1-4): the DB trigger closes the
// rolling-deploy window. An old-binary content write names neither
// content_revision nor the trigger, so the trigger moves the column with its
// revision bump and a commit on the base it superseded is
// document_version_conflict; a metadata-only bump leaves the column; and the
// current binary's explicit SET is assigned the same value, never bumped
// twice.
func TestDocumentsContentRevisionGuard(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)

		t.Run("an old-binary content write moves content_revision", func(t *testing.T) {
			created := env.createFile(t, member, "guard.pdf", pdfBody("guard-v1"))
			// The previous binary's SetDocumentFileVersion shape: the pointer
			// and the revision, no content_revision.
			if _, err := env.f.pool.Exec(ctx, `
				UPDATE documents SET file_version_id = $1, current_version = current_version + 1, revision = revision + 1
				WHERE id = $2`, util.NewID(), created.Document.ID); err != nil {
				t.Fatal(err)
			}
			d := env.doc(t, created.Document.ID)
			if d.Revision != created.Document.Revision+1 || d.ContentRevision != d.Revision {
				t.Fatalf("after the old-binary write: revision %d content_revision %d, want both %d",
					d.Revision, d.ContentRevision, created.Document.Revision+1)
			}
			up := env.upload(t, member, created.Document.ID, "guard-v2.pdf", pdfBody("guard-v2"))
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			wantCode(t, err, "document_version_conflict")
		})

		t.Run("a metadata-only bump leaves content_revision", func(t *testing.T) {
			created := env.createFile(t, member, "guard-meta.pdf", pdfBody("meta-v1"))
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET title = 'Báo cáo guard', revision = revision + 1 WHERE id = $1`, created.Document.ID); err != nil {
				t.Fatal(err)
			}
			d := env.doc(t, created.Document.ID)
			if d.ContentRevision != created.Document.ContentRevision {
				t.Fatalf("a metadata bump moved content_revision: %d -> %d", created.Document.ContentRevision, d.ContentRevision)
			}
			up := env.upload(t, member, created.Document.ID, "guard-meta-v2.pdf", pdfBody("meta-v2"))
			_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit on the pre-metadata base")
		})

		t.Run("the explicit content_revision SET is not double bumped", func(t *testing.T) {
			created := env.createFile(t, member, "guard-new.pdf", pdfBody("new-v1"))
			up := env.upload(t, member, created.Document.ID, "guard-new-v2.pdf", pdfBody("new-v2"))
			res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
			mustf(t, err, "commit")
			if res.Document.ContentRevision != res.Document.Revision {
				t.Fatalf("file commit: content_revision %d revision %d (double bump?)", res.Document.ContentRevision, res.Document.Revision)
			}
			p := env.page(t, member, json.RawMessage(`{"type":"doc","content":[]}`))
			saved := env.save(t, member, p.Document.ID, p.Document.Revision,
				json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hai"}]}]}`))
			if saved.Document.ContentRevision != saved.Document.Revision {
				t.Fatalf("page PATCH: content_revision %d revision %d (double bump?)", saved.Document.ContentRevision, saved.Document.Revision)
			}
		})
	})
}
