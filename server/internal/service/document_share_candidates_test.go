package service

import (
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentShareCandidates covers SH-S2 (UNI-1781) Item 3:
// GET /api/v1/documents/{documentID}/share-candidates?q=&cursor=&limit=.
func TestDocumentShareCandidates(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs2cand")
	foreign := f.tenant(t, "shs2candf")
	H := Human
	mgr := H(tn.aclOwner.ID)

	// Add an accented member to verify uw_fold_search folding on name and email.
	accentUser := registerVerified(t, f.q, f.as, "nguyen-van-an-shs2@example.com", "Nguyễn Văn An")
	f.orgMember(t, tn.orgID, accentUser.ID, OrgRoleMember)

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	doc = setWorkspaceLevel(t, f, doc, "view")
	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)

	t.Run("lists active org members, workspaces, and organization with direct_level and is_home_workspace", func(t *testing.T) {
		page, err := f.svc.ListShareCandidates(f.ctx, mgr, doc.ID, DocumentShareCandidateFilter{Limit: 100})
		if err != nil {
			t.Fatalf("ListShareCandidates: %v", err)
		}
		if len(page.Items) == 0 {
			t.Fatalf("expected non-empty share candidates, got 0")
		}
		byKey := map[string]DocumentShareCandidate{}
		for _, c := range page.Items {
			if c.PrincipalID == tn.deact.ID {
				t.Fatalf("deactivated member %s must be excluded", tn.deact.ID)
			}
			if c.PrincipalID == foreign.owner.ID || c.PrincipalID == foreign.wsA || c.PrincipalID == foreign.orgID {
				t.Fatalf("foreign tenant principal %+v must be excluded", c)
			}
			byKey[c.PrincipalType+":"+c.PrincipalID] = c
		}

		// Home workspace carries direct_level from workspace_level ('view') and is_home_workspace = true.
		homeWS, ok := byKey[DocumentPrincipalWorkspace+":"+tn.wsA]
		if !ok || !homeWS.IsHomeWorkspace || homeWS.DirectLevel != "view" || homeWS.Subtitle != "shs2cand-a" {
			t.Fatalf("home workspace candidate = %+v, want is_home_workspace=true direct_level=view", homeWS)
		}
		// Other workspace carries direct_level from live share ('view') and is_home_workspace = false.
		otherWS, ok := byKey[DocumentPrincipalWorkspace+":"+tn.wsB]
		if !ok || otherWS.IsHomeWorkspace || otherWS.DirectLevel != "view" {
			t.Fatalf("other workspace candidate = %+v, want is_home_workspace=false direct_level=view", otherWS)
		}
		// Organization row carries direct_level from live share ('view').
		orgCand, ok := byKey[DocumentPrincipalOrganization+":"+tn.orgID]
		if !ok || orgCand.IsHomeWorkspace || orgCand.DirectLevel != "view" || orgCand.Subtitle != "shs2cand" {
			t.Fatalf("organization candidate = %+v, want direct_level=view subtitle=shs2cand", orgCand)
		}
		// User with direct share carries direct_level='edit'; user without direct share carries ''.
		outCand, ok := byKey[DocumentPrincipalUser+":"+tn.outsider.ID]
		if !ok || outCand.DirectLevel != "edit" {
			t.Fatalf("outsider user candidate = %+v, want direct_level=edit", outCand)
		}
		memCand, ok := byKey[DocumentPrincipalUser+":"+tn.member.ID]
		if !ok || memCand.DirectLevel != "" {
			t.Fatalf("unshared member candidate = %+v, want direct_level empty", memCand)
		}

		// On a restricted document with no legacy home share, home workspace direct_level is empty.
		resDoc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		resPage, err := f.svc.ListShareCandidates(f.ctx, mgr, resDoc.ID, DocumentShareCandidateFilter{Q: "A shs2cand"})
		if err != nil {
			t.Fatalf("restricted home ws candidates: %v", err)
		}
		if len(resPage.Items) != 1 || !resPage.Items[0].IsHomeWorkspace || resPage.Items[0].DirectLevel != "" {
			t.Fatalf("restricted home ws candidate = %+v, want is_home_workspace=true direct_level=''", resPage.Items)
		}
	})

	t.Run("case and accent insensitive search via uw_fold_search on name, email, and slug", func(t *testing.T) {
		wsSlug, err := f.q.CreateWorkspace(f.ctx, db.CreateWorkspaceParams{
			ID:             "01J8X4WSSLUG0N1P2Q3R4S5T6U",
			OrganizationID: tn.orgID,
			Slug:           "phong-ky-thuat-shs2",
			Name:           "Phòng Kỹ Thuật",
			CreatedBy:      tn.owner.ID,
		})
		if err != nil {
			t.Fatal(err)
		}

		byName, err := f.svc.ListShareCandidates(f.ctx, mgr, doc.ID, DocumentShareCandidateFilter{Q: "nguyen van an"})
		if err != nil {
			t.Fatalf("search by folded name: %v", err)
		}
		if len(byName.Items) != 1 || byName.Items[0].PrincipalID != accentUser.ID {
			t.Fatalf("search 'nguyen van an' = %+v, want [%s]", byName.Items, accentUser.ID)
		}

		byEmail, err := f.svc.ListShareCandidates(f.ctx, mgr, doc.ID, DocumentShareCandidateFilter{Q: "NGUYEN-VAN-AN-SHS2@EXAMPLE.COM"})
		if err != nil {
			t.Fatalf("search by email: %v", err)
		}
		if len(byEmail.Items) != 1 || byEmail.Items[0].PrincipalID != accentUser.ID {
			t.Fatalf("search by email = %+v, want [%s]", byEmail.Items, accentUser.ID)
		}

		bySlug, err := f.svc.ListShareCandidates(f.ctx, mgr, doc.ID, DocumentShareCandidateFilter{Q: "PHONG-KY-THUAT-SHS2"})
		if err != nil {
			t.Fatalf("search by slug: %v", err)
		}
		if len(bySlug.Items) != 1 || bySlug.Items[0].PrincipalID != wsSlug.ID {
			t.Fatalf("search by slug = %+v, want [%s]", bySlug.Items, wsSlug.ID)
		}
	})

	t.Run("cursor pagination walks entire candidate set without duplicates", func(t *testing.T) {
		seen := map[string]bool{}
		cursor := ""
		pages := 0
		for {
			page, err := f.svc.ListShareCandidates(f.ctx, mgr, doc.ID, DocumentShareCandidateFilter{
				Cursor: cursor,
				Limit:  3,
			})
			if err != nil {
				t.Fatalf("page %d: %v", pages, err)
			}
			pages++
			for _, c := range page.Items {
				k := c.PrincipalType + ":" + c.PrincipalID
				if seen[k] {
					t.Fatalf("duplicate candidate %s across pages", k)
				}
				seen[k] = true
			}
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
			if pages > 20 {
				t.Fatal("pagination did not terminate")
			}
		}
		if pages < 3 || len(seen) < 9 {
			t.Fatalf("walked %d pages and %d items, want >=3 pages and >=9 items", pages, len(seen))
		}
	})

	t.Run("gates: non-manager 403, non-reader 404, AdminScope allowed, invalid cursor 400", func(t *testing.T) {
		resDoc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, resDoc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)

		// Editor (below manage) -> 403.
		if _, err := f.svc.ListShareCandidates(f.ctx, H(tn.outsider.ID), resDoc.ID, DocumentShareCandidateFilter{}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor = %v, want ErrForbidden", err)
		}
		// Non-reader -> 404.
		if _, err := f.svc.ListShareCandidates(f.ctx, H(tn.member.ID), resDoc.ID, DocumentShareCandidateFilter{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader = %v, want ErrNotFound", err)
		}
		// Foreign tenant -> 404.
		if _, err := f.svc.ListShareCandidates(f.ctx, H(foreign.owner.ID), resDoc.ID, DocumentShareCandidateFilter{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign tenant = %v, want ErrNotFound", err)
		}
		// AdminScope caller (wsAdmin on restricted doc) -> 200.
		if _, err := f.svc.ListShareCandidates(f.ctx, H(tn.wsAdmin.ID), resDoc.ID, DocumentShareCandidateFilter{}); err != nil {
			t.Fatalf("AdminScope caller: %v", err)
		}
		// Invalid cursor -> 400.
		var ve ValidationError
		if _, err := f.svc.ListShareCandidates(f.ctx, mgr, resDoc.ID, DocumentShareCandidateFilter{Cursor: "!!!not-base64!!!"}); !errors.As(err, &ve) {
			t.Fatalf("bad cursor = %v, want ValidationError", err)
		}
	})
}

var _ = db.Document{}
