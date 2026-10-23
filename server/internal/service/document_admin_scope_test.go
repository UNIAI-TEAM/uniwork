package service

import (
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// breakGlass inserts a break-glass grant row directly: the POST route that
// writes it lands in a later card (w2); the read side is what these tests
// pin.
func (f *docPermFixture) breakGlass(t *testing.T, tn docTenant, docID, actorID string, expires time.Time, revoked bool) string {
	t.Helper()
	id := util.NewID()
	row := map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA, "document_id": docID,
		"actor_id": actorID, "actor_kind": "human", "level": "view",
		"reason": "Emergency compliance review", "expires_at": expires,
	}
	if revoked {
		row["revoked_at"] = time.Now()
		row["revoked_by"] = actorID
	}
	insertRow(t, f.ctx, f.pool, "document_break_glass_grants", row)
	return id
}

// DOC5-A03 (UNI-1628), service half: a workspace owner/admin (organization
// owner/admin implicit) on a restricted document they are not the ACL owner
// of holds AdminScope and no read level. Content routes answer
// document_restricted with can_break_glass, delivery-time read checks answer
// false without an error, and only a live share or break-glass grant gives a
// level. List / feed / search halves are in TestAdminScopeCannotReadRestrictedList.
func TestAdminScopeCannotReadRestricted(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5a03")
	H := Human

	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	docW := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	// The ws admin who is also ACL owner keeps manage.
	docAdminOwned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.wsAdmin.ID, createdBy: tn.wsAdmin.ID})

	for _, c := range []struct {
		name  string
		actor Actor
	}{
		{"org owner", H(tn.owner.ID)},
		{"org admin", H(tn.orgAdmin.ID)},
		{"ws admin", H(tn.wsAdmin.ID)},
	} {
		t.Run(c.name, func(t *testing.T) {
			acc, err := f.svc.effectiveLevel(f.ctx, f.q, c.actor, docR)
			if err != nil {
				t.Fatal(err)
			}
			if acc.Level != DocumentLevelNone || !acc.AdminScope || !acc.canAdminister() {
				t.Fatalf("restricted access = %+v, want level none + AdminScope", acc)
			}
			_, err = f.svc.GetDocument(f.ctx, c.actor, docR.ID)
			var ce CodedError
			if !errors.Is(err, ErrDocumentRestricted) || !errors.As(err, &ce) || ce.Status != 403 || ce.Fields["can_break_glass"] != true {
				t.Fatalf("GetDocument = %v (%+v), want 403 document_restricted can_break_glass", err, ce)
			}
			if _, err := f.svc.DocumentComments(f.ctx, c.actor, docR.ID, DocumentCommentListInput{}); !errors.Is(err, ErrDocumentRestricted) {
				t.Fatalf("DocumentComments = %v, want document_restricted", err)
			}
			if _, err := f.svc.AddDocumentComment(f.ctx, c.actor, docR.ID, AddCommentInput{Body: "admin cannot comment"}, ""); !errors.Is(err, ErrDocumentRestricted) {
				t.Fatalf("AddDocumentComment = %v, want document_restricted", err)
			}
			// The internal read checks fold it into "not a reader", never an error.
			ok, err := f.svc.CanReadDocument(f.ctx, c.actor.ID, docR.ID)
			if err != nil || ok {
				t.Fatalf("CanReadDocument = %v, %v; want false, nil", ok, err)
			}
			readers, err := f.svc.FilterDocumentReadersQ(f.ctx, f.q, docR.ID, []string{c.actor.ID, tn.aclOwner.ID})
			if err != nil || len(readers) != 1 || readers[0] != tn.aclOwner.ID {
				t.Fatalf("FilterDocumentReadersQ = %v, %v; want [acl owner]", readers, err)
			}
			states, err := f.svc.FilterReadableDocuments(f.ctx, c.actor.ID, []string{docR.ID, docW.ID})
			if err != nil || states[docR.ID] == DocumentReadable || states[docW.ID] != DocumentReadable {
				t.Fatalf("FilterReadableDocuments = %v, %v; want restricted unreadable, workspace readable", states, err)
			}
			// A workspace-visible document is unchanged: manage via member.
			acc, err = f.svc.effectiveLevel(f.ctx, f.q, c.actor, docW)
			if err != nil || acc.Level != DocumentLevelManage || acc.AdminScope {
				t.Fatalf("workspace doc access = %+v, %v; want manage without AdminScope", acc, err)
			}
		})
	}

	// The ACL owner who is also admin keeps manage, no AdminScope.
	acc, err := f.svc.effectiveLevel(f.ctx, f.q, H(tn.wsAdmin.ID), docAdminOwned)
	if err != nil || acc.Level != DocumentLevelManage || acc.AdminScope {
		t.Fatalf("admin ACL owner = %+v, %v; want manage", acc, err)
	}
	// A plain member is still not found, never document_restricted.
	if _, err := f.svc.GetDocument(f.ctx, H(tn.member.ID), docR.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member GetDocument = %v, want ErrNotFound", err)
	}

	// A live share gives its level and AdminScope stays.
	sh := f.share(t, docR, DocumentPrincipalUser, tn.orgAdmin.ID, DocumentLevelComment, tn.aclOwner.ID)
	acc, err = f.svc.effectiveLevel(f.ctx, f.q, H(tn.orgAdmin.ID), docR)
	if err != nil || acc.Level != DocumentLevelComment || acc.Via != DocumentViaShare || !acc.AdminScope {
		t.Fatalf("admin with comment share = %+v, %v", acc, err)
	}
	f.revoke(t, sh, tn.aclOwner.ID)

	// Break-glass: expired and revoked grants give nothing, a live one view.
	f.breakGlass(t, tn, docR.ID, tn.wsAdmin.ID, time.Now().Add(-time.Minute), false)
	f.breakGlass(t, tn, docR.ID, tn.wsAdmin.ID, time.Now().Add(time.Hour), true)
	acc, err = f.svc.effectiveLevel(f.ctx, f.q, H(tn.wsAdmin.ID), docR)
	if err != nil || acc.Level != DocumentLevelNone || !acc.AdminScope {
		t.Fatalf("expired/revoked grant = %+v, %v; want none", acc, err)
	}
	f.breakGlass(t, tn, docR.ID, tn.wsAdmin.ID, time.Now().Add(24*time.Hour), false)
	acc, err = f.svc.effectiveLevel(f.ctx, f.q, H(tn.wsAdmin.ID), docR)
	if err != nil || acc.Level != DocumentLevelView || acc.Via != DocumentViaBreakGlass || !acc.AdminScope {
		t.Fatalf("live grant = %+v, %v; want view via break_glass", acc, err)
	}
	if _, err := f.svc.GetDocument(f.ctx, H(tn.wsAdmin.ID), docR.ID); err != nil {
		t.Fatalf("GetDocument with live grant: %v", err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, H(tn.wsAdmin.ID), docR.ID, AddCommentInput{Body: "view only"}, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("AddDocumentComment with view grant = %v, want ErrForbidden", err)
	}
	// A grant reads nothing once its holder is no longer an admin.
	if _, err := f.pool.Exec(f.ctx, `UPDATE workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2`, tn.wsA, tn.wsAdmin.ID); err != nil {
		t.Fatal(err)
	}
	acc, err = f.svc.effectiveLevel(f.ctx, f.q, H(tn.wsAdmin.ID), docR)
	if err != nil || acc.Level != DocumentLevelNone || acc.AdminScope {
		t.Fatalf("demoted admin with grant = %+v, %v; want none", acc, err)
	}
	// Another admin's grant is not mine.
	acc, err = f.svc.effectiveLevel(f.ctx, f.q, H(tn.owner.ID), docR)
	if err != nil || acc.Level != DocumentLevelNone {
		t.Fatalf("org owner with another admin's grant = %+v, %v; want none", acc, err)
	}
}
