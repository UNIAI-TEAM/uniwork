package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Every list row carries the level effectiveLevel gives the viewer, so a
// client hides Move / Archive / the edit app session row by row instead of
// by the open folder. The unit table pins the rule without a database; the
// parity test below proves the list agrees with effectiveLevel for each
// shape of viewer.
func TestListRowAccessRules(t *testing.T) {
	// The home row's stored level (SH-S1): 'edit' is what the migration's
	// DEFAULT gives every row that predates the column.
	doc := db.Document{ID: "d", OrganizationID: "org", Visibility: "workspace", WorkspaceLevel: "edit"}
	viewRow := db.Document{ID: "v", OrganizationID: "org", Visibility: "workspace", WorkspaceLevel: "view"}
	restricted := db.Document{ID: "r", OrganizationID: "org", Visibility: documentVisibilityRestricted}
	owned := restricted
	owned.AclOwnerID = nullText("me")
	share := func(principalType, principalID, level string) db.ListLiveSharesForDocumentsRow {
		return db.ListLiveSharesForDocumentsRow{PrincipalType: principalType, PrincipalID: principalID, Level: level}
	}
	member := documentListScope{organizationID: "org", actorID: "me", memberVisible: true, aclOwner: true, allowShares: true, shareWorkspaces: []string{"ws2"}}
	cases := []struct {
		name   string
		scope  documentListScope
		agent  bool
		doc    db.Document
		shares []db.ListLiveSharesForDocumentsRow
		level  DocumentLevel
		via    DocumentVia
	}{
		// DOC-05: manage on every non-restricted row; a restricted row is
		// AdminScope (TestListRowAccessAdminScope).
		{"workspace admin manages every workspace row", documentListScope{actorID: "me", seeAll: true, allowShares: true}, false, doc, nil, DocumentLevelManage, DocumentViaMember},
		{"workspace admin holds nothing on a restricted row", documentListScope{actorID: "me", seeAll: true, allowShares: true}, false, restricted, nil, DocumentLevelNone, ""},
		{"acl owner manages a restricted row", member, false, owned, nil, DocumentLevelManage, DocumentViaMember},
		{"member edits a workspace row", member, false, doc, nil, DocumentLevelEdit, DocumentViaMember},
		{"member reads a view home row", member, false, viewRow, nil, DocumentLevelView, DocumentViaMember},
		{"view home row outranks nothing: a view share cannot lower it", member, false, viewRow, []db.ListLiveSharesForDocumentsRow{share("user", "me", "view")}, DocumentLevelView, DocumentViaMember},
		{"view home row upgraded by an edit share", member, false, viewRow, []db.ListLiveSharesForDocumentsRow{share("user", "me", "edit")}, DocumentLevelEdit, DocumentViaShare},
		{"member with a view share still edits", member, false, doc, []db.ListLiveSharesForDocumentsRow{share("user", "me", "view")}, DocumentLevelEdit, DocumentViaMember},
		{"member upgraded by a manage share", member, false, doc, []db.ListLiveSharesForDocumentsRow{share("user", "me", "manage")}, DocumentLevelManage, DocumentViaShare},
		{"restricted row, view share only", member, false, restricted, []db.ListLiveSharesForDocumentsRow{share("user", "me", "view")}, DocumentLevelView, DocumentViaShare},
		{"highest share wins", member, false, restricted, []db.ListLiveSharesForDocumentsRow{share("user", "me", "view"), share("organization", "org", "edit")}, DocumentLevelEdit, DocumentViaShare},
		{"share to another person is ignored", member, false, restricted, []db.ListLiveSharesForDocumentsRow{share("user", "you", "manage")}, DocumentLevelNone, ""},
		{"workspace share counts when the viewer is in it", member, false, restricted, []db.ListLiveSharesForDocumentsRow{share("workspace", "ws2", "edit")}, DocumentLevelEdit, DocumentViaShare},
		{"workspace share outside the viewer's workspaces is ignored", member, false, restricted, []db.ListLiveSharesForDocumentsRow{share("workspace", "ws9", "edit")}, DocumentLevelNone, ""},
		{"non member reads only through shares", documentListScope{organizationID: "org", actorID: "me", allowShares: true}, false, doc, []db.ListLiveSharesForDocumentsRow{share("user", "me", "view")}, DocumentLevelView, DocumentViaShare},
		{"non member without a share holds nothing", documentListScope{organizationID: "org", actorID: "me", allowShares: true}, false, doc, nil, DocumentLevelNone, ""},
		{"agent is capped at view", documentListScope{organizationID: "org", actorID: "ag", memberVisible: true}, true, doc, nil, DocumentLevelView, DocumentViaMember},
		{"agent never reaches a restricted row", documentListScope{organizationID: "org", actorID: "ag", memberVisible: true}, true, restricted, []db.ListLiveSharesForDocumentsRow{share("user", "ag", "manage")}, DocumentLevelNone, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := listRowAccess(c.scope, c.agent, c.doc, c.shares, false)
			if got.Level != c.level || (c.level != DocumentLevelNone && got.Via != c.via) {
				t.Fatalf("listRowAccess = %+v, want level %q via %q", got, c.level, c.via)
			}
		})
	}
}

