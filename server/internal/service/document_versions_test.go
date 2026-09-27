package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-678 (G1-04a step 2): page versions and restore. A manual version is
// taken only when the working copy changed; the list pages on a stable
// version cursor; restore appends a version, bumps the revision and never
// rewrites history; page bytes go through the storage.bytes Consume path.

func (e *docStorageEnv) page(t *testing.T, actor Actor, content json.RawMessage) DocumentView {
	t.Helper()
	v, err := e.svc.CreatePage(context.Background(), actor, e.tn.wsA, CreatePageInput{Title: "Trang", Content: content})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func (e *docStorageEnv) save(t *testing.T, actor Actor, id string, rev int64, content json.RawMessage) DocumentView {
	t.Helper()
	v, err := e.svc.UpdateDocument(context.Background(), actor, id, UpdateDocumentInput{Revision: rev, Content: content})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDocumentVersion(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	tn := env.tn
	member := Human(tn.member.ID)

	p := env.page(t, member, pageJSON("bản A"))
	id := p.Document.ID

	t.Run("manual version only when the working copy changed", func(t *testing.T) {
		v1, err := env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{Label: "  Bản đầu  "})
		if err != nil {
			t.Fatal(err)
		}
		if v1.Version != 1 || v1.Reason != "manual" || v1.Kind != DocumentKindPage || v1.Label.String != "Bản đầu" ||
			v1.SizeBytes != int64(p.Document.ContentBytes) || v1.CreatedBy != tn.member.ID || v1.CreatedByKind != "human" ||
			!sameJSON(v1.Content, p.Document.Content) {
			t.Fatalf("v1 = %+v", v1)
		}
		d := env.doc(t, id)
		if d.CurrentVersion != 1 || d.Revision != 1 || !d.LastVersionAt.Valid {
			t.Fatalf("document after a manual version = rev %d cur %d", d.Revision, d.CurrentVersion)
		}
		if env.countAudit(t, "document.version_created", id) != 1 || env.countOutbox(t, "document.version_created", id) != 1 {
			t.Fatal("version_created audit/outbox missing")
		}
		_, err = env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{})
		if ce := wantCode(t, err, "document_version_unchanged"); ce.Status != 409 {
			t.Fatalf("unchanged status = %d", ce.Status)
		}
		env.save(t, member, id, 1, pageJSON("bản B"))
		v2, err := env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{})
		if err != nil || v2.Version != 2 || v2.Label.Valid {
			t.Fatalf("v2 = %+v %v", v2, err)
		}
		if _, err := env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{Label: strings.Repeat("a", 201)}); !isValidation(err) {
			t.Fatalf("long label: %v", err)
		}
	})

	t.Run("version levels", func(t *testing.T) {
		d := env.doc(t, id)
		env.f.share(t, d, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.member.ID)
		viewer := Human(tn.bMember.ID)
		if _, err := env.svc.CreateDocumentVersion(ctx, viewer, id, CreateDocumentVersionInput{}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer create: %v", err)
		}
		if _, err := env.svc.RestoreDocumentVersion(ctx, viewer, id, RestoreDocumentVersionInput{Version: 1}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer restore: %v", err)
		}
		for name, a := range map[string]Actor{"outsider": Human(tn.outsider.ID), "agent": agentActor(tn.agentOut)} {
			if _, err := env.svc.CreateDocumentVersion(ctx, a, id, CreateDocumentVersionInput{}); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s create: %v", name, err)
			}
			if _, err := env.svc.ListDocumentVersions(ctx, a, id, ListDocumentVersionsInput{}); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s list: %v", name, err)
			}
			if _, err := env.svc.GetDocumentVersion(ctx, a, id, 1); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s get: %v", name, err)
			}
		}
		// The viewer reads the history.
		if _, err := env.svc.GetDocumentVersion(ctx, viewer, id, 1); err != nil {
			t.Fatal(err)
		}
		if env.accessLogs(t, id, "view") < 1 {
			t.Fatal("reading a version logs a view")
		}
		var logged int32
		if err := env.f.pool.QueryRow(ctx,
			`SELECT version FROM document_access_logs WHERE document_id = $1 AND actor_id = $2`, id, tn.bMember.ID,
		).Scan(&logged); err != nil || logged != 1 {
			t.Fatalf("access log version = %d %v", logged, err)
		}
	})

	t.Run("list pages on a stable cursor without content", func(t *testing.T) {
		d := env.doc(t, id)
		env.save(t, member, id, d.Revision, pageJSON("bản C"))
		if _, err := env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{}); err != nil {
			t.Fatal(err)
		}
		first, err := env.svc.ListDocumentVersions(ctx, member, id, ListDocumentVersionsInput{Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		if len(first.Versions) != 2 || first.Versions[0].Version != 3 || first.Versions[1].Version != 2 || first.NextCursor == "" {
			t.Fatalf("first page = %+v", first)
		}
		for _, v := range first.Versions {
			if v.Content != nil || v.DocumentID != id {
				t.Fatalf("list row carries content or wrong doc: %+v", v)
			}
		}
		// A version landing between the two reads does not shift the next page.
		d = env.doc(t, id)
		env.save(t, member, id, d.Revision, pageJSON("bản D"))
		if _, err := env.svc.CreateDocumentVersion(ctx, member, id, CreateDocumentVersionInput{}); err != nil {
			t.Fatal(err)
		}
		second, err := env.svc.ListDocumentVersions(ctx, member, id, ListDocumentVersionsInput{Limit: 2, Cursor: first.NextCursor})
		if err != nil {
			t.Fatal(err)
		}
		if len(second.Versions) != 1 || second.Versions[0].Version != 1 || second.NextCursor != "" {
			t.Fatalf("second page = %+v", second)
		}
		all, err := env.svc.ListDocumentVersions(ctx, member, id, ListDocumentVersionsInput{})
		if err != nil || len(all.Versions) != 4 {
			t.Fatalf("default limit = %d %v", len(all.Versions), err)
		}
		for _, bad := range []string{"%%%", "eyJ4IjoxfQ", "e30"} {
			if _, err := env.svc.ListDocumentVersions(ctx, member, id, ListDocumentVersionsInput{Cursor: bad}); !isValidation(err) {
				t.Fatalf("cursor %q: %v", bad, err)
			}
		}
		if _, err := env.svc.GetDocumentVersion(ctx, member, id, 99); !errors.Is(err, ErrNotFound) {
			t.Fatalf("missing version: %v", err)
		}
	})

	t.Run("restore appends a version and bumps the revision", func(t *testing.T) {
		before := env.doc(t, id)
		v1Before, err := env.svc.GetDocumentVersion(ctx, member, id, 1)
		if err != nil {
			t.Fatal(err)
		}
		_, err = env.svc.RestoreDocumentVersion(ctx, member, id, RestoreDocumentVersionInput{Version: 1, BaseRevision: before.Revision - 1})
		wantCode(t, err, "revision_conflict")

		res, err := env.svc.RestoreDocumentVersion(ctx, member, id, RestoreDocumentVersionInput{Version: 1, BaseRevision: before.Revision})
		if err != nil {
			t.Fatal(err)
		}
		d := res.View.Document
		if res.Version.Version != before.CurrentVersion+1 || res.Version.Reason != "restore" || res.Version.RestoredFrom.Int32 != 1 ||
			!sameJSON(res.Version.Content, v1Before.Content) || res.Version.SizeBytes != v1Before.SizeBytes {
			t.Fatalf("restore version = %+v", res.Version)
		}
		if d.Revision != before.Revision+1 || d.CurrentVersion != res.Version.Version || d.ContentText != "bản A" ||
			!sameJSON(d.Content, v1Before.Content) || res.View.Access.Level != DocumentLevelManage { // the creator holds the ACL
			t.Fatalf("restored document = %+v", res.View)
		}
		// History is appended, never rewritten.
		vs := env.versions(t, d)
		if len(vs) != int(res.Version.Version) {
			t.Fatalf("versions = %d, want %d", len(vs), res.Version.Version)
		}
		v1After, _ := env.svc.GetDocumentVersion(ctx, member, id, 1)
		if v1After.ID != v1Before.ID || !bytes.Equal(v1After.Content, v1Before.Content) {
			t.Fatal("restore rewrote version 1")
		}
		// No base means "restore over whatever is there" (the contract's
		// restore has no body).
		again, err := env.svc.RestoreDocumentVersion(ctx, member, id, RestoreDocumentVersionInput{Version: 2})
		if err != nil || again.View.Document.ContentText != "bản B" || again.View.Document.Revision != d.Revision+1 {
			t.Fatalf("restore without base: %+v %v", again.View.Document, err)
		}
		if _, err := env.svc.RestoreDocumentVersion(ctx, member, id, RestoreDocumentVersionInput{Version: 99}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("restore missing version: %v", err)
		}
		if env.countAudit(t, "document.version_restored", id) != 2 {
			t.Fatal("restore audits document.version_restored")
		}
	})

	t.Run("restore of a file version points back at its file", func(t *testing.T) {
		created := env.createFile(t, member, "bao-cao.pdf", pdfBody("v1"))
		fid := created.Document.ID
		up := env.upload(t, member, fid, "bao-cao-v2.pdf", pdfBody("v2"))
		v2, err := env.commit(member, fid, up.UploadID, created.Document.Revision, "")
		if err != nil {
			t.Fatal(err)
		}
		res, err := env.svc.RestoreDocumentVersion(ctx, member, fid, RestoreDocumentVersionInput{Version: 1, BaseRevision: v2.Document.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if res.Version.Reason != "restore" || res.Version.FileID != created.Version.FileID || res.File == nil ||
			res.File.FileID != created.Version.FileID.String || res.View.Document.CurrentVersion != 3 {
			t.Fatalf("file restore = %+v", res)
		}
		got, err := env.svc.GetDocument(ctx, member, fid)
		if err != nil || got.File == nil || got.File.VersionID != res.Version.ID || got.File.Filename == "" {
			t.Fatalf("file view = %+v %v", got.File, err)
		}
		if _, err := env.svc.CreateDocumentVersion(ctx, member, fid, CreateDocumentVersionInput{}); !isValidation(err) {
			t.Fatalf("manual version of a file: %v", err)
		}
	})

	t.Run("idempotent create and version", func(t *testing.T) {
		key := "k-" + util.NewID()
		a, err := env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Title: "Một lần", IdempotencyKey: key})
		if err != nil {
			t.Fatal(err)
		}
		b, err := env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Title: "Một lần", IdempotencyKey: key})
		if err != nil || b.Document.ID != a.Document.ID {
			t.Fatalf("replayed create = %v %v", b.Document.ID, err)
		}
		_, err = env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Title: "Khác", IdempotencyKey: key})
		wantCode(t, err, "idempotency_payload_mismatch")
		_, err = env.svc.CreatePage(ctx, Human(tn.wsAdmin.ID), tn.wsA, CreatePageInput{Title: "Một lần", IdempotencyKey: key})
		wantCode(t, err, "idempotency_key_reuse")

		env.save(t, member, a.Document.ID, 1, pageJSON("có nội dung"))
		vk := "v-" + util.NewID()
		v1, err := env.svc.CreateDocumentVersion(ctx, member, a.Document.ID, CreateDocumentVersionInput{Label: "x", IdempotencyKey: vk})
		if err != nil {
			t.Fatal(err)
		}
		v1r, err := env.svc.CreateDocumentVersion(ctx, member, a.Document.ID, CreateDocumentVersionInput{Label: "x", IdempotencyKey: vk})
		if err != nil || v1r.ID != v1.ID {
			t.Fatalf("replayed version = %v %v", v1r.ID, err)
		}
		if env.countAudit(t, "document.version_created", a.Document.ID) != 1 {
			t.Fatal("a replay must not audit twice")
		}
		_, err = env.svc.CreateDocumentVersion(ctx, member, a.Document.ID, CreateDocumentVersionInput{Label: "y", IdempotencyKey: vk})
		wantCode(t, err, "idempotency_payload_mismatch")
	})

	t.Run("page bytes go through the storage quota", func(t *testing.T) {
		q := env.page(t, member, pageJSON(strings.Repeat("nội dung ", 50)))
		env.setStorageLimit(t, env.usage(t)+10)
		_, err := env.svc.CreateDocumentVersion(ctx, member, q.Document.ID, CreateDocumentVersionInput{})
		wantCode(t, err, "quota_exceeded")
		if d := env.doc(t, q.Document.ID); d.CurrentVersion != 0 {
			t.Fatal("a refused version was written")
		}
		_, err = env.svc.UpdateDocument(ctx, member, q.Document.ID, UpdateDocumentInput{Revision: 1, Content: pageJSON(strings.Repeat("dài hơn ", 200))})
		wantCode(t, err, "quota_exceeded")
		_, err = env.svc.CreatePage(ctx, member, tn.wsA, CreatePageInput{Title: "to", Content: pageJSON(strings.Repeat("x", 500))})
		wantCode(t, err, "quota_exceeded")
		// Shrinking never needs room; a rename costs nothing.
		if _, err := env.svc.UpdateDocument(ctx, member, q.Document.ID, UpdateDocumentInput{Revision: 1, Content: pageJSON("ngắn")}); err != nil {
			t.Fatalf("shrinking save under a full quota: %v", err)
		}
		env.setStorageLimit(t, 1<<40)
	})
}

