package service

import (
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

// UNI-678 (G1-04a): create / get / update page. Content is sanitized before
// the transaction, the base revision is checked under the row lock, each
// field is gated by its own level, a non-member never learns the id exists,
// and an autosave audits metadata only.

func pageJSON(paragraphs ...string) json.RawMessage {
	blocks := make([]map[string]any, 0, len(paragraphs))
	for _, p := range paragraphs {
		blocks = append(blocks, map[string]any{
			"type":    "paragraph",
			"content": []any{map[string]any{"type": "text", "text": p}},
		})
	}
	raw, _ := json.Marshal(map[string]any{"type": "doc", "content": blocks})
	return raw
}

func imagePageJSON(assetID string) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "image", "attrs": map[string]any{"src": "asset://" + assetID}},
	}})
	return raw
}

func isValidation(err error) bool {
	var ve ValidationError
	return errors.As(err, &ve)
}

func countDocuments(t *testing.T, f *docPermFixture, workspaceID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1`, workspaceID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDocumentPage(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "page")
	member := Human(tn.member.ID)

	t.Run("create a root page sanitizes content and audits", func(t *testing.T) {
		raw := json.RawMessage(`{"type":"doc","content":[
			{"type":"paragraph","content":[{"type":"text","text":"Mục tiêu quý này."}]},
			{"type":"script","content":[{"type":"text","text":"alert(1)"}]},
			{"type":"image","attrs":{"src":"https://evil.example/x.png"}}]}`)
		v, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "  Kế hoạch Q4 ", Icon: "📄", Content: raw})
		if err != nil {
			t.Fatal(err)
		}
		d := v.Document
		if d.Title != "Kế hoạch Q4" || d.Kind != DocumentKindPage || d.Revision != 1 || d.CurrentVersion != 0 ||
			d.Position != 0 || d.Visibility != "workspace" || d.Icon.String != "📄" || d.ParentID.Valid {
			t.Fatalf("created = %+v", d)
		}
		if d.OrganizationID != tn.orgID || d.WorkspaceID != tn.wsA || d.CreatedBy != tn.member.ID ||
			d.CreatedByKind != "human" || d.AclOwnerID.String != tn.member.ID {
			t.Fatalf("attribution = %+v", d)
		}
		if strings.Contains(string(d.Content), "alert") || strings.Contains(string(d.Content), "evil") {
			t.Fatalf("content not sanitized: %s", d.Content)
		}
		if d.ContentText != "Mục tiêu quý này." || d.ContentBytes <= 0 || !strings.Contains(d.SearchText, "muc tieu") {
			t.Fatalf("text columns = %q %d %q", d.ContentText, d.ContentBytes, d.SearchText)
		}
		if d.ContentSavedAt.Valid {
			t.Fatal("a create is not an autosave")
		}
		if v.Access.Level != DocumentLevelManage || v.Access.Via != DocumentViaMember || len(v.Breadcrumbs) != 0 {
			t.Fatalf("view = %+v", v)
		}
		if countAudit(t, f, "document.created", d.ID) != 1 || countOutbox(t, f, "document.created", d.ID) != 1 {
			t.Fatal("document.created audit/outbox missing")
		}
	})

	t.Run("children inherit visibility, stack positions and carry breadcrumbs", func(t *testing.T) {
		parent, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Nội bộ", Icon: "📁", Visibility: "restricted"})
		if err != nil {
			t.Fatal(err)
		}
		c1, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent.Document.ID, Title: "Con 1"})
		if err != nil {
			t.Fatal(err)
		}
		c2, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent.Document.ID, Title: "Con 2"})
		if err != nil {
			t.Fatal(err)
		}
		if c1.Document.Visibility != "restricted" || c1.Document.ParentID.String != parent.Document.ID {
			t.Fatalf("child = %+v", c1.Document)
		}
		if c1.Document.Position != 0 || c2.Document.Position != 1 {
			t.Fatalf("positions = %v, %v", c1.Document.Position, c2.Document.Position)
		}
		want := []DocumentCrumb{{ID: parent.Document.ID, Title: "Nội bộ", Icon: "📁"}}
		if len(c1.Breadcrumbs) != 1 || c1.Breadcrumbs[0] != want[0] {
			t.Fatalf("breadcrumbs = %+v", c1.Breadcrumbs)
		}

		// A person who reads only the child sees no crumb of the parent
		// they cannot open: nothing above an unreadable ancestor leaks.
		grand, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: c1.Document.ID, Title: "Cháu", Visibility: "restricted"})
		if err != nil {
			t.Fatal(err)
		}
		f.share(t, grand.Document, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.member.ID)
		got, err := f.svc.GetDocument(f.ctx, Human(tn.bMember.ID), grand.Document.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Breadcrumbs) != 0 || got.Access.Level != DocumentLevelView || got.Access.Via != DocumentViaShare {
			t.Fatalf("shared reader view = %+v", got)
		}
		f.share(t, parent.Document, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.member.ID)
		got, err = f.svc.GetDocument(f.ctx, Human(tn.bMember.ID), grand.Document.ID)
		if err != nil {
			t.Fatal(err)
		}
		// c1 (between them) is still unreadable, so the chain stops there.
		if len(got.Breadcrumbs) != 0 {
			t.Fatalf("breadcrumbs past an unreadable ancestor = %+v", got.Breadcrumbs)
		}
		f.share(t, c1.Document, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.member.ID)
		got, err = f.svc.GetDocument(f.ctx, Human(tn.bMember.ID), grand.Document.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Breadcrumbs) != 2 || got.Breadcrumbs[0].ID != parent.Document.ID || got.Breadcrumbs[1].ID != c1.Document.ID {
			t.Fatalf("breadcrumbs root-first = %+v", got.Breadcrumbs)
		}
	})

	t.Run("create refusals", func(t *testing.T) {
		before := countDocuments(t, f, tn.wsA)
		if _, err := f.svc.CreatePage(f.ctx, Human(tn.bMember.ID), tn.wsA, CreatePageInput{Title: "x"}); !isGateRefusal(err) {
			t.Fatalf("non-member create: %v", err)
		}
		if _, err := f.svc.CreatePage(f.ctx, agentActor(tn.agent), tn.wsA, CreatePageInput{Title: "x"}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent create: %v, want ErrForbidden (ADR 0010)", err)
		}
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "   "}); !isValidation(err) {
			t.Fatalf("blank title: %v", err)
		}
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "x", Icon: "123456789"}); !isValidation(err) {
			t.Fatalf("long icon: %v", err)
		}
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "x", Visibility: "public"}); !isValidation(err) {
			t.Fatalf("bad visibility: %v", err)
		}
		// Sanitize rejects before any transaction: nothing is written.
		_, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "x", Content: json.RawMessage(`{"type":"paragraph"}`)})
		wantCode(t, err, "document_invalid")

		hidden := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: hidden.ID, Title: "x"}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unreadable parent: %v, want ErrNotFound", err)
		}
		f.share(t, hidden, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: hidden.ID, Title: "x"}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("view-only parent: %v, want ErrForbidden", err)
		}
		other := f.doc(t, tn, docSpec{ws: tn.wsB, visibility: "workspace", createdBy: tn.owner.ID})
		if _, err := f.svc.CreatePage(f.ctx, Human(tn.owner.ID), tn.wsA, CreatePageInput{ParentID: other.ID, Title: "x"}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("parent in another workspace: %v, want ErrNotFound", err)
		}
		if got := countDocuments(t, f, tn.wsA); got != before+1 { // +1: the hidden fixture row
			t.Fatalf("refused creates wrote rows: %d -> %d", before, got)
		}
	})

	t.Run("depth is capped at five", func(t *testing.T) {
		parent := ""
		for i := 1; i <= 5; i++ {
			v, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent, Title: "Cấp"})
			if err != nil {
				t.Fatalf("level %d: %v", i, err)
			}
			parent = v.Document.ID
		}
		_, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent, Title: "Cấp 6"})
		wantCode(t, err, "document_too_deep")
	})

	t.Run("get logs a view and hides the id from non-readers", func(t *testing.T) {
		v, err := f.svc.CreatePage(f.ctx, Human(tn.aclOwner.ID), tn.wsA, CreatePageInput{Title: "Đọc", Content: pageJSON("một")})
		if err != nil {
			t.Fatal(err)
		}
		got, err := f.svc.GetDocument(f.ctx, member, v.Document.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Document.ID != v.Document.ID || got.Access.Level != DocumentLevelEdit || string(got.Document.Content) == "" {
			t.Fatalf("get = %+v", got)
		}
		var logs int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM document_access_logs WHERE document_id = $1 AND action = 'view' AND actor_id = $2`,
			v.Document.ID, tn.member.ID).Scan(&logs); err != nil {
			t.Fatal(err)
		}
		if logs != 1 {
			t.Fatalf("view access logs = %d, want 1", logs)
		}
		restricted := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		for name, c := range map[string]struct {
			actor Actor
			id    string
		}{
			"other workspace": {Human(tn.bMember.ID), v.Document.ID},
			"no workspace":    {Human(tn.outsider.ID), v.Document.ID},
			"restricted":      {member, restricted.ID},
			"unknown id":      {member, util.NewID()},
		} {
			if _, err := f.svc.GetDocument(f.ctx, c.actor, c.id); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s: %v, want ErrNotFound", name, err)
			}
		}
	})

	t.Run("update", func(t *testing.T) {
		v, err := f.svc.CreatePage(f.ctx, Human(tn.aclOwner.ID), tn.wsA, CreatePageInput{Title: "Kế hoạch", Content: pageJSON("bí mật ban đầu")})
		if err != nil {
			t.Fatal(err)
		}
		id := v.Document.ID

		got, err := f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{
			Revision: 1, Title: strPtr("Kế hoạch (nháp)"), Content: pageJSON("nội dung mật mới"),
		})
		if err != nil {
			t.Fatal(err)
		}
		d := got.Document
		if d.Revision != 2 || d.Title != "Kế hoạch (nháp)" || d.ContentText != "nội dung mật mới" ||
			d.UpdatedBy != tn.member.ID || !d.ContentSavedAt.Valid || got.Access.Level != DocumentLevelEdit {
			t.Fatalf("updated = %+v", got)
		}
		if countAudit(t, f, "document.updated", id) != 1 || countOutbox(t, f, "document.updated", id) != 1 {
			t.Fatal("title change: want one audit row and one document.updated frame")
		}

		// Content-only autosave: audited as metadata, no frame (C-01 §5.1).
		if _, err := f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{Revision: 2, Content: pageJSON("gõ tiếp")}); err != nil {
			t.Fatal(err)
		}
		if countAudit(t, f, "document.updated", id) != 2 || countOutbox(t, f, "document.updated", id) != 1 {
			t.Fatal("autosave: want a second audit row and still one frame")
		}
		var auditText, payload string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT coalesce(string_agg(changes::text || ' ' || metadata::text, ' '), '') FROM audit_events WHERE resource_id = $1`, id,
		).Scan(&auditText); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(auditText, "mật") || strings.Contains(auditText, "gõ tiếp") || strings.Contains(auditText, `"type"`) {
			t.Fatalf("audit carries page content: %s", auditText)
		}
		if err := f.pool.QueryRow(f.ctx,
			`SELECT payload::text FROM outbox_events WHERE topic = 'document.updated' AND payload::jsonb->>'document_id' = $1`, id,
		).Scan(&payload); err != nil {
			t.Fatal(err)
		}
		var keys map[string]any
		if err := json.Unmarshal([]byte(payload), &keys); err != nil {
			t.Fatal(err)
		}
		if len(keys) != 2 || keys["document_id"] != id || keys["workspace_id"] != tn.wsA {
			t.Fatalf("document.updated payload = %s, want ids only", payload)
		}

		// A no-op patch changes nothing and writes nothing.
		same, err := f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{Revision: 3, Title: strPtr("Kế hoạch (nháp)"), Content: pageJSON("gõ tiếp")})
		if err != nil || same.Document.Revision != 3 || countAudit(t, f, "document.updated", id) != 2 {
			t.Fatalf("no-op patch: rev %d audits %d err %v", same.Document.Revision, countAudit(t, f, "document.updated", id), err)
		}

		// Stale base -> revision_conflict with the current revision.
		_, err = f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{Revision: 2, Title: strPtr("cũ")})
		ce := wantCode(t, err, "revision_conflict")
		if ce.Status != 422 || !errors.Is(err, ErrConflict) || ce.Fields["current_revision"] != "3" {
			t.Fatalf("conflict = %+v", ce)
		}

		// Per-field levels: visibility is manage; title/icon/content edit.
		if _, err := f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{Revision: 3, Visibility: strPtr("restricted")}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("edit changing visibility: %v, want ErrForbidden", err)
		}
		f.share(t, v.Document, DocumentPrincipalUser, tn.bMember.ID, DocumentLevelView, tn.aclOwner.ID)
		viewer := Human(tn.bMember.ID)
		for name, in := range map[string]UpdateDocumentInput{
			"title":   {Revision: 3, Title: strPtr("x")},
			"icon":    {Revision: 3, Icon: strPtr("🔥")},
			"content": {Revision: 3, Content: pageJSON("x")},
			// permission is checked before the base (DOC-005 §3)
			"stale title": {Revision: 1, Title: strPtr("x")},
		} {
			if _, err := f.svc.UpdateDocument(f.ctx, viewer, id, in); !errors.Is(err, ErrForbidden) {
				t.Fatalf("viewer %s: %v, want ErrForbidden", name, err)
			}
		}
		got, err = f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), id, UpdateDocumentInput{Revision: 3, Visibility: strPtr("restricted"), Icon: strPtr("🔥")})
		if err != nil || got.Document.Visibility != "restricted" || got.Document.Icon.String != "🔥" || got.Document.Revision != 4 {
			t.Fatalf("manage visibility: %+v %v", got.Document, err)
		}
		// Clearing the icon is an empty string.
		got, err = f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), id, UpdateDocumentInput{Revision: 4, Icon: strPtr("")})
		if err != nil || got.Document.Icon.Valid {
			t.Fatalf("clear icon: %+v %v", got.Document.Icon, err)
		}

		// Restricted now: the workspace member no longer finds it at all.
		if _, err := f.svc.UpdateDocument(f.ctx, member, id, UpdateDocumentInput{Revision: 5, Title: strPtr("x")}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("member after restrict: %v, want ErrNotFound", err)
		}
		if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.outsider.ID), id, UpdateDocumentInput{Revision: 5, Title: strPtr("x")}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("outsider: %v, want ErrNotFound", err)
		}

		// Sanitize and validation run before the transaction.
		_, err = f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), id, UpdateDocumentInput{Revision: 5, Content: json.RawMessage(`[]`)})
		wantCode(t, err, "document_invalid")
		if d, err := f.q.GetDocumentByID(f.ctx, id); err != nil || d.Revision != 5 || d.UpdatedBy != tn.aclOwner.ID {
			t.Fatalf("a rejected save touched the row: rev %d %v", d.Revision, err)
		}
		if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), id, UpdateDocumentInput{Revision: 5}); !isValidation(err) {
			t.Fatalf("empty patch: %v", err)
		}
		if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), id, UpdateDocumentInput{Revision: 5, Title: strPtr(strings.Repeat("a", 501))}); !isValidation(err) {
			t.Fatalf("long title: %v", err)
		}
	})

	t.Run("the trash is read-only", func(t *testing.T) {
		v, err := f.svc.CreatePage(f.ctx, Human(tn.aclOwner.ID), tn.wsA, CreatePageInput{Title: "Rác"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, v.Document.ID); err != nil {
			t.Fatal(err)
		}
		_, err = f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), v.Document.ID, UpdateDocumentInput{Revision: 1, Title: strPtr("x")})
		wantCode(t, err, "document_deleted")
		if _, err := f.svc.UpdateDocument(f.ctx, member, v.Document.ID, UpdateDocumentInput{Revision: 1, Title: strPtr("x")}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("editor on an archived page: %v, want ErrNotFound", err)
		}
	})

	t.Run("a file document takes metadata, never page content", func(t *testing.T) {
		fd := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET kind = 'file', content = NULL WHERE id = $1`, fd.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.UpdateDocument(f.ctx, member, fd.ID, UpdateDocumentInput{Revision: 1, Content: pageJSON("x")}); !isValidation(err) {
			t.Fatalf("content on a file: %v", err)
		}
		got, err := f.svc.UpdateDocument(f.ctx, member, fd.ID, UpdateDocumentInput{Revision: 1, Title: strPtr("báo cáo.pdf")})
		if err != nil || got.Document.Title != "báo cáo.pdf" || got.Document.Content != nil {
			t.Fatalf("file rename: %+v %v", got.Document, err)
		}
	})

	t.Run("saves track which assets the content references", func(t *testing.T) {
		v, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Ảnh"})
		if err != nil {
			t.Fatal(err)
		}
		assetID := util.NewID()
		insertRow(t, f.ctx, f.pool, "document_assets", map[string]any{
			"id": assetID, "organization_id": tn.orgID, "workspace_id": tn.wsA, "document_id": v.Document.ID,
			"file_id": util.NewID(), "mime_type": "image/png", "size_bytes": 10,
			"created_by": tn.member.ID, "created_by_kind": "human",
		})
		orphaned := func() bool {
			a, err := f.q.GetDocumentAsset(f.ctx, db.GetDocumentAssetParams{
				ID: assetID, OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: v.Document.ID,
			})
			if err != nil {
				t.Fatal(err)
			}
			return a.OrphanedAt.Valid
		}
		steps := []struct {
			content  json.RawMessage
			orphaned bool
		}{
			{imagePageJSON(assetID), false},
			{pageJSON("không còn ảnh"), true},
			{imagePageJSON(assetID), false}, // undo brings it back
		}
		for i, s := range steps {
			if _, err := f.svc.UpdateDocument(f.ctx, member, v.Document.ID, UpdateDocumentInput{Revision: int64(i + 1), Content: s.content}); err != nil {
				t.Fatal(err)
			}
			if orphaned() != s.orphaned {
				t.Fatalf("step %d: orphaned = %v, want %v", i, !s.orphaned, s.orphaned)
			}
		}
	})
}

