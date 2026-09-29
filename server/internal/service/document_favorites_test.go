package service

// UNI-681 (G1-07a): server-side document favorites. Add/remove are
// idempotent and gated on read access; the list re-checks the live
// effectiveLevel on every row, so a revoked share or an archived document
// drops out while the row itself survives (and returns if access does).

import (
	"errors"
	"testing"
)

func TestDocumentFavoriteRoundTrip(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "fav")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	fav, err := f.svc.FavoriteDocument(f.ctx, member, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fav.DocumentID != d.ID || fav.UserID != tn.member.ID || fav.OrganizationID != tn.orgID || fav.WorkspaceID != tn.wsA {
		t.Fatalf("favorite = %+v", fav)
	}
	// A repeat add returns the same row - one favorite per user/document.
	again, err := f.svc.FavoriteDocument(f.ctx, member, d.ID)
	if err != nil || again.ID != fav.ID {
		t.Fatalf("repeat favorite = %v %+v", err, again)
	}
	list, err := f.svc.ListDocumentFavorites(f.ctx, member, tn.orgID)
	if err != nil || len(list) != 1 || list[0].Document.ID != d.ID {
		t.Fatalf("favorites = %+v %v", list, err)
	}

	if err := f.svc.UnfavoriteDocument(f.ctx, member, d.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.UnfavoriteDocument(f.ctx, member, d.ID); err != nil {
		t.Fatalf("second remove: %v", err)
	}
	if list, err := f.svc.ListDocumentFavorites(f.ctx, member, tn.orgID); err != nil || len(list) != 0 {
		t.Fatalf("favorites after remove = %+v %v", list, err)
	}
}

// The list is permission-filtered on every read: a revoked share drops the
// row, a re-grant brings the same favorite back, and an archived document
// disappears for everyone below manage.
func TestDocumentFavoritePermissionFiltered(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "favp")
	restricted := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	outsider := Human(tn.outsider.ID)

	// No access yet: favoriting is refused, listing stays empty.
	if _, err := f.svc.FavoriteDocument(f.ctx, outsider, restricted.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("favorite without access: %v, want ErrNotFound", err)
	}

	sh := f.share(t, restricted, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	fav, err := f.svc.FavoriteDocument(f.ctx, outsider, restricted.ID)
	if err != nil {
		t.Fatal(err)
	}
	if list, err := f.svc.ListDocumentFavorites(f.ctx, outsider, tn.orgID); err != nil || len(list) != 1 {
		t.Fatalf("favorites with share = %d %v", len(list), err)
	}

	f.revoke(t, sh, tn.aclOwner.ID)
	if list, err := f.svc.ListDocumentFavorites(f.ctx, outsider, tn.orgID); err != nil || len(list) != 0 {
		t.Fatalf("favorites after revoke = %+v %v", list, err)
	}
	// The row survived the revoke: re-sharing shows the same favorite again.
	f.share(t, restricted, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	list, err := f.svc.ListDocumentFavorites(f.ctx, outsider, tn.orgID)
	if err != nil || len(list) != 1 || list[0].FavoriteID != fav.ID {
		t.Fatalf("favorites after re-share = %+v %v", list, err)
	}

	// Archived: below manage the document is in the trash and its favorite
	// hides; the ACL owner (manage) still sees it.
	member := Human(tn.member.ID)
	f.share(t, restricted, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.aclOwner.ID)
	if _, err := f.svc.FavoriteDocument(f.ctx, member, restricted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, restricted.ID); err != nil {
		t.Fatal(err)
	}
	if list, err := f.svc.ListDocumentFavorites(f.ctx, member, tn.orgID); err != nil || len(list) != 0 {
		t.Fatalf("member favorites on archived doc = %+v %v", list, err)
	}
	if _, err := f.svc.FavoriteDocument(f.ctx, Human(tn.aclOwner.ID), restricted.ID); err != nil {
		t.Fatal(err)
	}
	if list, err := f.svc.ListDocumentFavorites(f.ctx, Human(tn.aclOwner.ID), tn.orgID); err != nil || len(list) != 1 {
		t.Fatalf("manage favorites on archived doc = %+v %v", list, err)
	}
}

// Favorites never cross tenants and anonymous users have none.
func TestDocumentFavoriteIsolation(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "favi")
	foreign := f.tenant(t, "favf")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	fd := f.doc(t, foreign, docSpec{ws: foreign.wsA, visibility: "workspace", aclOwner: foreign.aclOwner.ID, createdBy: foreign.aclOwner.ID})
	member := Human(tn.member.ID)

	if _, err := f.svc.FavoriteDocument(f.ctx, member, fd.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("favorite foreign doc: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListDocumentFavorites(f.ctx, member, foreign.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list foreign org: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.FavoriteDocument(f.ctx, Actor{}, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("anonymous favorite: %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListDocumentFavorites(f.ctx, Actor{}, tn.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("anonymous list: %v, want ErrNotFound", err)
	}
}