func TestDocumentAudit(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	tn := env.tn
	member := Human(tn.member.ID)

	t.Run("restore brings back an orphaned asset in the same transaction", func(t *testing.T) {
		p := env.page(t, member, nil)
		assetID := util.NewID()
		insertRow(t, ctx, env.f.pool, "document_assets", map[string]any{
			"id": assetID, "organization_id": tn.orgID, "workspace_id": tn.wsA, "document_id": p.Document.ID,
			"file_id": util.NewID(), "mime_type": "image/png", "size_bytes": 10,
			"created_by": tn.member.ID, "created_by_kind": "human",
		})
		env.save(t, member, p.Document.ID, 1, imagePageJSON(assetID))
		if _, err := env.svc.CreateDocumentVersion(ctx, member, p.Document.ID, CreateDocumentVersionInput{}); err != nil {
			t.Fatal(err)
		}
		env.save(t, member, p.Document.ID, 2, pageJSON("ảnh đã xoá"))
		// Well past the 7-day hold: only the version still keeps it.
		if _, err := env.f.pool.Exec(ctx, `UPDATE document_assets SET orphaned_at = now() - interval '9 days' WHERE id = $1`, assetID); err != nil {
			t.Fatal(err)
		}
		res, err := env.svc.RestoreDocumentVersion(ctx, member, p.Document.ID, RestoreDocumentVersionInput{Version: 1, BaseRevision: 3})
		if err != nil {
			t.Fatal(err)
		}
		a, err := env.f.q.GetDocumentAsset(ctx, db.GetDocumentAssetParams{
			ID: assetID, OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: p.Document.ID,
		})
		if err != nil || a.OrphanedAt.Valid {
			t.Fatalf("asset after restore: orphaned=%v %v", a.OrphanedAt.Valid, err)
		}
		if !strings.Contains(string(res.View.Document.Content), "asset://"+assetID) {
			t.Fatal("restored content lost the image")
		}
	})

	t.Run("version audit rows carry no page content", func(t *testing.T) {
		p := env.page(t, member, pageJSON("điều bí mật"))
		if _, err := env.svc.CreateDocumentVersion(ctx, member, p.Document.ID, CreateDocumentVersionInput{Label: "nhãn"}); err != nil {
			t.Fatal(err)
		}
		env.save(t, member, p.Document.ID, 1, pageJSON("khác"))
		if _, err := env.svc.RestoreDocumentVersion(ctx, member, p.Document.ID, RestoreDocumentVersionInput{Version: 1}); err != nil {
			t.Fatal(err)
		}
		var text string
		if err := env.f.pool.QueryRow(ctx,
			`SELECT coalesce(string_agg(changes::text || ' ' || metadata::text, ' '), '') FROM audit_events WHERE resource_id = $1`, p.Document.ID,
		).Scan(&text); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(text, "bí mật") || strings.Contains(text, `"paragraph"`) {
			t.Fatalf("audit carries content: %s", text)
		}
		if env.countAudit(t, "document.version_created", p.Document.ID) != 1 || env.countAudit(t, "document.version_restored", p.Document.ID) != 1 {
			t.Fatal("version audit rows missing")
		}
		if env.countOutbox(t, "document.version_created", p.Document.ID) != 2 {
			t.Fatal("manual + restore each emit document.version_created")
		}
	})

	// A save and a restore on the same base: the row lock orders them and
	// exactly one wins; the loser is revision_conflict and writes nothing.
	t.Run("a save and a restore on one base", func(t *testing.T) {
		p := env.page(t, member, pageJSON("gốc"))
		if _, err := env.svc.CreateDocumentVersion(ctx, member, p.Document.ID, CreateDocumentVersionInput{}); err != nil {
			t.Fatal(err)
		}
		id := p.Document.ID
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
		if _, err := env.f.q.WithTx(holder).LockDocumentByID(ctx, id); err != nil {
			t.Fatal(err)
		}
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		errs := make(chan error, 2)
		go func() {
			_, err := env.svc.UpdateDocument(cctx, member, id, UpdateDocumentInput{Revision: 1, Content: pageJSON("lưu")})
			errs <- err
		}()
		go func() {
			_, err := env.svc.RestoreDocumentVersion(cctx, Human(tn.wsAdmin.ID), id, RestoreDocumentVersionInput{Version: 1, BaseRevision: 1})
			errs <- err
		}()
		waitForLockWaitersOn(t, watch, 2)
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var won, lost int
		for i := 0; i < 2; i++ {
			switch err := <-errs; {
			case err == nil:
				won++
			case codedIs(err, "revision_conflict"):
				lost++
			default:
				t.Fatalf("racer: %v", err)
			}
		}
		if won != 1 || lost != 1 {
			t.Fatalf("won %d lost %d", won, lost)
		}
		if d := env.doc(t, id); d.Revision != 2 {
			t.Fatalf("revision = %d, want 2", d.Revision)
		}
	})
}
