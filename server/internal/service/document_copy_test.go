package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// copyDocCount is the workspace's document row count, the cheapest proof that a
// refused copy wrote nothing.
func copyDocCount(t *testing.T, env *docStorageEnv) int {
	t.Helper()
	var n int
	if err := env.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM documents WHERE workspace_id = $1`, env.tn.wsA).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// CopyDocument (G2-07a / UNI-690; C-01 §14): consent, ACL snapshot,
// provenance, byte identity and the owner seam.
func TestDocumentCopy(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		aclOwner := human(env.tn.aclOwner)

		t.Run("consent is required", func(t *testing.T) {
			src := env.createFile(t, member, "consent.md", []byte("# Nguon\n"))
			before := copyDocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{IdempotencyKey: util.NewID()})
			if ce := wantCode(t, err, "copy_consent_required"); ce.Status != 409 {
				t.Fatalf("consent refusal = %+v", ce)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("a refused copy still wrote a document")
			}
		})

		t.Run("copy keeps the source acl snapshot, bytes and provenance", func(t *testing.T) {
			src := env.createFile(t, member, "snapshot.md", []byte("# Nguon sao chep\n"))
			// The source is restricted and owned by another member's ACL slot,
			// with one live share: the copy must inherit all three. The share
			// names another workspace - one naming the source's own workspace
			// merges into its home row (SH-S1) and leaves no row to inherit.
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.aclOwner.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ShareDocument(ctx, aclOwner, src.Document.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalWorkspace, PrincipalID: env.tn.wsB, Level: DocumentLevelView,
			}); err != nil {
				t.Fatalf("share: %v", err)
			}
			srcDoc := env.doc(t, src.Document.ID)

			copied, err := env.svc.CopyDocument(ctx, aclOwner, src.Document.ID, CopyDocumentInput{
				Consent: "copy", IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "copy")
			if copied.Document.ID == src.Document.ID {
				t.Fatal("copy is the source")
			}
			if copied.Document.Visibility != srcDoc.Visibility ||
				copied.Document.AclOwnerID.String != srcDoc.AclOwnerID.String {
				t.Fatalf("copy acl snapshot = %s/%s, want %s/%s", copied.Document.Visibility,
					copied.Document.AclOwnerID.String, srcDoc.Visibility, srcDoc.AclOwnerID.String)
			}
			if copied.Document.SourceDocumentID.String != srcDoc.ID ||
				copied.Document.SourceVersionID.String != src.Version.ID {
				t.Fatalf("copy provenance = %+v", copied.Document)
			}
			if !copied.Document.SourceRevision.Valid || copied.Document.SourceRevision.Int64 != srcDoc.Revision {
				t.Fatalf("copy source revision = %+v", copied.Document.SourceRevision)
			}
			if copied.Document.SourceChecksumSha256.String != src.Version.ChecksumSha256.String {
				t.Fatalf("copy checksum provenance = %q", copied.Document.SourceChecksumSha256.String)
			}
			// The bytes are the same FileService object: one file_id counted
			// once (T1-Q9), so a copy adds no storage.
			if copied.Version.FileID.String != src.Version.FileID.String {
				t.Fatalf("copy file = %s, want the source file %s", copied.Version.FileID.String, src.Version.FileID.String)
			}
			if got := env.read(t, aclOwner, copied.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, []byte("# Nguon sao chep\n")) {
				t.Fatalf("copy bytes = %q", got)
			}
			shares, err := env.f.q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
				OrganizationID: srcDoc.OrganizationID, WorkspaceID: srcDoc.WorkspaceID, DocumentID: copied.Document.ID,
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(shares) != 1 || shares[0].PrincipalType != DocumentPrincipalWorkspace || shares[0].Level != string(DocumentLevelView) {
				t.Fatalf("copy shares = %+v", shares)
			}
			// The source is untouched: same revision, same version count.
			after := env.doc(t, src.Document.ID)
			if after.Revision != srcDoc.Revision {
				t.Fatalf("source revision moved to %d", after.Revision)
			}
			if vs := env.versions(t, after); len(vs) != 1 {
				t.Fatalf("source versions = %d", len(vs))
			}
		})

		t.Run("replay of the same key answers the same copy", func(t *testing.T) {
			src := env.createFile(t, member, "replay-copy.md", []byte("# Replay\n"))
			key := util.NewID()
			first, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: key})
			mustf(t, err, "first copy")
			again, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: key})
			mustf(t, err, "replayed copy")
			if again.Document.ID != first.Document.ID {
				t.Fatalf("replay made another document: %s vs %s", again.Document.ID, first.Document.ID)
			}
			if after := copyDocCount(t, env); after < 2 {
				t.Fatal("documents disappeared")
			}
		})

		t.Run("an owned document answers owner_requires_copy", func(t *testing.T) {
			src := env.createFile(t, member, "owned.md", []byte("# So huu\n"))
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET owner_kind = 'work_product', owner_id = 'wp-' || id, parent_id = NULL WHERE id = $1`,
				src.Document.ID); err != nil {
				t.Fatal(err)
			}
			// C-14 is not implemented: the strongest available seam grants
			// edit, and the endpoint must still refuse to mint a standalone
			// copy of an owned document.
			env.svc.SetOwnerLevelResolver(fakeOwnerResolver{level: DocumentLevelEdit})
			t.Cleanup(func() { env.svc.SetOwnerLevelResolver(nil) })
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
			if ce := wantCode(t, err, "owner_requires_copy"); ce.Status != 409 {
				t.Fatalf("owned copy refusal = %+v", ce)
			}
		})

		t.Run("a page is not copyable here", func(t *testing.T) {
			page, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Title: "Trang " + util.NewID()[20:]})
			mustf(t, err, "page")
			_, err = env.svc.CopyDocument(ctx, member, page.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
			if ce := wantCode(t, err, "document_invalid"); ce.Fields["reason"] != "page_copy_not_supported" {
				t.Fatalf("page copy refusal = %+v", ce)
			}
		})

		t.Run("a view-only member cannot copy", func(t *testing.T) {
			src := env.createFile(t, member, "view-only.md", []byte("# Chi xem\n"))
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.member.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ShareDocument(ctx, member, src.Document.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.outsider.ID, Level: DocumentLevelView,
			}); err != nil {
				t.Fatalf("share: %v", err)
			}
			outsider := human(env.tn.outsider)
			if _, err := env.svc.CopyDocument(ctx, outsider, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()}); err == nil {
				t.Fatal("a view-only member copied a restricted document")
			}
		})

		// A copy is a create in the source's workspace: edit on the source
		// through a share is not a seat in that workspace, so a share editor
		// outside it is refused like CreateFileDocument refuses them (G5-12).
		t.Run("a share editor outside the workspace cannot create the copy there", func(t *testing.T) {
			src := env.createFile(t, member, "share-editor.md", []byte("# Chia se sua\n"))
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.member.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ShareDocument(ctx, member, src.Document.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.outsider.ID, Level: DocumentLevelEdit,
			}); err != nil {
				t.Fatalf("share: %v", err)
			}
			outsider := human(env.tn.outsider)
			// The share is real: the outsider may edit the source itself.
			if _, _, err := env.svc.authorizeDocument(ctx, outsider, src.Document.ID, DocumentLevelEdit); err != nil {
				t.Fatalf("share editor lost edit on the source: %v", err)
			}
			before := copyDocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, outsider, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
			if !errors.Is(err, ErrWorkspaceSeatRequired) {
				t.Fatalf("share editor copy into a workspace they are not in = %v, want ErrWorkspaceSeatRequired", err)
			}
			if ce := wantCode(t, err, "workspace_seat_required"); ce.Status != 403 {
				t.Fatalf("seat refusal = %+v", ce)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("a refused copy still wrote a document")
			}
		})

		// BE-12-201: only the missing seat carries its own code. A member who may
		// edit the source but not the parent folder is refused by the parent
		// gate with the plain forbidden, so the client does not tell them they
		// are not a member.
		t.Run("a member without edit on the parent folder still gets forbidden", func(t *testing.T) {
			src := env.createFile(t, member, "parent-gate.md", []byte("# Cong cha\n"))
			folder, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thu muc han che"})
			if err != nil {
				t.Fatal(err)
			}
			// The folder is restricted to its ACL owner; the copier may view it
			// through a share (so it is visible, not a 404) but not edit it.
			copier := human(env.tn.creator)
			for _, row := range []struct {
				id    string
				level DocumentLevel
			}{{src.Document.ID, DocumentLevelEdit}, {folder.Document.ID, DocumentLevelView}} {
				if _, err := env.f.pool.Exec(ctx,
					`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
					row.id, env.tn.member.ID); err != nil {
					t.Fatal(err)
				}
				if _, err := env.svc.ShareDocument(ctx, member, row.id, DocumentShareInput{
					PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.creator.ID, Level: row.level,
				}); err != nil {
					t.Fatalf("share: %v", err)
				}
			}
			before := copyDocCount(t, env)
			_, err = env.svc.CopyDocument(ctx, copier, src.Document.ID, CopyDocumentInput{
				Consent: "copy", ParentID: folder.Document.ID, IdempotencyKey: util.NewID(),
			})
			if !errors.Is(err, ErrForbidden) || errors.Is(err, ErrWorkspaceSeatRequired) {
				t.Fatalf("copy into a folder the member cannot edit = %v, want plain ErrForbidden", err)
			}
			var ce CodedError
			if errors.As(err, &ce) {
				t.Fatalf("the parent gate answered a coded error %+v, want the plain forbidden", ce)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("a refused copy still wrote a document")
			}
		})

		// The pre-flight seat check passes, then the membership goes before the
		// transaction opens: only the in-transaction RequireMemberQ catches it.
		// The hook rides on ResolveMany, the one FileService call the command
		// makes between the two checks.
		t.Run("a seat removed after the pre-flight refuses the copy in the transaction", func(t *testing.T) {
			src := env.createFile(t, member, "seat-removed.md", []byte("# Mat cho giua chung\n"))
			// Edit comes from a user share, so it outlives the seat: the in-tx
			// document gate still passes and only the seat check can refuse.
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.member.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ShareDocument(ctx, member, src.Document.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalUser, PrincipalID: env.tn.outsider.ID, Level: DocumentLevelEdit,
			}); err != nil {
				t.Fatalf("share: %v", err)
			}
			// The share editor holds a seat for the pre-flight (raw SQL: no API
			// seats the outsider fixture user).
			copier := human(env.tn.outsider)
			if _, err := env.f.pool.Exec(ctx,
				`INSERT INTO workspace_members (workspace_id, user_id, role, organization_id)
				 SELECT id, $2, 'member', organization_id FROM workspaces WHERE id = $1`,
				env.tn.wsA, env.tn.outsider.ID); err != nil {
				t.Fatal(err)
			}
			hook := &seatRemovingFiles{Service: env.fs, remove: func() {
				if _, err := env.f.pool.Exec(ctx,
					`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, env.tn.wsA, env.tn.outsider.ID); err != nil {
					t.Fatal(err)
				}
			}}
			env.svc.SetFiles(hook)
			t.Cleanup(func() { env.svc.SetFiles(env.fs) })
			before := copyDocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, copier, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
			if !hook.fired {
				t.Fatal("the seam never ran: the pre-flight no longer precedes ResolveMany")
			}
			if !errors.Is(err, ErrWorkspaceSeatRequired) {
				t.Fatalf("copy after the seat was removed = %v, want ErrWorkspaceSeatRequired", err)
			}
			if ce := wantCode(t, err, "workspace_seat_required"); ce.Status != 403 {
				t.Fatalf("seat refusal = %+v", ce)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("a refused copy still wrote a document")
			}
		})
	})
}

