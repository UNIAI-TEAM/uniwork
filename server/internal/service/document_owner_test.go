package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// AC-4: the default resolver denies every actor, and an owned document
// cannot be created while no owner service is plugged into the seam
// (C-01 §13.8 fail-closed).

type fakeOwnerResolver struct{ level DocumentLevel }

func (f fakeOwnerResolver) Resolve(_ context.Context, _ Actor, _ string) (DocumentLevel, error) {
	return f.level, nil
}

func TestDocumentOwner(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	svc := NewDocumentService(pool, db.New(pool))
	actor := Human("01USROWN000000000000000000")

	t.Run("default resolver returns none", func(t *testing.T) {
		lvl, err := svc.ownerLevelResolve(ctx, actor, "01WP0000000000000000000000")
		if err != nil {
			t.Fatal(err)
		}
		if lvl != DocumentLevelNone {
			t.Fatalf("default resolver level = %q, want none", lvl)
		}
	})

	t.Run("owned create refused without wired resolver", func(t *testing.T) {
		_, err := svc.CreateOwnedDocumentInTx(ctx, svc.q, actor, OwnedDocumentInput{
			OrganizationID: "01ORGOWN000000000000000000",
			WorkspaceID:    "01WSOWN0000000000000000000",
			OwnerID:        "01WP0000000000000000000000",
			Kind:           DocumentKindPage,
			Title:          "Doc",
		})
		if !errors.Is(err, errDocumentOwnerResolverMissing) {
			t.Fatalf("err = %v, want errDocumentOwnerResolverMissing", err)
		}
	})

	t.Run("wired resolver gates the seam", func(t *testing.T) {
		svc.SetOwnerLevelResolver(fakeOwnerResolver{level: DocumentLevelEdit})
		lvl, err := svc.ownerLevelResolve(ctx, actor, "01WP0000000000000000000000")
		if err != nil {
			t.Fatal(err)
		}
		if lvl != DocumentLevelEdit {
			t.Fatalf("wired resolver level = %q", lvl)
		}

		doc, err := svc.CreateOwnedDocumentInTx(ctx, svc.q, actor, OwnedDocumentInput{
			OrganizationID: "01ORGOWN000000000000000000",
			WorkspaceID:    "01WSOWN0000000000000000000",
			OwnerID:        "01WP0000000000000000000000",
			Kind:           DocumentKindPage,
			Title:          "Work product doc",
			Content:        json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]},{"type":"script"}]}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		if !doc.OwnerKind.Valid || doc.OwnerKind.String != "work_product" {
			t.Fatalf("owner_kind = %v", doc.OwnerKind)
		}
		if doc.OwnerID.String != "01WP0000000000000000000000" {
			t.Fatalf("owner_id = %v", doc.OwnerID)
		}
		if doc.ParentID.Valid {
			t.Fatal("owned document has a parent")
		}
		// Content went through the sanitizer: the script node is gone.
		if doc.ContentText != "hello" {
			t.Fatalf("content_text = %q", doc.ContentText)
		}
		// §14.3: acl_owner_id defaults to the human creator.
		if !doc.AclOwnerID.Valid || doc.AclOwnerID.String != actor.ID {
			t.Fatalf("acl_owner_id = %v", doc.AclOwnerID)
		}
		if doc.SearchText == "" {
			t.Fatal("search_text empty")
		}
	})

	t.Run("file kind rejects content", func(t *testing.T) {
		_, err := svc.CreateOwnedDocumentInTx(ctx, svc.q, actor, OwnedDocumentInput{
			OrganizationID: "01ORGOWN000000000000000000",
			WorkspaceID:    "01WSOWN0000000000000000000",
			OwnerID:        "01WP0000000000000000000000",
			Kind:           DocumentKindFile,
			Title:          "File",
			Content:        json.RawMessage(`{"type":"doc"}`),
		})
		if err == nil {
			t.Fatal("file kind with content must fail")
		}
	})

	t.Run("nil resolver restores deny", func(t *testing.T) {
		svc.SetOwnerLevelResolver(nil)
		lvl, err := svc.ownerLevelResolve(ctx, actor, "01WP0000000000000000000000")
		if err != nil {
			t.Fatal(err)
		}
		if lvl != DocumentLevelNone {
			t.Fatalf("level after unset = %q", lvl)
		}
		_, err = svc.CreateOwnedDocumentInTx(ctx, svc.q, actor, OwnedDocumentInput{
			OrganizationID: "01ORGOWN000000000000000000",
			WorkspaceID:    "01WSOWN0000000000000000000",
			OwnerID:        "01WP0000000000000000000000",
			Kind:           DocumentKindPage,
			Title:          "Doc",
		})
		if !errors.Is(err, errDocumentOwnerResolverMissing) {
			t.Fatalf("err = %v after unset", err)
		}
	})
}