// A page with no rows answers without touching the shares query.
func TestAttachListAccessWithoutRows(t *testing.T) {
	var s DocumentService
	if err := s.attachListAccess(t.Context(), documentListScope{allowShares: true}, "ws", false, nil); err != nil {
		t.Fatalf("attach empty: %v", err)
	}
}

// DB-backed: for each viewer shape, every row the list, the folder-children
// list and recent return carries exactly the level effectiveLevel gives that
// viewer. The one-shares-read-per-page cost is by construction (attachListAccess
// reads them with one set-based query); this test does not count queries.
func TestListRowsCarryEffectiveLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "lvlrows")
	owner := tn.owner.ID

	open := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.member.ID})
	mine := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	sharedView := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: owner, createdBy: owner})
	f.share(t, sharedView, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, owner)
	f.share(t, sharedView, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, owner)
	sharedEdit := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: owner, createdBy: owner})
	f.share(t, sharedEdit, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, owner)
	f.share(t, sharedEdit, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, owner)
	wsShare := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: owner, createdBy: owner})
	f.share(t, wsShare, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, owner)
	hidden := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: owner, createdBy: owner})
	revoked := f.share(t, hidden, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, owner)
	f.revoke(t, revoked, owner)
	all := []db.Document{open, mine, sharedView, sharedEdit, wsShare, hidden}

	viewers := []struct {
		name  string
		actor Actor
	}{
		{"organization owner", Human(tn.owner.ID)},
		{"workspace admin", Human(tn.wsAdmin.ID)},
		{"acl owner", Human(tn.aclOwner.ID)},
		{"member", Human(tn.member.ID)},
		{"outsider holding a share", Human(tn.outsider.ID)},
		{"member of the workspace B principal", Human(tn.bMember.ID)},
		{"agent", agentActor(tn.agent)},
	}
	for _, v := range viewers {
		t.Run(v.name, func(t *testing.T) {
			page, err := f.svc.ListDocuments(f.ctx, v.actor, tn.wsA, ListDocumentsInput{Limit: 100})
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			byID := map[string]DocumentListItem{}
			for _, item := range page.Items {
				byID[item.Document.ID] = item
			}
			listed := 0
			for _, d := range all {
				want, err := f.svc.effectiveLevel(f.ctx, f.q, v.actor, d)
				if err != nil {
					t.Fatalf("effectiveLevel %s: %v", d.ID, err)
				}
				item, ok := byID[d.ID]
				// DOC-05: an AdminScope row is listed with level none.
				if want.Level == DocumentLevelNone && !want.AdminScope {
					if ok {
						t.Fatalf("%s listed for a viewer with no level", d.ID)
					}
					continue
				}
				if !ok {
					t.Fatalf("%s missing from the list (level %q)", d.ID, want.Level)
				}
				listed++
				if item.Access != want {
					t.Fatalf("%s row access = %+v, effectiveLevel = %+v", d.ID, item.Access, want)
				}
			}
			if listed == 0 && v.actor.Kind != audit.KindAgent {
				t.Fatalf("viewer saw no rows; the fixture is wrong")
			}
		})
	}

	t.Run("folder children carry the level", func(t *testing.T) {
		folder, err := f.svc.CreatePage(f.ctx, Human(tn.owner.ID), tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
		if err != nil {
			t.Fatalf("folder: %v", err)
		}
		child := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: owner, createdBy: owner})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = $1 WHERE id = $2`, folder.Document.ID, child.ID); err != nil {
			t.Fatal(err)
		}
		f.share(t, child, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, owner)
		parent := folder.Document.ID
		page, err := f.svc.ListDocuments(f.ctx, Human(tn.member.ID), tn.wsA, ListDocumentsInput{ParentID: &parent, Limit: 100})
		if err != nil {
			t.Fatalf("children: %v", err)
		}
		if len(page.Items) != 1 || page.Items[0].Document.ID != child.ID {
			t.Fatalf("children = %+v", page.Items)
		}
		if got := page.Items[0].Access; got.Level != DocumentLevelView || got.Via != DocumentViaShare {
			t.Fatalf("child access = %+v, want view via share", got)
		}
	})

	t.Run("recent carries the level", func(t *testing.T) {
		page, err := f.svc.ListRecentDocuments(f.ctx, Human(tn.aclOwner.ID), tn.wsA, ListDocumentsInput{Limit: 100})
		if err != nil {
			t.Fatalf("recent: %v", err)
		}
		found := false
		for _, item := range page.Items {
			if item.Document.ID != mine.ID {
				continue
			}
			found = true
			if item.Access.Level != DocumentLevelManage {
				t.Fatalf("recent access = %+v, want manage", item.Access)
			}
		}
		if !found {
			t.Fatalf("recent did not list the ACL owner's own document")
		}
	})
}