// G5-13 A98: a copy is a create in the source's workspace, so it is a tree
// write and takes the workspace tree lock BEFORE the source row lock - the one
// order every naming command keeps (appendix §3.3). The barrier holds the tree
// lock in a test transaction; the copy can only reach the parent row lock after
// the holder commits, so a waiter proves the tree lock comes first. With the
// old envelope (no tree lock) the copy would take the source row lock and the
// parent row lock and finish without ever waiting here.
func TestDocumentCopyTakesTheTreeLockFirst(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		src := env.createFile(t, member, "tree-order.md", []byte("# Khoa cay\n"))
		folder, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thu muc dich"})
		if err != nil {
			t.Fatal(err)
		}
		watch, err := pgx.ConnectConfig(ctx, env.f.pool.Config().ConnConfig.Copy())
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = watch.Close(ctx) }()
		holder, err := env.f.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = holder.Rollback(ctx) }()
		if err := env.f.q.WithTx(holder).LockDocumentTree(ctx, env.tn.wsA); err != nil {
			t.Fatal(err)
		}
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		done := make(chan error, 1)
		go func() {
			_, err := env.svc.CopyDocument(cctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", ParentID: folder.Document.ID, IdempotencyKey: util.NewID(),
			})
			done <- err
		}()
		waitForLockWaitersOn(t, watch, 1)
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		select {
		case err := <-done:
			mustf(t, err, "copy after the tree lock was released")
		case <-time.After(30 * time.Second):
			t.Fatal("the copy did not finish after the tree lock was released")
		}
	})
}