// Two saves on the same base: the row lock orders them, the second sees the
// first's revision and gets revision_conflict. The barrier is a test
// transaction holding the row lock until both saves wait on it; the lock
// watcher runs on its own connection so the pool (pool_max_conns=4 on CI)
// only carries the holder and the two saves.
func TestDocumentPageConcurrentSaves(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "save")
	v, err := f.svc.CreatePage(f.ctx, Human(tn.member.ID), tn.wsA, CreatePageInput{Title: "Đua"})
	if err != nil {
		t.Fatal(err)
	}
	id := v.Document.ID

	watch, err := pgx.ConnectConfig(f.ctx, f.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = watch.Close(f.ctx) }()

	holder, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(f.ctx) }()
	if _, err := f.q.WithTx(holder).LockDocumentByID(f.ctx, id); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
	defer cancel()
	type result struct {
		view DocumentView
		err  error
	}
	results := make(chan result, 2)
	for _, actor := range []Actor{Human(tn.member.ID), Human(tn.wsAdmin.ID)} {
		go func() {
			v, err := f.svc.UpdateDocument(ctx, actor, id, UpdateDocumentInput{Revision: 1, Content: pageJSON(actor.ID)})
			results <- result{v, err}
		}()
	}
	waitForLockWaitersOn(t, watch, 2)
	if err := holder.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	var won, conflicted int
	for i := 0; i < 2; i++ {
		r := <-results
		switch {
		case r.err == nil:
			won++
			if r.view.Document.Revision != 2 {
				t.Fatalf("winner revision = %d", r.view.Document.Revision)
			}
		case codedIs(r.err, "revision_conflict"):
			conflicted++
		default:
			t.Fatalf("save: %v", r.err)
		}
	}
	if won != 1 || conflicted != 1 {
		t.Fatalf("won %d conflicted %d, want exactly one of each", won, conflicted)
	}
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil || d.Revision != 2 {
		t.Fatalf("final revision = %d %v", d.Revision, err)
	}
}

