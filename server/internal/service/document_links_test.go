package service

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-676 (G1-02b): public links and the byte paths behind them. The token
// is 32 random bytes stored only as a hash; 7 days by default, 90 at most,
// 5 live per document; the entitlement and the organization switch are both
// required; anonymous is view only; every public read, asset and download
// re-checks flag, expiry and revoke, and bytes stream through Go.

var (
	testPDF = []byte("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
	testPNG = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0dIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")
)

func (f *docPermFixture) withLinks(t *testing.T) *filesfake.Fake {
	t.Helper()
	f.svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	fake := filesfake.New(filesfake.Options{})
	f.svc.SetFiles(fake)
	return fake
}

func (f *docPermFixture) upload(t *testing.T, fake *filesfake.Fake, tn docTenant, ws string, purpose files.UploadPurpose, name string, body []byte) string {
	t.Helper()
	up, err := fake.Upload(f.ctx, files.UploadInput{
		Actor: Human(tn.owner.ID), Purpose: purpose,
		Scope:          files.Scope{OrganizationID: tn.orgID, WorkspaceID: ws},
		IdempotencyKey: util.NewID(), Filename: name, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(up.File.ID)
}

// fileDoc builds a file document whose current version points at fileID.
func (f *docPermFixture) fileDoc(t *testing.T, tn docTenant, visibility, fileID string) db.Document {
	t.Helper()
	id, verID := util.NewID(), util.NewID()
	insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA, "kind": "file",
		"visibility": visibility, "acl_owner_id": tn.aclOwner.ID,
		"created_by": tn.aclOwner.ID, "updated_by": tn.aclOwner.ID,
		"file_version_id": verID, "current_version": 1,
	}))
	insertRow(t, f.ctx, f.pool, "document_versions", map[string]any{
		"id": verID, "organization_id": tn.orgID, "workspace_id": tn.wsA, "document_id": id,
		"version": 1, "kind": "file", "reason": "upload", "file_id": fileID,
		"created_by": tn.aclOwner.ID, "created_by_kind": "human",
	})
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func readAll(t *testing.T, r files.Reader) []byte {
	t.Helper()
	defer func() { _ = r.Close() }()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDocumentPublicLink(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "link")
	fake := f.withLinks(t)
	mgr := Human(tn.aclOwner.ID)
	page := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	t.Run("organization switch is off by default and admin-only", func(t *testing.T) {
		if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 0); !codedIs(err, "document_links_disabled") {
			t.Fatalf("switch off: %v", err)
		}
		if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.member.ID), tn.orgID, true); !errors.Is(err, ErrForbidden) {
			t.Fatalf("member toggling: %v", err)
		}
		if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.outsider.ID), util.NewID(), true); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown org: %v", err)
		}
		if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.orgAdmin.ID), tn.orgID, true); err != nil {
			t.Fatal(err)
		}
		if n := countAudit(t, f, audit.ActionDocumentSettingsChanged, tn.orgID); n != 1 {
			t.Fatalf("settings audit rows = %d", n)
		}
		// Idempotent: no change, no audit row.
		if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.owner.ID), tn.orgID, true); err != nil {
			t.Fatal(err)
		}
		if n := countAudit(t, f, audit.ActionDocumentSettingsChanged, tn.orgID); n != 1 {
			t.Fatalf("settings audit rows after no-op = %d", n)
		}
	})

	var token string
	var link db.DocumentShareLink
	t.Run("create: random token stored as a hash, default 7 days", func(t *testing.T) {
		if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 91); err == nil {
			t.Fatal("91 days accepted")
		}
		if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, -1); err == nil {
			t.Fatal("negative days accepted")
		}
		out, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 0)
		if err != nil {
			t.Fatal(err)
		}
		token, link = out.Token, out.Link
		if len(token) != 43 {
			t.Fatalf("token length %d, want 43 (32 bytes base64url)", len(token))
		}
		if link.TokenHash == token || link.TokenHash != hashDocumentLinkToken(token) {
			t.Fatal("token must be stored only as its hash")
		}
		var hits int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM document_share_links l, audit_events a
			 WHERE l.token_hash = $1 OR a.changes::text LIKE '%' || $1 || '%' OR a.metadata::text LIKE '%' || $1 || '%'`,
			token).Scan(&hits); err != nil {
			t.Fatal(err)
		}
		if hits != 0 {
			t.Fatal("the raw token reached the database")
		}
		want := time.Now().Add(7 * 24 * time.Hour)
		if d := link.ExpiresAt.Time.Sub(want); d > time.Minute || d < -time.Minute {
			t.Fatalf("expires_at %v, want ~%v", link.ExpiresAt.Time, want)
		}
		if n := countAudit(t, f, audit.ActionDocumentLinkCreated, page.ID); n != 1 {
			t.Fatalf("link_created audit rows = %d", n)
		}
		if n := countOutbox(t, f, "document.link_created", page.ID); n != 1 {
			t.Fatalf("link_created events = %d", n)
		}
		out90, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 90)
		if err != nil {
			t.Fatal(err)
		}
		if d := out90.Link.ExpiresAt.Time.Sub(time.Now().Add(90 * 24 * time.Hour)); d > time.Minute || d < -time.Minute {
			t.Fatalf("90-day link expires %v", out90.Link.ExpiresAt.Time)
		}
	})

	t.Run("anonymous read is view only and logged without an actor", func(t *testing.T) {
		pub, err := f.svc.OpenPublicDocument(f.ctx, token)
		if err != nil {
			t.Fatal(err)
		}
		if pub.Document.ID != page.ID || pub.Link.ViewCount != 1 || !pub.Link.LastViewedAt.Valid {
			t.Fatalf("public read: %+v", pub.Link)
		}
		var kind string
		var actorID, linkID *string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT actor_kind, actor_id, share_link_id FROM document_access_logs WHERE document_id = $1 AND action = 'link_view'`,
			page.ID).Scan(&kind, &actorID, &linkID); err != nil {
			t.Fatal(err)
		}
		if kind != "anonymous" || actorID != nil || linkID == nil || *linkID != link.ID {
			t.Fatalf("access log: %s %v %v", kind, actorID, linkID)
		}
		for _, bad := range []string{"", token + "x", strings.Repeat("a", 43), strings.Repeat("a", 500)} {
			if _, err := f.svc.OpenPublicDocument(f.ctx, bad); !errors.Is(err, ErrNotFound) {
				t.Fatalf("token %q: %v", bad, err)
			}
		}
	})

	t.Run("five live links per document", func(t *testing.T) {
		for i := 0; i < 3; i++ {
			if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 1); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 1); !codedIs(err, "document_link_limit") {
			t.Fatalf("sixth link: %v", err)
		}
		// An expired link no longer counts.
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE document_share_links SET expires_at = now() - interval '1 second'
			 WHERE id = (SELECT id FROM document_share_links WHERE document_id = $1 AND id <> $2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`,
			page.ID, link.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 1); err != nil {
			t.Fatalf("after expiry frees a slot: %v", err)
		}
	})

	t.Run("who may create and revoke", func(t *testing.T) {
		if _, err := f.svc.ShareDocument(f.ctx, mgr, page.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.CreateDocumentLink(f.ctx, Human(tn.outsider.ID), page.ID, 1); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor creating a link: %v", err)
		}
		if err := f.svc.RevokeDocumentLink(f.ctx, Human(tn.outsider.ID), page.ID, link.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor revoking: %v", err)
		}
		if _, err := f.svc.CreateDocumentLink(f.ctx, Human(tn.member.ID), page.ID, 1); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader creating: %v", err)
		}
		owned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPLINK000000000000000000"})
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelManage})
		defer f.svc.SetOwnerLevelResolver(nil)
		if _, err := f.svc.CreateDocumentLink(f.ctx, Human(tn.member.ID), owned.ID, 1); !codedIs(err, "document_owned_by_work_product") {
			t.Fatalf("owned: %v", err)
		}
		if err := f.svc.RevokeDocumentLink(f.ctx, Human(tn.member.ID), owned.ID, link.ID); !codedIs(err, "document_owned_by_work_product") {
			t.Fatalf("owned revoke: %v", err)
		}
	})

	t.Run("revoke blocks the next read", func(t *testing.T) {
		if err := f.svc.RevokeDocumentLink(f.ctx, mgr, page.ID, link.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.OpenPublicDocument(f.ctx, token); !errors.Is(err, ErrNotFound) {
			t.Fatalf("read after revoke: %v", err)
		}
		if err := f.svc.RevokeDocumentLink(f.ctx, mgr, page.ID, link.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("second revoke: %v", err)
		}
		if n := countOutbox(t, f, "document.link_revoked", page.ID); n != 1 {
			t.Fatalf("link_revoked events = %d", n)
		}
	})

	t.Run("every public read re-checks flag, entitlement, expiry, tenant and document", func(t *testing.T) {
		// Start from a clean slot budget.
		if _, err := f.pool.Exec(f.ctx, `UPDATE document_share_links SET revoked_at = now() WHERE document_id = $1`, page.ID); err != nil {
			t.Fatal(err)
		}
		out, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		tok := out.Token
		mustOpen := func(want bool, why string) {
			t.Helper()
			_, err := f.svc.OpenPublicDocument(f.ctx, tok)
			if want && err != nil {
				t.Fatalf("%s: %v", why, err)
			}
			if !want && !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s: %v, want ErrNotFound", why, err)
			}
		}
		mustOpen(true, "baseline")
		steps := []struct {
			why        string
			off, reset string
			args       []any
		}{
			{"organization switch off", `UPDATE document_settings SET public_links_enabled = false WHERE organization_id = $1`,
				`UPDATE document_settings SET public_links_enabled = true WHERE organization_id = $1`, []any{tn.orgID}},
			{"entitlement off", `UPDATE plan_features SET enabled = false WHERE feature_key = 'documents.public_links'`,
				`UPDATE plan_features SET enabled = true WHERE feature_key = 'documents.public_links'`, nil},
			{"organization suspended", `UPDATE organizations SET status = 'suspended' WHERE id = $1`,
				`UPDATE organizations SET status = 'active' WHERE id = $1`, []any{tn.orgID}},
			{"document archived", `UPDATE documents SET archived_at = now() WHERE id = $1`,
				`UPDATE documents SET archived_at = NULL WHERE id = $1`, []any{page.ID}},
			{"link expired", `UPDATE document_share_links SET expires_at = now() - interval '1 second' WHERE id = $1`,
				`UPDATE document_share_links SET expires_at = now() + interval '1 day' WHERE id = $1`, []any{out.Link.ID}},
		}
		for _, s := range steps {
			if _, err := f.pool.Exec(f.ctx, s.off, s.args...); err != nil {
				t.Fatal(err)
			}
			mustOpen(false, s.why)
			if _, err := f.pool.Exec(f.ctx, s.reset, s.args...); err != nil {
				t.Fatal(err)
			}
			mustOpen(true, "after restoring "+s.why)
		}
	})

	t.Run("file bytes stream through Go, private and public, and stop on revoke", func(t *testing.T) {
		fileID := f.upload(t, fake, tn, tn.wsA, files.DocumentFile, "report.pdf", testPDF)
		fd := f.fileDoc(t, tn, "restricted", fileID)
		assetFile := f.upload(t, fake, tn, tn.wsA, files.DocumentAsset, "a.png", testPNG)
		asset, err := f.q.InsertDocumentAsset(f.ctx, db.InsertDocumentAssetParams{
			ID: util.NewID(), OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: page.ID,
			FileID: assetFile, MimeType: "image/png", SizeBytes: int64(len(testPNG)),
			CreatedBy: tn.aclOwner.ID, CreatedByKind: "human",
		})
		if err != nil {
			t.Fatal(err)
		}

		// Private: a reader streams, a non-reader is not found, a revoke
		// stops the next read.
		sh, err := f.svc.ShareDocument(f.ctx, mgr, fd.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.bMember.ID, Level: DocumentLevelView,
		})
		if err != nil {
			t.Fatal(err)
		}
		got, err := f.svc.OpenDocumentFile(f.ctx, Human(tn.bMember.ID), fd.ID, 0, DocumentByteRange{})
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(readAll(t, got.Reader), testPDF) || got.Version.Version != 1 {
			t.Fatal("private download bytes differ")
		}
		ranged, err := f.svc.OpenDocumentFile(f.ctx, Human(tn.bMember.ID), fd.ID, 1, DocumentByteRange{Offset: 1, Length: 3})
		if err != nil || string(readAll(t, ranged.Reader)) != "PDF" {
			t.Fatalf("range read: %v", err)
		}
		if _, err := f.svc.OpenDocumentFile(f.ctx, Human(tn.member.ID), fd.ID, 0, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader download: %v", err)
		}
		if _, err := f.svc.OpenDocumentFile(f.ctx, Human(tn.bMember.ID), fd.ID, 9, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("missing version: %v", err)
		}
		if _, err := f.svc.OpenDocumentFile(f.ctx, mgr, page.ID, 0, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("download of a page: %v", err)
		}
		if err := f.svc.RevokeDocumentShare(f.ctx, mgr, fd.ID, sh.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.OpenDocumentFile(f.ctx, Human(tn.bMember.ID), fd.ID, 0, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("download after revoke: %v", err)
		}
		var downloads int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM document_access_logs WHERE document_id = $1 AND action = 'download' AND via = 'share' AND version = 1`,
			fd.ID).Scan(&downloads); err != nil || downloads != 1 {
			t.Fatalf("download log rows = %d (%v)", downloads, err)
		}
		pa, err := f.svc.OpenDocumentAsset(f.ctx, mgr, page.ID, asset.ID, DocumentByteRange{})
		if err != nil || !bytes.Equal(readAll(t, pa), testPNG) {
			t.Fatalf("private asset: %v", err)
		}

		// Public: the file and the asset stream while the link lives.
		pl, err := f.svc.CreateDocumentLink(f.ctx, mgr, fd.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		pf, err := f.svc.OpenPublicDocumentFile(f.ctx, pl.Token, DocumentByteRange{})
		if err != nil || !bytes.Equal(readAll(t, pf.Reader), testPDF) {
			t.Fatalf("public file: %v", err)
		}
		if _, err := f.svc.OpenPublicDocumentAsset(f.ctx, pl.Token, asset.ID, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("asset of another document through this link: %v", err)
		}
		if _, err := f.pool.Exec(f.ctx, `UPDATE document_share_links SET revoked_at = now() WHERE document_id = $1`, page.ID); err != nil {
			t.Fatal(err)
		}
		plPage, err := f.svc.CreateDocumentLink(f.ctx, mgr, page.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		pubAsset, err := f.svc.OpenPublicDocumentAsset(f.ctx, plPage.Token, asset.ID, DocumentByteRange{})
		if err != nil || !bytes.Equal(readAll(t, pubAsset.Reader), testPNG) {
			t.Fatalf("public asset: %v", err)
		}
		if pubAsset.OrganizationID != tn.orgID {
			t.Fatalf("public asset org = %q, want %q", pubAsset.OrganizationID, tn.orgID)
		}
		if err := f.svc.RevokeDocumentLink(f.ctx, mgr, fd.ID, pl.Link.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.OpenPublicDocumentFile(f.ctx, pl.Token, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("public file after revoke: %v", err)
		}
		if err := f.svc.RevokeDocumentLink(f.ctx, mgr, page.ID, plPage.Link.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.OpenPublicDocumentAsset(f.ctx, plPage.Token, asset.ID, DocumentByteRange{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("public asset after revoke: %v", err)
		}
	})
}