// seatRemovingFiles runs remove once, on the first ResolveMany, then answers
// as the wrapped service.
type seatRemovingFiles struct {
	files.Service
	remove func()
	fired  bool
}

func (h *seatRemovingFiles) ResolveMany(ctx context.Context, in files.ResolveInput) ([]files.Resolved, error) {
	if !h.fired {
		h.fired = true
		h.remove()
	}
	return h.Service.ResolveMany(ctx, in)
}

// The half-copy cleanup of Save as a copy (G5-12): the desktop creates the
// copy, commits the local bytes as version 2, and archives the copy when that
// commit fails so server bytes never pass for "your version". The copy keeps
// the source's ACL owner, so its creator often holds only edit; the archive
// gate lets that creator trash the copy while it is still pristine, and
// nobody else and nothing later.
func TestDocumentCopyPristineArchive(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		aclOwner := human(env.tn.aclOwner)
		creator := human(env.tn.creator)

		// copyOf makes a workspace-visible source whose ACL owner is aclOwner
		// and lets member copy it: member edits the copy, does not manage it.
		// The source's home row is re-levelled to edit because a root create
		// that asks for the workspace toggle lands on the row's view default
		// (Q-S3, SH-S1 T3) - a member who holds only view may read it but not
		// copy it.
		copyOf := func(t *testing.T, name string) DocumentFileResult {
			t.Helper()
			src := env.createFile(t, aclOwner, name, []byte("# Nguon\n"))
			setWorkspaceLevel(t, env.f, src.Document, string(DocumentLevelEdit))
			copied, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
			mustf(t, err, "copy")
			if copied.Access.Level != DocumentLevelEdit {
				t.Fatalf("copier level on the copy = %s, want edit", copied.Access.Level)
			}
			return copied
		}
		archive := func(actor Actor, id string) error {
			_, err := env.svc.ArchiveDocument(ctx, actor, id, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
			return err
		}

		t.Run("the creator archives a pristine copy", func(t *testing.T) {
			copied := copyOf(t, "pristine.md")
			if err := archive(member, copied.Document.ID); err != nil {
				t.Fatalf("creator archive of a pristine copy = %v", err)
			}
			if d := env.doc(t, copied.Document.ID); !d.ArchivedAt.Valid || d.ArchivedBy.String != env.tn.member.ID {
				t.Fatalf("copy after archive = archived %v by %q", d.ArchivedAt.Valid, d.ArchivedBy.String)
			}
			if n := env.countAudit(t, "document.archived", copied.Document.ID); n != 1 {
				t.Fatalf("document.archived audit rows = %d, want 1", n)
			}
		})

		// ArchiveImpact runs the command's own root gate: the read that previews
		// a delete never refuses one the command accepts (BE-12-01).
		t.Run("archive impact answers the creator of a pristine copy", func(t *testing.T) {
			copied := copyOf(t, "impact.md")
			got, err := env.svc.ArchiveImpact(ctx, member, copied.Document.ID)
			if err != nil {
				t.Fatalf("archive impact of a pristine copy = %v", err)
			}
			wantImpact(t, env.svc, got, 0, 0, 1)
			up := env.upload(t, member, copied.Document.ID, "impact.md", []byte("# Ban cua toi\n"))
			_, err = env.commit(member, copied.Document.ID, up.UploadID, copied.Document.Revision, util.NewID())
			mustf(t, err, "commit v2")
			if _, err := env.svc.ArchiveImpact(ctx, member, copied.Document.ID); !errors.Is(err, ErrForbidden) {
				t.Fatalf("archive impact after v2 = %v, want ErrForbidden", err)
			}
		})

		t.Run("after a second version the manage gate holds", func(t *testing.T) {
			copied := copyOf(t, "committed.md")
			up := env.upload(t, member, copied.Document.ID, "committed.md", []byte("# Ban cua toi\n"))
			_, err := env.commit(member, copied.Document.ID, up.UploadID, copied.Document.Revision, util.NewID())
			mustf(t, err, "commit v2")
			if err := archive(member, copied.Document.ID); !errors.Is(err, ErrForbidden) {
				t.Fatalf("creator archive after v2 = %v, want ErrForbidden", err)
			}
		})

		t.Run("another editor who did not create the copy is refused", func(t *testing.T) {
			copied := copyOf(t, "other-editor.md")
			if err := archive(creator, copied.Document.ID); !errors.Is(err, ErrForbidden) {
				t.Fatalf("non-creator archive = %v, want ErrForbidden", err)
			}
		})

		t.Run("a creator who lost edit on the copy is refused", func(t *testing.T) {
			copied := copyOf(t, "lost-edit.md")
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted' WHERE id = $1`, copied.Document.ID); err != nil {
				t.Fatal(err)
			}
			if err := archive(member, copied.Document.ID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("archive without edit = %v, want ErrNotFound", err)
			}
		})

		t.Run("a converted copy keeps the manage gate", func(t *testing.T) {
			copied := copyOf(t, "converted.md")
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET conversion_reason = 'convert' WHERE id = $1`, copied.Document.ID); err != nil {
				t.Fatal(err)
			}
			if err := archive(member, copied.Document.ID); !errors.Is(err, ErrForbidden) {
				t.Fatalf("archive of a converted copy = %v, want ErrForbidden", err)
			}
		})
	})
}

// TestDocumentCopyUpload (UNI-1872): CopyDocument with upload_id creates the
// copy's first version from a staged upload of the same document, actor and
// organization while preserving ACL snapshot, provenance, audit and outbox.
func TestDocumentCopyUpload(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		aclOwner := human(env.tn.aclOwner)
		creator := human(env.tn.creator)

		t.Run("copy with upload_id uses the staged upload bytes while keeping acl, provenance, audit and outbox", func(t *testing.T) {
			headBytes := []byte("# Nguon ban dau\n")
			stagedBytes := []byte("# Ban nhap da sua trong frame\n")
			src := env.createFile(t, member, "upload-copy.md", headBytes)
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.aclOwner.ID); err != nil {
				t.Fatal(err)
			}
			for _, p := range []struct {
				kind string
				id   string
				lvl  DocumentLevel
			}{
				{DocumentPrincipalWorkspace, env.tn.wsB, DocumentLevelView},
				{DocumentPrincipalUser, env.tn.member.ID, DocumentLevelEdit},
			} {
				if _, err := env.svc.ShareDocument(ctx, aclOwner, src.Document.ID, DocumentShareInput{
					PrincipalType: p.kind, PrincipalID: p.id, Level: p.lvl,
				}); err != nil {
					t.Fatalf("share: %v", err)
				}
			}
			srcDoc := env.doc(t, src.Document.ID)
			up := env.upload(t, member, src.Document.ID, "upload-copy-edited.md", stagedBytes)

			copied, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up.UploadID, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "copy with upload_id")
			if copied.Document.ID == src.Document.ID {
				t.Fatal("copy is the source")
			}
			if copied.Document.Title != srcDoc.Title+" (bản sao)" {
				t.Fatalf("copy title = %q, want %q", copied.Document.Title, srcDoc.Title+" (bản sao)")
			}
			if copied.Version.FileID.String != up.UploadID || copied.File.FileID != up.UploadID {
				t.Fatalf("copy file_id = %s/%s, want staged upload %s", copied.Version.FileID.String, copied.File.FileID, up.UploadID)
			}
			if got := env.read(t, member, copied.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, stagedBytes) {
				t.Fatalf("copy bytes = %q, want staged bytes %q", got, stagedBytes)
			}
			if got := env.read(t, member, src.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, headBytes) {
				t.Fatalf("source bytes = %q, want untouched head %q", got, headBytes)
			}
			if copied.Document.Visibility != srcDoc.Visibility ||
				copied.Document.AclOwnerID.String != srcDoc.AclOwnerID.String {
				t.Fatalf("copy acl = %s/%s, want %s/%s", copied.Document.Visibility,
					copied.Document.AclOwnerID.String, srcDoc.Visibility, srcDoc.AclOwnerID.String)
			}
			if copied.Document.SourceDocumentID.String != srcDoc.ID ||
				copied.Document.SourceVersionID.String != src.Version.ID ||
				!copied.Document.SourceRevision.Valid || copied.Document.SourceRevision.Int64 != srcDoc.Revision ||
				copied.Document.SourceChecksumSha256.String != src.Version.ChecksumSha256.String {
				t.Fatalf("copy provenance = %+v", copied.Document)
			}
			after := env.doc(t, src.Document.ID)
			if after.Revision != srcDoc.Revision || len(env.versions(t, after)) != 1 {
				t.Fatalf("source changed: rev %d versions %d", after.Revision, len(env.versions(t, after)))
			}
			// Audit and outbox are unchanged: document.created with reason "copy" and no extra fields.
			if n := env.countAudit(t, "document.created", copied.Document.ID); n != 1 {
				t.Fatalf("document.created audit rows = %d, want 1", n)
			}
			if n := env.countOutbox(t, "document.created", copied.Document.ID); n != 1 {
				t.Fatalf("document.created outbox rows = %d, want 1", n)
			}
			var rawChanges []byte
			if err := env.f.pool.QueryRow(ctx,
				`SELECT changes FROM audit_events WHERE resource_id = $1 AND action = 'document.created'`,
				copied.Document.ID).Scan(&rawChanges); err != nil {
				t.Fatalf("read audit changes: %v", err)
			}
			var changes map[string]struct {
				From any `json:"from"`
				To   any `json:"to"`
			}
			if err := json.Unmarshal(rawChanges, &changes); err != nil {
				t.Fatalf("decode audit changes %s: %v", rawChanges, err)
			}
			wantKeys := map[string]bool{
				"title": true, "kind": true, "version_id": true, "file_id": true,
				"source_document_id": true, "source_version_id": true, "reason": true,
			}
			if len(changes) != len(wantKeys) || changes["reason"].To != "copy" || changes["file_id"].To != up.UploadID {
				t.Fatalf("audit changes = %v, want exact copy keys with file_id=%s", changes, up.UploadID)
			}
			for k := range changes {
				if !wantKeys[k] {
					t.Fatalf("unexpected audit field %q in %v", k, changes)
				}
			}
		})

		t.Run("upload must belong to the same document, actor and organization or fail closed as 404", func(t *testing.T) {
			src := env.createFile(t, member, "scope-src.md", []byte("# Nguon A\n"))
			otherDoc := env.createFile(t, member, "scope-other.md", []byte("# Nguon B\n"))
			otherTn := env.f.tenant(t, "other"+strings.ToLower(util.NewID()[20:]))
			otherOrgMember := human(otherTn.member)
			otherOrgDoc, err := env.svc.CreateFileDocument(ctx, otherOrgMember, otherTn.wsA, CreateFileDocumentInput{
				Title: "Other Org File", Filename: "other-org.md", Body: bytes.NewReader([]byte("# Org B\n")),
				Visibility: documentVisibilityWorkspace, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "other org doc")

			upOtherDoc := env.upload(t, member, otherDoc.Document.ID, "other-doc.md", []byte("# Staged on B\n"))
			upOtherActor := env.upload(t, creator, src.Document.ID, "other-actor.md", []byte("# Staged by creator\n"))
			upOtherOrg := env.upload(t, otherOrgMember, otherOrgDoc.Document.ID, "other-org-up.md", []byte("# Staged in org B\n"))

			before := copyDocCount(t, env)
			for name, badID := range map[string]string{
				"unknown upload id":     util.NewID(),
				"other document upload": upOtherDoc.UploadID,
				"other actor upload":    upOtherActor.UploadID,
				"other org upload":      upOtherOrg.UploadID,
				"source head file_id":   src.Version.FileID.String,
			} {
				_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
					Consent: "copy", UploadID: badID, IdempotencyKey: util.NewID(),
				})
				if !errors.Is(err, ErrNotFound) {
					t.Fatalf("%s: err = %v, want ErrNotFound (404)", name, err)
				}
				var ce CodedError
				if errors.As(err, &ce) {
					t.Fatalf("%s: returned coded error %+v, want plain ErrNotFound", name, ce)
				}
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatalf("refused copies created %d documents", after-before)
			}
		})

		t.Run("upload is consumed once: idempotent replay, payload mismatch and already-claimed refusal", func(t *testing.T) {
			src := env.createFile(t, member, "once.md", []byte("# Nguon\n"))
			up1 := env.upload(t, member, src.Document.ID, "once-1.md", []byte("# Ban 1\n"))
			up2 := env.upload(t, member, src.Document.ID, "once-2.md", []byte("# Ban 2\n"))
			key := util.NewID()

			first, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up1.UploadID, IdempotencyKey: key,
			})
			mustf(t, err, "first copy with upload_id")

			// Same key + same upload_id replays the first copy.
			replayed, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up1.UploadID, IdempotencyKey: key,
			})
			mustf(t, err, "replay with same key and upload_id")
			if replayed.Document.ID != first.Document.ID || replayed.Version.ID != first.Version.ID {
				t.Fatalf("replay = %s/%s, want %s/%s", replayed.Document.ID, replayed.Version.ID, first.Document.ID, first.Version.ID)
			}

			// Same key + different upload_id (or no upload_id) -> 409 idempotency_payload_mismatch.
			for _, otherUpload := range []string{up2.UploadID, ""} {
				_, err = env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
					Consent: "copy", UploadID: otherUpload, IdempotencyKey: key,
				})
				if ce := wantCode(t, err, "idempotency_payload_mismatch"); ce.Status != http.StatusConflict {
					t.Fatalf("mismatch upload_id=%q: %+v", otherUpload, ce)
				}
			}

			// New key + already-claimed upload_id -> 409 upload_already_committed.
			before := copyDocCount(t, env)
			_, err = env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up1.UploadID, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "upload_already_committed"); ce.Status != http.StatusConflict {
				t.Fatalf("reused upload_id with new key = %+v", ce)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("reused upload_id created a second copy")
			}

			// An upload committed on the source via CommitFileVersion is also refused by CopyDocument.
			_, err = env.commit(member, src.Document.ID, up2.UploadID, src.Document.Revision, util.NewID())
			mustf(t, err, "commit up2 on source")
			_, err = env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up2.UploadID, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "upload_already_committed"); ce.Status != http.StatusConflict {
				t.Fatalf("upload committed on source used in copy = %+v", ce)
			}
		})

		t.Run("claim and copy commit in one transaction and roll back together on failure", func(t *testing.T) {
			src := env.createFile(t, member, "tx-copy.md", []byte("# Nguon\n"))
			up := env.upload(t, member, src.Document.ID, "tx-copy-v2.md", []byte("# Ban sao tx\n"))
			boom := errors.New("injected failure after claim in copy")
			env.svc.store.afterClaim = func() error { return boom }
			key := util.NewID()
			before := copyDocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up.UploadID, IdempotencyKey: key,
			})
			env.svc.store.afterClaim = nil
			if !errors.Is(err, boom) {
				t.Fatalf("copy with injected failure = %v, want %v", err, boom)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("failed copy left a document row behind")
			}
			if env.real != nil {
				if st := env.sessionStatus(t, up.UploadID); st != "staged" {
					t.Fatalf("upload session after rollback = %s, want staged", st)
				}
			}
			// Retry with the same upload and key succeeds once the failure clears.
			copied, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", UploadID: up.UploadID, IdempotencyKey: key,
			})
			mustf(t, err, "retry copy after rollback")
			if copied.Version.FileID.String != up.UploadID {
				t.Fatalf("copied file_id = %s, want %s", copied.Version.FileID.String, up.UploadID)
			}
			if env.real != nil {
				if st := env.sessionStatus(t, up.UploadID); st != "claimed" {
					t.Fatalf("upload session after commit = %s, want claimed", st)
				}
			}
		})

		t.Run("upload_id together with job_id is 400 invalid", func(t *testing.T) {
			src := env.createFile(t, member, "both.md", []byte("# Nguon\n"))
			up := env.upload(t, member, src.Document.ID, "both-v2.md", []byte("# Ban 2\n"))
			before := copyDocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: util.NewID(), UploadID: up.UploadID, IdempotencyKey: util.NewID(),
			})
			var ve ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("copy with both job_id and upload_id = %v, want ValidationError (400)", err)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("refused copy created a document")
			}
		})
	})
}

func TestDocumentCopyUploadSizeCap(t *testing.T) {
	ctx := context.Background()
	const initialCap = int64(8192)
	const loweredCap = int64(2048)
	env := fakeDocStorageEnvWithCap(t, initialCap)
	member := human(env.tn.member)
	src := env.createFile(t, member, "cap.md", []byte("# Small\n"))

	// An upload exceeding DOCUMENT_MAX_BYTES is refused at stage time with 413 file_too_large + max_bytes.
	_, err := env.svc.UploadDocumentFile(ctx, member, src.Document.ID, DocumentUploadInput{
		Filename: "over.md", Body: bytes.NewReader(bytes.Repeat([]byte("a"), int(initialCap+1))),
		IdempotencyKey: util.NewID(),
	})
	if ce := wantCode(t, err, "file_too_large"); ce.Status != http.StatusRequestEntityTooLarge || ce.Fields["max_bytes"] != initialCap {
		t.Fatalf("upload over cap = %+v, want 413 file_too_large max_bytes=%d", ce, initialCap)
	}

	// If an upload was staged under a higher cap and the service cap is lowered before CopyDocument,
	// CopyDocument enforces the cap with the same 413 file_too_large + max_bytes.
	up := env.upload(t, member, src.Document.ID, "staged-4k.md", bytes.Repeat([]byte("b"), 4096))
	env.svc.SetFiles(filesfakeWithCapFrom(env.fake, loweredCap))
	_, err = env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
		Consent: "copy", UploadID: up.UploadID, IdempotencyKey: util.NewID(),
	})
	if ce := wantCode(t, err, "file_too_large"); ce.Status != http.StatusRequestEntityTooLarge || ce.Fields["max_bytes"] != loweredCap {
		t.Fatalf("copy over cap = %+v, want 413 file_too_large max_bytes=%d", ce, loweredCap)
	}
}

type cappedRegistryFiles struct {
	files.Service
	reg files.Registry
}

func (c cappedRegistryFiles) Registry() files.Registry { return c.reg }
func (c cappedRegistryFiles) Unwrap() files.Service    { return c.Service }

func filesfakeWithCapFrom(base files.Service, capBytes int64) files.Service {
	specs := files.SpecsWithDocumentMaxBytes(capBytes)
	for i := range specs {
		specs[i].Disabled = false
	}
	reg, err := files.NewRegistry(specs...)
	if err != nil {
		panic(err)
	}
	return cappedRegistryFiles{Service: base, reg: reg}
}