// waitForLockWaitersOn blocks until n backends of the test database wait on
// a lock, asking through its own connection (never the pool under test).
func waitForLockWaitersOn(t *testing.T, conn *pgx.Conn, n int) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		var got int
		if err := conn.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got >= n {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("fewer than %d backends waited on the document lock", n)
}

// Two root-level creates: no parent row orders them, the workspace tree
// lock does, so they never share a sibling position. The barrier holds the
// tree lock in a test transaction until both creates wait on it.
func TestDocumentPageCreateRace(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tree")
	watch, err := pgx.ConnectConfig(f.ctx, f.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = watch.Close(f.ctx) }()
	holder, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(f.ctx) }()
	if err := f.q.WithTx(holder).LockDocumentTree(f.ctx, tn.wsA); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
	defer cancel()
	type result struct {
		v   DocumentView
		err error
	}
	results := make(chan result, 2)
	for _, a := range []Actor{Human(tn.member.ID), Human(tn.wsAdmin.ID)} {
		go func() {
			v, err := f.svc.CreatePage(ctx, a, tn.wsA, CreatePageInput{Title: "Gốc"})
			results <- result{v, err}
		}()
	}
	waitForLockWaitersOn(t, watch, 2)
	if err := holder.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	positions := map[float64]bool{}
	for i := 0; i < 2; i++ {
		r := <-results
		if r.err != nil {
			t.Fatal(r.err)
		}
		positions[r.v.Document.Position] = true
	}
	if len(positions) != 2 {
		t.Fatalf("root siblings share a position: %v", positions)
	}
}
