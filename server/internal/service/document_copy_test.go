package service

import (
	"bytes"
	"context"
	"errors"
	"testing"

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
			// with one live share: the copy must inherit all three.
			if _, err := env.f.pool.Exec(ctx,
				`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`,
				src.Document.ID, env.tn.aclOwner.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := env.svc.ShareDocument(ctx, aclOwner, src.Document.ID, DocumentShareInput{
				PrincipalType: DocumentPrincipalWorkspace, PrincipalID: env.tn.wsA, Level: DocumentLevelView,
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
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("share editor copy into a workspace they are not in = %v, want ErrForbidden", err)
			}
			if after := copyDocCount(t, env); after != before {
				t.Fatal("a refused copy still wrote a document")
			}
		})
	})
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
		copyOf := func(t *testing.T, name string) DocumentFileResult {
			t.Helper()
			src := env.createFile(t, aclOwner, name, []byte("# Nguon\n"))
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
