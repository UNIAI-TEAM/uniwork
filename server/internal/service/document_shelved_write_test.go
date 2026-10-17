package service

// ARCHIVE-01 (UNI-1845) ar w2: the write block (addendum §3). SH-2 is the
// table: every write path on a shelved document answers ErrDocumentShelved
// (409 document_shelved) to the document's own manager, reads and the
// allowed commands still pass, and a revoke stays allowed while a grant is
// refused (Q-AR2 = a). SH-6 covers the frame token's can_edit and the
// desktop sync commit; SH-7 is the MCP write tools through the service.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// wantShelvedWrite asserts err is the shelved refusal.
func wantShelvedWrite(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrDocumentShelved) {
		t.Fatalf("write on shelved document = %v, want document_shelved", err)
	}
}

// shelve stamps the document shelved through the public command, as the
// manager the rows run as, and returns the row as the commands then see it.
func shelve(t *testing.T, env *docStorageEnv, docID string) db.Document {
	t.Helper()
	if _, err := env.svc.ShelveDocument(env.f.ctx, Human(env.tn.aclOwner.ID), docID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("shelve: %v", err)
	}
	return env.doc(t, docID)
}

// TestShelvedWriteBlock is SH-2: one row per §3 write path, run as the
// document's manager. Anything that leaves the gate's decision
// (document_shelved) must not leak a different answer, so the assertion is
// errors.Is(err, ErrDocumentShelved) - the exact refusal, not "any error".
func TestShelvedWriteBlock(t *testing.T) {
	title := "Đổi tên"
	restricted := "restricted"
	content := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"sửa"}]}]}`)
	// The session rows move a body just over the 20 MiB threshold: the
	// smallest body the routes accept, so no row proves a shape with more
	// bytes than it must.
	const sessionSize = UploadSessionThresholdBytes + 1

	// rows are (write name, fixture builder, command); shelve happens inside
	// the command itself so every row names the document it shelved.
	rows := []struct {
		name string
		run  func(t *testing.T, env *docStorageEnv) error
	}{
		{"patch_title", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.UpdateDocument(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, UpdateDocumentInput{Revision: d.Revision, Title: &title})
			return err
		}},
		{"patch_content_autosave", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.UpdateDocument(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, UpdateDocumentInput{Revision: d.Revision, Content: content})
			return err
		}},
		{"patch_visibility", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.UpdateDocument(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, UpdateDocumentInput{Revision: d.Revision, Visibility: &restricted})
			return err
		}},
		{"version_snapshot", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.CreateDocumentVersion(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, CreateDocumentVersionInput{})
			return err
		}},
		{"version_restore", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			d := shelve(t, env, page.ID)
			_, err := env.svc.RestoreDocumentVersion(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, RestoreDocumentVersionInput{Version: d.CurrentVersion, BaseRevision: d.Revision})
			return err
		}},
		{"file_upload", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "note-"+util.NewID()[20:]+".md", []byte("# doc"))
			d := shelve(t, env, file.Document.ID)
			_, err := env.svc.UploadDocumentFile(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, DocumentUploadInput{Filename: "v2.pdf", Body: bytes.NewReader(pdfBody("sh2-upload"))})
			return err
		}},
		{"file_version_commit", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "note-"+util.NewID()[20:]+".md", []byte("# doc"))
			up := env.upload(t, Human(env.tn.aclOwner.ID), file.Document.ID, "v2.pdf", pdfBody("sh2-commit"))
			d := shelve(t, env, file.Document.ID)
			_, err := env.svc.CommitFileVersion(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: d.Revision})
			return err
		}},
		{"file_version_commit_desktop_sync", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "note-"+util.NewID()[20:]+".md", []byte("# doc"))
			up := env.upload(t, Human(env.tn.aclOwner.ID), file.Document.ID, "v2.pdf", pdfBody("sh2-sync"))
			d := shelve(t, env, file.Document.ID)
			_, err := env.svc.CommitFileVersion(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: d.Revision, Sync: true})
			return err
		}},
		{"file_version_restore", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "note-"+util.NewID()[20:]+".md", []byte("# doc"))
			d := shelve(t, env, file.Document.ID)
			_, err := env.svc.RestoreFileVersion(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, RestoreFileVersionInput{Version: 1, BaseRevision: d.Revision})
			return err
		}},
		{"asset_upload", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.UploadDocumentAsset(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, DocumentUploadInput{Filename: "a.png", Body: bytes.NewReader(pngBody(t, 2, 2))})
			return err
		}},
		{"create_child_page_under_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, folderDoc(t, env).ID)
			_, err := env.svc.CreatePage(env.f.ctx, Human(env.tn.aclOwner.ID), env.tn.wsA, CreatePageInput{ParentID: d.ID, Title: "Con"})
			return err
		}},
		{"create_file_under_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, folderDoc(t, env).ID)
			_, err := env.svc.CreateFileDocument(env.f.ctx, Human(env.tn.aclOwner.ID), env.tn.wsA, CreateFileDocumentInput{ParentID: d.ID, Title: "Tệp con", Filename: "con.pdf", Body: bytes.NewReader(pdfBody("sh2-child"))})
			return err
		}},
		{"blank_into_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, folderDoc(t, env).ID)
			off := NewDocumentOfficeService(DocumentOfficeOptions{Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Documents: env.svc})
			_, err := off.CreateBlankFile(env.f.ctx, Human(env.tn.aclOwner.ID), env.tn.wsA, BlankFileInput{Format: "docx", Title: "Trống", ParentID: d.ID})
			return err
		}},
		{"copy_into_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			src := env.createFile(t, Human(env.tn.aclOwner.ID), "src-"+util.NewID()[20:]+".pdf", pdfBody("sh2-copysrc"))
			d := shelve(t, env, folderDoc(t, env).ID)
			_, err := env.svc.CopyDocument(env.f.ctx, Human(env.tn.aclOwner.ID), src.Document.ID, CopyDocumentInput{Consent: documentCopyConsent, ParentID: d.ID})
			return err
		}},
		{"move_shelved_document", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.MoveDocument(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, MoveDocumentInput{Revision: d.Revision})
			return err
		}},
		{"move_into_shelved_destination", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			dest := shelve(t, env, folderDoc(t, env).ID)
			live := env.doc(t, page.ID)
			_, err := env.svc.MoveDocument(env.f.ctx, Human(env.tn.aclOwner.ID), live.ID, MoveDocumentInput{ParentID: dest.ID, Revision: live.Revision})
			return err
		}},
		{"comment_create", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, AddCommentInput{Body: "vẫn còn?"}, "")
			return err
		}},
		{"comment_edit", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "trước khi lưu trữ"}, "")
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.UpdateDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), c.ID, UpdateCommentInput{Body: "sửa"})
			return err
		}},
		{"comment_delete", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "xoá"}, "")
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.DeleteDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), c.ID)
			return err
		}},
		{"comment_resolve", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "giải quyết"}, "")
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.ResolveDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), c.ID)
			return err
		}},
		{"comment_reopen", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "mở lại"}, "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ResolveDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), c.ID); err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.UnresolveDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), c.ID)
			return err
		}},
		{"comment_reaction_add", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "react"}, "")
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.AddDocumentCommentReaction(env.f.ctx, Human(env.tn.member.ID), c.ID, "👍")
			return err
		}},
		{"comment_reaction_remove", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			c, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, AddCommentInput{Body: "react"}, "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.AddDocumentCommentReaction(env.f.ctx, Human(env.tn.member.ID), c.ID, "👍"); err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			return env.svc.RemoveDocumentCommentReaction(env.f.ctx, Human(env.tn.member.ID), c.ID, "👍")
		}},
		{"comment_anchors", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			v, err := env.svc.CreateDocumentVersion(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, CreateDocumentVersionInput{})
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.PutDocumentCommentAnchors(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, DocumentCommentAnchorsInput{
				VersionID: v.ID, AnchorsPresent: true,
				Anchors: []DocumentCommentAnchorItem{},
			})
			return err
		}},
		{"share_create", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.ShareDocument(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.outsider.ID, Level: DocumentLevelView})
			return err
		}},
		{"share_batch", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.ShareDocumentBatch(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, []string{env.tn.outsider.ID}, DocumentLevelView)
			return err
		}},
		{"link_create", func(t *testing.T, env *docStorageEnv) error {
			if _, err := env.svc.SetDocumentPublicLinks(env.f.ctx, Human(env.tn.owner.ID), env.tn.orgID, true); err != nil {
				t.Fatal(err)
			}
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.CreateDocumentLink(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, 7)
			return err
		}},
		{"break_glass_grant", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDocOf(t, env, "restricted").ID)
			_, _, err := env.svc.GrantDocumentBreakGlass(env.f.ctx, Human(env.tn.wsAdmin.ID), d.ID, "lý do khẩn cấp")
			return err
		}},
		{"office_job_edit", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "job-"+util.NewID()[20:]+".md", []byte("# job"))
			engine := newScriptedEngine()
			off := NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: engine, Documents: env.svc, MaxDeadline: 2 * time.Minute})
			d := shelve(t, env, file.Document.ID)
			_, err := off.StartOfficeJob(env.f.ctx, Human(env.tn.aclOwner.ID), OfficeJobInput{
				OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, DocumentID: d.ID,
				Operation: office.OperationEdit, Format: office.FormatMD, IdempotencyKey: "sh2-edit-job-" + d.ID,
			})
			return err
		}},
		{"launch_edit_session", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "launch-"+util.NewID()[20:]+".pdf", pdfBody("sh2-launch"))
			launch := NewOfficeLaunchService(env.svc, config.Config{})
			d := shelve(t, env, file.Document.ID)
			_, err := launch.Create(env.f.ctx, Human(env.tn.aclOwner.ID), OfficeLaunchCreateInput{
				DocumentID: d.ID, Operation: "edit", ClientID: "uniwork-office", DeploymentID: "default",
			})
			return err
		}},
		// UNI-1645 phase 2 edit lock (ar merge1, UNI-1845 §3): every lock
		// command that takes, renews, takes over, holds or requests a tenure
		// is a write on the shelved document, so it refuses like the rest.
		// Releasing a lock is the one exception and lives in the allowed
		// table below.
		{"edit_lock_acquire", func(t *testing.T, env *docStorageEnv) error {
			d := shelve(t, env, pageDoc(t, env).ID)
			_, err := env.svc.AcquireDocumentEditLock(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID,
				AcquireDocumentEditLockInput{EditorID: "e-" + util.NewID()[20:], Client: DocumentEditClientWebPage, SessionID: "sid-" + util.NewID()[20:]})
			return err
		}},
		{"edit_lock_heartbeat_renew", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			held := takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-renew", DocumentEditClientWebPage, "sid-renew")
			shelve(t, env, page.ID)
			_, err := env.svc.HeartbeatDocumentEditLock(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, held.Lock.ID)
			return err
		}},
		{"edit_lock_take_over", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			held := takeEditLock(t, env, env.tn.member, page.ID, "e-held", DocumentEditClientWebPage, "sid-held")
			shelve(t, env, page.ID)
			_, err := env.svc.TakeOverDocumentEditLock(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID,
				TakeOverDocumentEditLockInput{EditorID: "e-take", Client: DocumentEditClientWebPage, SessionID: "sid-take", ExpectedLockID: held.Lock.ID})
			return err
		}},
		{"edit_hold_put", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			sid := insertEditLockDeviceSession(t, env.f.ctx, env.f.pool, env.tn.aclOwner.ID)
			held := takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-hold", DocumentEditClientDesktop, sid)
			shelve(t, env, page.ID)
			_, err := env.svc.PutDocumentEditHold(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, held.Lock.ID, sid)
			return err
		}},
		{"edit_hold_clear", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			sid := insertEditLockDeviceSession(t, env.f.ctx, env.f.pool, env.tn.aclOwner.ID)
			held := takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-hold", DocumentEditClientDesktop, sid)
			if _, err := env.svc.PutDocumentEditHold(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, held.Lock.ID, sid); err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err := env.svc.ClearDocumentEditHold(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, held.Lock.ID)
			return err
		}},
		{"edit_request_create", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-holder", DocumentEditClientWebPage, "sid-holder")
			shelve(t, env, page.ID)
			_, err := env.svc.CreateDocumentEditRequest(env.f.ctx, Human(env.tn.member.ID), page.ID)
			return err
		}},
		{"edit_request_answer", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			held := takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-holder", DocumentEditClientWebPage, "sid-holder")
			req, err := env.svc.CreateDocumentEditRequest(env.f.ctx, Human(env.tn.member.ID), page.ID)
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			_, err = env.svc.AnswerDocumentEditRequest(env.f.ctx, Human(env.tn.aclOwner.ID), page.ID, req.Request.ID,
				AnswerDocumentEditRequestInput{Decision: "decline", LockID: held.Lock.ID})
			return err
		}},
		{"edit_request_cancel", func(t *testing.T, env *docStorageEnv) error {
			page := pageDoc(t, env)
			takeEditLock(t, env, env.tn.aclOwner, page.ID, "e-holder", DocumentEditClientWebPage, "sid-holder")
			req, err := env.svc.CreateDocumentEditRequest(env.f.ctx, Human(env.tn.member.ID), page.ID)
			if err != nil {
				t.Fatal(err)
			}
			shelve(t, env, page.ID)
			return env.svc.CancelDocumentEditRequest(env.f.ctx, Human(env.tn.member.ID), page.ID, req.Request.ID)
		}},
		// BIGUP-S1 large upload sessions (ar fix4): the session routes are
		// writes on the document they name, so opening or completing one on a
		// shelved document refuses like every other path. The complete rows
		// open their session on a live document first, because the raced
		// shelve is the case that matters: the commit must catch it by
		// re-reading the document it is about to version.
		{"upload_session_open_version", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "sess-"+util.NewID()[20:]+".pdf", pdfBody("sh2-open"))
			d := shelve(t, env, file.Document.ID)
			in, _ := sessionOpenInputFor(sessionSize, "sh2-open")
			_, err := env.svc.OpenVersionUploadSession(env.f.ctx, Human(env.tn.aclOwner.ID), d.ID, in)
			return err
		}},
		{"upload_session_open_frame", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "sess-"+util.NewID()[20:]+".pdf", pdfBody("sh2-frame-open"))
			d := shelve(t, env, file.Document.ID)
			in, _ := sessionOpenInputFor(sessionSize, "sh2-frame-open")
			_, err := env.svc.OpenFrameUploadSession(env.f.ctx, frameClaims(env, d.ID, env.tn.aclOwner.ID), d.ID, in)
			return err
		}},
		{"create_file_from_staged_upload_into_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			// The row only needs a claimable staged file; lockPageParent
			// answers the shelved parent before anything is created.
			up, err := env.fs.Upload(env.f.ctx, files.UploadInput{
				Actor: Human(env.tn.aclOwner.ID), Purpose: files.DocumentFile,
				Scope:          files.Scope{OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA},
				IdempotencyKey: nextIDK(), Filename: "child.pdf", Body: bytes.NewReader(pdfBody("sh2-staged")),
			})
			if err != nil {
				t.Fatal(err)
			}
			parent := shelve(t, env, folderDoc(t, env).ID)
			_, err = env.svc.CreateFileDocumentFromUpload(env.f.ctx, Human(env.tn.aclOwner.ID), env.tn.wsA,
				CreateFileDocumentFromUploadInput{UploadID: string(up.File.ID), Filename: "child.pdf", Title: "Con", ParentID: parent.ID})
			return err
		}},
		{"upload_session_complete_version", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "sess-"+util.NewID()[20:]+".pdf", pdfBody("sh2-complete"))
			in, body := sessionOpenInputFor(sessionSize, "sh2-complete")
			sess, err := env.svc.OpenVersionUploadSession(env.f.ctx, Human(env.tn.aclOwner.ID), file.Document.ID, in)
			if err != nil {
				t.Fatal(err)
			}
			parts := uploadAllParts(t, env, sess.SessionID, body)
			shelve(t, env, file.Document.ID)
			_, err = env.svc.CompleteUploadSession(env.f.ctx, Human(env.tn.aclOwner.ID), sess.SessionID, CompleteUploadSessionInput{Parts: parts})
			return err
		}},
		{"upload_session_complete_frame", func(t *testing.T, env *docStorageEnv) error {
			file := env.createFile(t, Human(env.tn.aclOwner.ID), "sess-"+util.NewID()[20:]+".pdf", pdfBody("sh2-frame-complete"))
			in, body := sessionOpenInputFor(sessionSize, "sh2-frame-complete")
			claims := frameClaims(env, file.Document.ID, env.tn.aclOwner.ID)
			sess, err := env.svc.OpenFrameUploadSession(env.f.ctx, claims, file.Document.ID, in)
			if err != nil {
				t.Fatal(err)
			}
			parts := uploadAllParts(t, env, sess.SessionID, body)
			shelve(t, env, file.Document.ID)
			_, err = env.svc.CompleteFrameUploadSession(env.f.ctx, claims, file.Document.ID, sess.SessionID, CompleteUploadSessionInput{Parts: parts})
			return err
		}},
		{"upload_session_complete_workspace_into_shelved_parent", func(t *testing.T, env *docStorageEnv) error {
			parent := folderDoc(t, env)
			body, probe := buildLargeDOCX(t, sessionSize, nil)
			sess, err := env.svc.OpenWorkspaceUploadSession(env.f.ctx, Human(env.tn.aclOwner.ID), env.tn.wsA,
				OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "child.docx", SizeBytes: sessionSize, Title: "Con", ParentID: &parent.ID, Probe: probe})
			if err != nil {
				t.Fatal(err)
			}
			parts := uploadAllParts(t, env, sess.SessionID, body)
			shelve(t, env, parent.ID)
			_, err = env.svc.CompleteUploadSession(env.f.ctx, Human(env.tn.aclOwner.ID), sess.SessionID, CompleteUploadSessionInput{Parts: parts})
			return err
		}},
	}

	// sessionEnv overrides the env of the rows whose command opens a multipart
	// session: a session can never open on the fake, so those rows need the
	// real store or their refusal would prove nothing about the shelved gate.
	// One env per row: the test database serializes on one advisory lock, so a
	// second env inside a running test would wait forever.
	sessionEnv := map[string]func(*testing.T) *docStorageEnv{
		"upload_session_open_version":                           newMultipartDocEnv,
		"upload_session_open_frame":                             newMultipartDocEnv,
		"upload_session_complete_version":                       newMultipartDocEnv,
		"upload_session_complete_frame":                         newMultipartDocEnv,
		"upload_session_complete_workspace_into_shelved_parent": newMultipartDocEnv,
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			envFn := newFakeDocStorageEnv
			if fn, ok := sessionEnv[row.name]; ok {
				envFn = fn
			}
			wantShelvedWrite(t, row.run(t, envFn(t)))
		})
	}
}

// takeEditLock takes u's edit lock on a live document through the public
// command, so an edit-lock write row has a live tenure to act on before the
// shelve.
func takeEditLock(t *testing.T, env *docStorageEnv, u db.User, docID, editor, client, sessionID string) DocumentEditLockView {
	t.Helper()
	v, err := env.svc.AcquireDocumentEditLock(env.f.ctx, Human(u.ID), docID,
		AcquireDocumentEditLockInput{EditorID: editor, Client: client, SessionID: sessionID})
	if err != nil {
		t.Fatalf("acquire edit lock: %v", err)
	}
	return v
}

// sessionOpenInputFor builds the open input and the body a large-upload
// session row moves: a valid PDF of exactly size bytes with its probe, named
// so two rows never share a filename.
func sessionOpenInputFor(size int64, marker string) (OpenUploadSessionInput, []byte) {
	body, probe := buildLargePDF(size, marker)
	return OpenUploadSessionInput{
		IdempotencyKey: nextIDK(), Filename: "v2-" + marker + ".pdf", SizeBytes: size, Probe: probe,
	}, body
}

// frameClaims is the frame token's claims for a document of this tenant, the
// shape OpenFrameUploadSession and CompleteFrameUploadSession take.
func frameClaims(env *docStorageEnv, documentID, userID string) OfficeFrameClaims {
	return OfficeFrameClaims{
		Version: 1, DocumentID: documentID,
		WorkspaceID: env.tn.wsA, OrganizationID: env.tn.orgID, UserID: userID,
		Module: OfficeFrameModulePDF,
	}
}

// pageDoc seeds one live page the ACL owner manages (acl_owner => manage).
func pageDoc(t *testing.T, env *docStorageEnv) db.Document {
	t.Helper()
	return pageDocOf(t, env, "workspace")
}

func pageDocOf(t *testing.T, env *docStorageEnv, visibility string) db.Document {
	t.Helper()
	return env.f.treeDoc(t, env.tn, treeDocSpec{
		ws: env.tn.wsA, visibility: visibility, aclOwner: env.tn.aclOwner.ID, createdBy: env.tn.aclOwner.ID,
		title: "Trang " + util.NewID()[20:], contentText: "nội dung",
	})
}

func folderDoc(t *testing.T, env *docStorageEnv) db.Document {
	t.Helper()
	return env.f.treeDoc(t, env.tn, treeDocSpec{
		ws: env.tn.wsA, visibility: "workspace", aclOwner: env.tn.aclOwner.ID, createdBy: env.tn.aclOwner.ID,
		kind: DocumentKindFolder, title: "Thư mục " + util.NewID()[20:],
	})
}

// TestShelvedWriteBlockAllowed is the other half of SH-2: the commands §3
// names allowed keep working on a shelved document - read, download,
// favourite, copy (the copy is NOT shelved), trash and unshelve (manage),
// and every revoke of a share, link or break-glass grant (Q-AR2 = a).
func TestShelvedWriteBlockAllowed(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	mgr := Human(env.tn.aclOwner.ID)
	page := pageDoc(t, env)
	file := env.createFile(t, mgr, "đọc-"+util.NewID()[20:]+".pdf", pdfBody("sh2-read"))
	comment, err := env.svc.AddDocumentComment(env.f.ctx, mgr, page.ID, AddCommentInput{Body: "đọc được"}, "")
	if err != nil {
		t.Fatal(err)
	}
	// Live share + link the revokes act on after the shelve.
	share, err := env.svc.ShareDocument(env.f.ctx, mgr, page.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.member.ID, Level: DocumentLevelView})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.svc.SetDocumentPublicLinks(env.f.ctx, Human(env.tn.owner.ID), env.tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	link, err := env.svc.CreateDocumentLink(env.f.ctx, mgr, page.ID, 7)
	if err != nil {
		t.Fatal(err)
	}

	shelve(t, env, page.ID)
	shelve(t, env, file.Document.ID)

	t.Run("read: get, list versions, comments, bytes all answer", func(t *testing.T) {
		if _, err := env.svc.GetDocument(env.f.ctx, mgr, page.ID); err != nil {
			t.Fatalf("get: %v", err)
		}
		if _, err := env.svc.ListDocumentVersions(env.f.ctx, mgr, page.ID, ListDocumentVersionsInput{}); err != nil {
			t.Fatalf("list versions: %v", err)
		}
		if _, err := env.svc.DocumentComments(env.f.ctx, mgr, page.ID, DocumentCommentListInput{}); err != nil {
			t.Fatalf("comments: %v", err)
		}
		if _, err := env.svc.GetDocumentComment(env.f.ctx, mgr, comment.ID); err != nil {
			t.Fatalf("comment row: %v", err)
		}
		if _, err := env.svc.OpenDocumentFile(env.f.ctx, mgr, file.Document.ID, 0, DocumentByteRange{}); err != nil {
			t.Fatalf("download: %v", err)
		}
	})

	t.Run("favourite and unfavourite still work", func(t *testing.T) {
		if _, err := env.svc.FavoriteDocument(env.f.ctx, mgr, page.ID); err != nil {
			t.Fatalf("favourite: %v", err)
		}
		if err := env.svc.UnfavoriteDocument(env.f.ctx, mgr, page.ID); err != nil {
			t.Fatalf("unfavourite: %v", err)
		}
	})

	t.Run("the copy is not shelved", func(t *testing.T) {
		res, err := env.svc.CopyDocument(env.f.ctx, mgr, file.Document.ID, CopyDocumentInput{Consent: documentCopyConsent})
		if err != nil {
			t.Fatalf("copy: %v", err)
		}
		if res.Document.ShelvedAt.Valid {
			t.Fatalf("copy of a shelved document is shelved: %+v", res.Document.ShelvedAt)
		}
	})

	t.Run("revoke share and link stay allowed", func(t *testing.T) {
		if err := env.svc.RevokeDocumentShare(env.f.ctx, mgr, page.ID, share.ID); err != nil {
			t.Fatalf("revoke share: %v", err)
		}
		if err := env.svc.RevokeDocumentLink(env.f.ctx, mgr, page.ID, link.Link.ID); err != nil {
			t.Fatalf("revoke link: %v", err)
		}
	})

	t.Run("trash and unshelve stay manage commands", func(t *testing.T) {
		trashTarget := pageDoc(t, env)
		shelve(t, env, trashTarget.ID)
		if _, err := env.svc.ArchiveDocument(env.f.ctx, mgr, trashTarget.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("trash a shelved page: %v", err)
		}
		if _, err := env.svc.UnshelveDocument(env.f.ctx, mgr, trashTarget.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("unshelve: %v", err)
		}
	})

	t.Run("releasing an edit lock stays allowed", func(t *testing.T) {
		// UNI-1645 phase 2 (ar merge1): acquire/refuse is the write block's
		// business, but releasing only frees the document, so a shelved item
		// keeps the release path - the holder can drop the tenure the shelve
		// left behind (S-4 is still an open TODO: a shelve does not release).
		lockPage := pageDoc(t, env)
		held := takeEditLock(t, env, env.tn.aclOwner, lockPage.ID, "e-release", DocumentEditClientWebPage, "sid-release")
		shelve(t, env, lockPage.ID)
		if err := env.svc.ReleaseDocumentEditLock(env.f.ctx, mgr, lockPage.ID, held.Lock.ID); err != nil {
			t.Fatalf("release on a shelved page: %v", err)
		}
		// BE-AR-2: the row observes the effect, not just a nil answer - a
		// release that silently acknowledged the lock without ending the
		// tenure would leave the editor locked out and still pass otherwise.
		tenure, err := env.f.q.GetDocumentEditLock(env.f.ctx, db.GetDocumentEditLockParams{
			ID: held.Lock.ID, OrganizationID: lockPage.OrganizationID, DocumentID: lockPage.ID,
		})
		if err != nil {
			t.Fatalf("reload the tenure after release: %v", err)
		}
		if !tenure.EndedAt.Valid || tenure.EndReason.String != DocumentEditEndReleased {
			t.Fatalf("tenure after release on a shelved page = ended %v reason %q, want ended with %q",
				tenure.EndedAt.Valid, tenure.EndReason.String, DocumentEditEndReleased)
		}
	})
}

// TestShelvedUploadSessionAbortStaysAllowed is the abort half: aborting a
// shelved upload session frees the staged bytes of a session the client no
// longer wants, so the shelve must not strand them. The session is opened on a
// live document and the shelve lands before the abort - the state a client
// that shelved while a large save was in flight actually holds. Its own
// top-level test: the test database serializes on one advisory lock, so a
// second env inside a running test would wait forever.
func TestShelvedUploadSessionAbortStaysAllowed(t *testing.T) {
	env := newMultipartDocEnv(t)
	mgr := Human(env.tn.aclOwner.ID)
	file := env.createFile(t, mgr, "hủy-"+util.NewID()[20:]+".pdf", pdfBody("sh2-abort"))
	in, _ := sessionOpenInputFor(UploadSessionThresholdBytes+1, "sh2-abort")
	sess, err := env.svc.OpenVersionUploadSession(env.f.ctx, mgr, file.Document.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	shelve(t, env, file.Document.ID)
	if err := env.svc.AbortUploadSession(env.f.ctx, mgr, sess.SessionID); err != nil {
		t.Fatalf("abort on a shelved document: %v", err)
	}
}

// TestShelvedWriteBlockVisibility: a caller who cannot see the shelved row
// still gets not_found - the state is read off the locked row after the
// access gate, never before it.
func TestShelvedWriteBlockVisibility(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	page := pageDoc(t, env)
	shelve(t, env, page.ID)
	title := "Ngoài"
	// An organization member outside the document's workspace learns nothing.
	if _, err := env.svc.UpdateDocument(env.f.ctx, Human(env.tn.outsider.ID), page.ID, UpdateDocumentInput{Revision: page.Revision, Title: &title}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider patch on shelved doc = %v, want not_found", err)
	}
	if _, err := env.svc.AddDocumentComment(env.f.ctx, Human(env.tn.outsider.ID), page.ID, AddCommentInput{Body: "x"}, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider comment on shelved doc = %v, want not_found", err)
	}

	// BE-AR-1: the heartbeat is the one edit-lock command outside the shared
	// mutation wrapper, so its own ordering needs its own pin. An outsider
	// holding the real lock id must learn nothing: access is decided before
	// the shelved state is read, so the answer is not_found, not 409.
	t.Run("outsider heartbeat on a shelved page", func(t *testing.T) {
		lockPage := pageDoc(t, env)
		held := takeEditLock(t, env, env.tn.aclOwner, lockPage.ID, "e-out", DocumentEditClientWebPage, "sid-out")
		shelve(t, env, lockPage.ID)
		if _, err := env.svc.HeartbeatDocumentEditLock(env.f.ctx, Human(env.tn.outsider.ID), lockPage.ID, held.Lock.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("outsider heartbeat on shelved page = %v, want not_found", err)
		}
	})

	// The session routes have their own access gate: an outsider opening a
	// version session on a shelved file is refused by that gate, before the
	// shelved state is read.
	t.Run("outsider opens a version session on a shelved file", func(t *testing.T) {
		file := env.createFile(t, Human(env.tn.aclOwner.ID), "vis-"+util.NewID()[20:]+".pdf", pdfBody("sh2-vis"))
		shelve(t, env, file.Document.ID)
		in, _ := sessionOpenInputFor(UploadSessionThresholdBytes+1, "sh2-vis")
		if _, err := env.svc.OpenVersionUploadSession(env.f.ctx, Human(env.tn.outsider.ID), file.Document.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("outsider version session on a shelved file = %v, want not_found", err)
		}
	})
}

// TestShelvedOfficeFrame is the SH-6 frame half: Mint keeps opening the
// shelved document but with can_edit=false, and the frame's upload asset
// route answers document_shelved through the same service gate.
func TestShelvedOfficeFrame(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	mgr := Human(env.tn.aclOwner.ID)
	file := env.createFile(t, mgr, "frame-"+util.NewID()[20:]+".docx", docxBody(t, "sh2-frame"))
	frame := NewOfficeFrameService(env.svc, "office-frame-shelved-test-secret")

	live, err := frame.Mint(env.f.ctx, mgr, file.Document.ID)
	if err != nil {
		t.Fatalf("mint live: %v", err)
	}
	if !live.CanEdit {
		t.Fatal("can_edit on a live document = false, want true")
	}
	shelve(t, env, file.Document.ID)

	tok, err := frame.Mint(env.f.ctx, mgr, file.Document.ID)
	if err != nil {
		t.Fatalf("mint shelved: %v", err)
	}
	claims, err := frame.Verify(tok.Token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	// load still opens: shelved is not the trash.
	if _, err := frame.Open(env.f.ctx, claims); err != nil {
		t.Fatalf("frame open on shelved: %v", err)
	}
	// The frame's asset route is a write and answers the read-only error.
	if _, err := frame.UploadAsset(env.f.ctx, claims, DocumentUploadInput{Filename: "a.png", Body: bytes.NewReader(pngBody(t, 2, 2))}); !errors.Is(err, ErrDocumentShelved) {
		t.Fatalf("frame asset upload on shelved = %v, want document_shelved", err)
	}
}

// TestShelvedOfficeLease refuses a fresh grant and a renewal on a shelved
// file (§3 "offline lease cấp mới"). The device holds the live row from
// before the shelve, so the renewal is the PUT's renew path.
func TestShelvedOfficeLease(t *testing.T) {
	w := newLeaseWorld(t, "shlease")
	doc := w.file(t, "workspace")
	device := w.device(t, w.tn.aclOwner.ID)
	live := w.grant(t, w.tn.aclOwner.ID, device, doc.ID)

	shelveDoc(t, w.f, w.tn.aclOwner.ID, doc.ID)

	if _, err := w.leases.Put(w.ctx, Human(w.tn.aclOwner.ID), OfficeLeasePutInput{DocumentID: doc.ID, DeviceSessionID: w.device(t, w.tn.aclOwner.ID)}); !errors.Is(err, ErrDocumentShelved) {
		t.Fatalf("grant on shelved = %v, want document_shelved", err)
	}
	if _, err := w.leases.Put(w.ctx, Human(w.tn.aclOwner.ID), OfficeLeasePutInput{DocumentID: doc.ID, DeviceSessionID: device, Lease: live.Token}); !errors.Is(err, ErrDocumentShelved) {
		t.Fatalf("renewal on shelved = %v, want document_shelved", err)
	}
}

// shelveDoc is the lease world's own shelve: it has no docStorageEnv.
func shelveDoc(t *testing.T, f *docPermFixture, ownerID, docID string) {
	t.Helper()
	if _, err := f.svc.ShelveDocument(f.ctx, Human(ownerID), docID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("shelve: %v", err)
	}
}

// TestShelvedMcpTools is SH-7: the connector's update_document and
// add_document_comment reach the shelved refusal through the service; a
// create under a shelved parent is refused too.
func TestShelvedMcpTools(t *testing.T) {
	x := newMcpToolWorld(t)
	docs, v := x.withDocs(t, "Trang MCP", mcpTestPage)
	if _, err := docs.ShelveDocument(context.Background(), Human(x.ua.ID), v.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("shelve: %v", err)
	}

	// The connector's error contract carries the code, not the sentinel:
	// mcpMapError turns the service's CodedError into a McpToolError of the
	// same code, so the read-only answer the model sees is document_shelved.
	if _, err := callMcpTool(t, x.tools, x.p, "update_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","revision":`+
		jsonNumber(v.Document.Revision)+`,"title":"Đổi"}`); mcpErrorCode(err) != "document_shelved" {
		t.Fatalf("mcp update_document on shelved = %v, want document_shelved", err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "add_document_comment", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","body":"ghi chú"}`); mcpErrorCode(err) != "document_shelved" {
		t.Fatalf("mcp add_document_comment on shelved = %v, want document_shelved", err)
	}
	// Reads keep answering.
	if _, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`"}`); err != nil {
		t.Fatalf("mcp get_document on shelved: %v", err)
	}
}

// jsonNumber renders the revision for a hand-built tool argument.
func jsonNumber(v int64) string {
	return strconv.FormatInt(v, 10)
}

// mcpErrorCode reads the tool answer's code: McpToolError carries one, and a
// service CodedError that slipped past mcpMapError does too.
func mcpErrorCode(err error) string {
	var te McpToolError
	if errors.As(err, &te) {
		return te.Code
	}
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}
