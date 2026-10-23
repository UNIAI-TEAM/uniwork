package service

// Folder tests (UNI-1305): kind folder on the page create, the containment
// rule (folders in folders, pages and files in pages or folders), move with
// the cycle guard, the tree and list reads, archive of a folder subtree, and
// the clear refusal of every content/version/byte route on a folder.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentFolders(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	folder := func(t *testing.T, parent, title string) db.Document {
		t.Helper()
		v, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: parent, Title: title})
		if err != nil {
			t.Fatalf("create folder %q: %v", title, err)
		}
		return v.Document
	}
	page := func(t *testing.T, parent, title string) db.Document {
		t.Helper()
		v, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{ParentID: parent, Title: title})
		if err != nil {
			t.Fatalf("create page %q: %v", title, err)
		}
		return v.Document
	}

	t.Run("a folder is created at the root without content and audited", func(t *testing.T) {
		f := folder(t, "", "Hợp đồng")
		if f.Kind != DocumentKindFolder || f.Content != nil || f.ParentID.Valid || f.CurrentVersion != 0 {
			t.Fatalf("folder = %+v", f)
		}
		var audits, events int
		if err := env.f.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`,
			f.ID, string(audit.ActionDocumentCreated)).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if err := env.f.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'document.created' AND payload::jsonb->>'document_id' = $1`,
			f.ID).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if audits != 1 || events != 1 {
			t.Fatalf("audit rows = %d, document.created events = %d, want 1 and 1", audits, events)
		}
	})

	t.Run("a folder refuses content and an unknown kind is invalid", func(t *testing.T) {
		raw := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`)
		_, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "X", Content: raw})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFile, Title: "X"})
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("kind file on the page create = %v, want a validation error", err)
		}
	})

	t.Run("folders nest and hold pages and files", func(t *testing.T) {
		outer := folder(t, "", "Phòng ban")
		inner := folder(t, outer.ID, "Kế toán")
		p := page(t, inner.ID, "Ghi chú")
		file, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
			ParentID: inner.ID, Title: "Báo cáo", Filename: "bao-cao.pdf", Body: bytes.NewReader(pdfBody("folder")),
		})
		if err != nil {
			t.Fatalf("file under a folder: %v", err)
		}
		if inner.ParentID.String != outer.ID || p.ParentID.String != inner.ID || file.Document.ParentID.String != inner.ID {
			t.Fatalf("parents: inner=%v page=%v file=%v", inner.ParentID, p.ParentID, file.Document.ParentID)
		}
		tree, err := env.svc.DocumentTree(ctx, member, env.tn.wsA, outer.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(tree) != 1 || tree[0].ID != inner.ID || tree[0].Kind != DocumentKindFolder || len(tree[0].Children) != 2 {
			t.Fatalf("tree under %s = %+v", outer.ID, tree)
		}
		kids := map[string]string{}
		for _, c := range tree[0].Children {
			kids[c.ID] = c.Kind
		}
		if kids[p.ID] != DocumentKindPage || kids[file.Document.ID] != DocumentKindFile {
			t.Fatalf("children kinds = %v", kids)
		}
		parent := inner.ID
		listed, err := env.svc.ListDocuments(ctx, member, env.tn.wsA, ListDocumentsInput{ParentID: &parent})
		if err != nil {
			t.Fatal(err)
		}
		if len(listed.Items) != 2 {
			t.Fatalf("children of %s = %d rows, want 2", inner.ID, len(listed.Items))
		}
		folders, err := env.svc.ListDocuments(ctx, member, env.tn.wsA, ListDocumentsInput{Kind: DocumentKindFolder})
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range folders.Items {
			if it.Document.Kind != DocumentKindFolder {
				t.Fatalf("kind=folder listed a %s", it.Document.Kind)
			}
		}
	})

	t.Run("a folder never sits under a page", func(t *testing.T) {
		p := page(t, "", "Trang")
		_, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: p.ID, Title: "Sai chỗ"})
		wantCode(t, err, "document_parent_kind")
		f := folder(t, "", "Sẽ chuyển")
		_, err = env.svc.MoveDocument(ctx, member, f.ID, MoveDocumentInput{ParentID: p.ID, Revision: f.Revision})
		wantCode(t, err, "document_parent_kind")
	})

	t.Run("a page and a file move into a folder, a folder moves to the root", func(t *testing.T) {
		dst := folder(t, "", "Đích")
		p := page(t, "", "Trang lẻ")
		moved, err := env.svc.MoveDocument(ctx, member, p.ID, MoveDocumentInput{ParentID: dst.ID, Revision: p.Revision})
		if err != nil || moved.Document.ParentID.String != dst.ID {
			t.Fatalf("page into folder = %v %v", moved.Document.ParentID, err)
		}
		file := env.createFile(t, member, "le.pdf", pdfBody("loose"))
		moved, err = env.svc.MoveDocument(ctx, member, file.Document.ID, MoveDocumentInput{ParentID: dst.ID, Revision: file.Document.Revision})
		if err != nil || moved.Document.ParentID.String != dst.ID {
			t.Fatalf("file into folder = %v %v", moved.Document.ParentID, err)
		}
		sub := folder(t, dst.ID, "Con")
		moved, err = env.svc.MoveDocument(ctx, member, sub.ID, MoveDocumentInput{Revision: sub.Revision})
		if err != nil || moved.Document.ParentID.Valid {
			t.Fatalf("folder to root = %v %v", moved.Document.ParentID, err)
		}
	})

	t.Run("a folder never moves into itself or a descendant", func(t *testing.T) {
		a := folder(t, "", "A")
		b := folder(t, a.ID, "B")
		c := folder(t, b.ID, "C")
		_, err := env.svc.MoveDocument(ctx, member, a.ID, MoveDocumentInput{ParentID: a.ID, Revision: a.Revision})
		wantCode(t, err, "document_cycle")
		_, err = env.svc.MoveDocument(ctx, member, a.ID, MoveDocumentInput{ParentID: c.ID, Revision: a.Revision})
		wantCode(t, err, "document_cycle")
	})

	t.Run("a parent from another workspace is refused", func(t *testing.T) {
		foreign := env.f.treeDoc(t, env.tn, treeDocSpec{ws: env.tn.wsB, visibility: "workspace", aclOwner: env.tn.aclOwner.ID,
			createdBy: env.tn.aclOwner.ID, kind: DocumentKindFolder})
		_, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: foreign.ID, Title: "X"})
		wantNotFound(t, err)
		_, err = env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{ParentID: foreign.ID, Title: "X"})
		wantNotFound(t, err)
	})

	t.Run("archiving a folder archives its subtree in one batch", func(t *testing.T) {
		root := folder(t, "", "Lưu trữ")
		sub := folder(t, root.ID, "Con")
		p := page(t, sub.ID, "Trang")
		res, err := env.svc.ArchiveDocument(ctx, member, root.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		for _, id := range res.Affected {
			got[id] = true
		}
		if len(res.Affected) != 3 || !got[root.ID] || !got[sub.ID] || !got[p.ID] {
			t.Fatalf("archived = %v, want the folder, its folder and its page", res.Affected)
		}
		if _, err := env.svc.RestoreDocument(ctx, member, root.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		env.f.live(t, p.ID)
	})

	t.Run("a folder renames like any document", func(t *testing.T) {
		f := folder(t, "", "Tên cũ")
		title := "Tên mới"
		v, err := env.svc.UpdateDocument(ctx, member, f.ID, UpdateDocumentInput{Revision: f.Revision, Title: &title})
		if err != nil || v.Document.Title != title {
			t.Fatalf("rename = %q %v", v.Document.Title, err)
		}
	})

	t.Run("content, version, byte and office routes refuse a folder by name", func(t *testing.T) {
		f := folder(t, "", "Chỉ chứa")
		raw := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`)
		_, err := env.svc.UpdateDocument(ctx, member, f.ID, UpdateDocumentInput{Revision: f.Revision, Content: raw})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.CreateDocumentVersion(ctx, member, f.ID, CreateDocumentVersionInput{})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.ListDocumentVersions(ctx, member, f.ID, ListDocumentVersionsInput{})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.RestoreDocumentVersion(ctx, member, f.ID, RestoreDocumentVersionInput{Version: 1})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.UploadDocumentFile(ctx, member, f.ID, DocumentUploadInput{Filename: "x.pdf", Body: bytes.NewReader(pdfBody("x"))})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.UploadDocumentAsset(ctx, member, f.ID, DocumentUploadInput{Filename: "x.png", Body: bytes.NewReader(nil)})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.OpenDocumentFile(ctx, member, f.ID, 0, DocumentByteRange{})
		wantCode(t, err, "folder_not_supported")
		_, err = env.svc.CopyDocument(ctx, member, f.ID, CopyDocumentInput{Consent: documentCopyConsent})
		wantCode(t, err, "folder_not_supported")
	})

	t.Run("a stranger still learns nothing about a folder", func(t *testing.T) {
		f := folder(t, "", "Riêng")
		_, err := env.svc.ListDocumentVersions(ctx, human(env.tn.outsider), f.ID, ListDocumentVersionsInput{})
		wantNotFound(t, err)
	})
}

func TestChildKindAllowed(t *testing.T) {
	cases := []struct {
		parent, child string
		want          bool
	}{
		{DocumentKindFolder, DocumentKindFolder, true},
		{DocumentKindFolder, DocumentKindPage, true},
		{DocumentKindFolder, DocumentKindFile, true},
		{DocumentKindPage, DocumentKindPage, true},
		{DocumentKindPage, DocumentKindFile, true},
		{DocumentKindPage, DocumentKindFolder, false},
		{DocumentKindFile, DocumentKindPage, false},
		{DocumentKindFile, DocumentKindFolder, false},
		{DocumentKindFile, DocumentKindFile, false},
	}
	for _, c := range cases {
		if got := childKindAllowed(c.parent, c.child); got != c.want {
			t.Errorf("childKindAllowed(%s, %s) = %v, want %v", c.parent, c.child, got, c.want)
		}
	}
}
