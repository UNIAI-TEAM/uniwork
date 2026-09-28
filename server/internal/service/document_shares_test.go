package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-676 (G1-02b): shares. A level change is revoke + insert in one
// transaction with an audit row; principals stay inside the organization;
// owned documents refuse sharing at every level; shares never inherit to
// children; "who has access" resolves effective access.

func countAudit(t *testing.T, f *docPermFixture, action, resourceID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, resourceID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func countOutbox(t *testing.T, f *docPermFixture, topic, documentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, topic, documentID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func level(t *testing.T, f *docPermFixture, a Actor, d db.Document) DocumentLevel {
	t.Helper()
	d, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	acc, err := f.svc.effectiveLevel(f.ctx, f.q, a, d)
	if err != nil && !isGateRefusal(err) {
		t.Fatal(err)
	}
	return acc.Level
}

func TestDocumentShare(t *testing.T) {
	f := newDocPermFixture(t)
	// "share" itself is a reserved slug since G1-05b (the public share page),
	// so the tenant slugs must stay clear of it.
	tn := f.tenant(t, "shr")
	foreign := f.tenant(t, "shrx")
	H := Human
	mgr := H(tn.aclOwner.ID)

	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	t.Run("grant, change level, same level again", func(t *testing.T) {
		sh, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView,
		})
		if err != nil {
			t.Fatal(err)
		}
		if got := level(t, f, H(tn.outsider.ID), doc); got != DocumentLevelView {
			t.Fatalf("after view share: %q", got)
		}
		sh2, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit,
		})
		if err != nil {
			t.Fatal(err)
		}
		if sh2.ID == sh.ID {
			t.Fatal("level change must insert a new row")
		}
		var live, total int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FILTER (WHERE revoked_at IS NULL), count(*) FROM document_shares
			 WHERE document_id = $1 AND principal_id = $2`, doc.ID, tn.outsider.ID,
		).Scan(&live, &total); err != nil {
			t.Fatal(err)
		}
		if live != 1 || total != 2 {
			t.Fatalf("live=%d total=%d, want 1/2 (history kept)", live, total)
		}
		if got := level(t, f, H(tn.outsider.ID), doc); got != DocumentLevelEdit {
			t.Fatalf("after edit share: %q", got)
		}
		same, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit,
		})
		if err != nil || same.ID != sh2.ID {
			t.Fatalf("same level again: %v %s", err, same.ID)
		}
		if n := countAudit(t, f, audit.ActionDocumentShared, doc.ID); n != 2 {
			t.Fatalf("document.shared audit rows = %d, want 2", n)
		}
		if n := countOutbox(t, f, "document.shared", doc.ID); n != 2 {
			t.Fatalf("document.shared events = %d, want 2", n)
		}
	})

	t.Run("workspace and organization principals", func(t *testing.T) {
		if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: DocumentLevelEdit,
		}); err != nil {
			t.Fatal(err)
		}
		if got := level(t, f, H(tn.bMember.ID), doc); got != DocumentLevelEdit {
			t.Fatalf("workspace share: %q", got)
		}
		d2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.svc.ShareDocument(f.ctx, mgr, d2.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelView,
		}); err != nil {
			t.Fatal(err)
		}
		if got := level(t, f, H(tn.orgAdmin.ID), d2); got != DocumentLevelManage {
			t.Fatalf("org admin keeps manage: %q", got)
		}
		if got := level(t, f, H(tn.outsider.ID), d2); got != DocumentLevelView {
			t.Fatalf("org share: %q", got)
		}
	})

	t.Run("principals outside the organization are refused", func(t *testing.T) {
		for _, in := range []DocumentShareInput{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: foreign.owner.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.deact.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: util.NewID(), Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: foreign.wsA, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: util.NewID(), Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalOrganization, PrincipalID: foreign.orgID, Level: DocumentLevelView},
		} {
			if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, in); !codedIs(err, "principal_not_in_organization") {
				t.Fatalf("%+v: %v", in, err)
			}
		}
		for _, in := range []DocumentShareInput{
			{PrincipalType: "agent", PrincipalID: tn.agent, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: "owner"},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: "", Level: DocumentLevelView},
		} {
			var ve ValidationError
			if _, err := f.svc.ShareDocument(f.ctx, mgr, doc.ID, in); !errors.As(err, &ve) {
				t.Fatalf("%+v: %v, want a validation error", in, err)
			}
		}
	})

	t.Run("only manage shares; a non-reader learns nothing", func(t *testing.T) {
		in := DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: DocumentLevelView}
		if _, err := f.svc.ShareDocument(f.ctx, H(tn.outsider.ID), doc.ID, in); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor sharing: %v", err)
		}
		if _, err := f.svc.ShareDocument(f.ctx, H(tn.member.ID), doc.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader sharing: %v", err)
		}
		if _, err := f.svc.ShareDocument(f.ctx, agentActor(tn.agent), doc.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("agent sharing a restricted doc: %v", err)
		}
		if _, err := f.svc.ShareDocument(f.ctx, H(foreign.owner.ID), doc.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other tenant sharing: %v", err)
		}
	})

	t.Run("owned documents refuse shares at every level", func(t *testing.T) {
		owned := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: "01WPSHARE00000000000000000"})
		f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelManage, tn.outsider.ID: DocumentLevelView})
		defer f.svc.SetOwnerLevelResolver(nil)
		in := DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: DocumentLevelView}
		for _, a := range []Actor{H(tn.member.ID), H(tn.outsider.ID)} {
			if _, err := f.svc.ShareDocument(f.ctx, a, owned.ID, in); !codedIs(err, "document_owned_by_work_product") {
				t.Fatalf("%s: %v", a.ID, err)
			}
			if err := f.svc.RevokeDocumentShare(f.ctx, a, owned.ID, util.NewID()); !codedIs(err, "document_owned_by_work_product") {
				t.Fatalf("revoke %s: %v", a.ID, err)
			}
		}
		// A workspace admin without delegation cannot even see it.
		if _, err := f.svc.ShareDocument(f.ctx, H(tn.wsAdmin.ID), owned.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("ws admin on owned: %v", err)
		}
	})

	t.Run("shares do not inherit to child pages", func(t *testing.T) {
		child := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = $1 WHERE id = $2`, doc.ID, child.ID); err != nil {
			t.Fatal(err)
		}
		if got := level(t, f, H(tn.outsider.ID), doc); got == DocumentLevelNone {
			t.Fatal("parent should be shared")
		}
		if got := level(t, f, H(tn.outsider.ID), child); got != DocumentLevelNone {
			t.Fatalf("child inherited %q", got)
		}
	})

	t.Run("who has access resolves effective access", func(t *testing.T) {
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		for _, in := range []DocumentShareInput{
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelEdit},
			{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: DocumentLevelView},
			{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: DocumentLevelView},
		} {
			if _, err := f.svc.ShareDocument(f.ctx, mgr, d.ID, in); err != nil {
				t.Fatal(err)
			}
		}
		// The creator is deactivated after the grant: the row stays, the
		// access does not.
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
			tn.orgID, tn.creator.ID); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = f.pool.Exec(f.ctx,
				`UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`,
				tn.orgID, tn.creator.ID)
		}()
		ov, err := f.svc.DocumentAccessList(f.ctx, mgr, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		if ov.My.Level != DocumentLevelManage || ov.ACLOwner == nil || ov.ACLOwner.Access.Level != DocumentLevelManage {
			t.Fatalf("my/acl owner: %+v %+v", ov.My, ov.ACLOwner)
		}
		got := map[string]DocumentShareAccess{}
		for _, e := range ov.Shares {
			got[e.Share.PrincipalID] = e
		}
		if e := got[tn.wsAdmin.ID]; !e.Active || e.Effective.Level != DocumentLevelManage || e.Effective.Via != DocumentViaMember {
			t.Fatalf("ws admin shared view still manages: %+v", e)
		}
		if e := got[tn.outsider.ID]; !e.Active || e.Effective.Level != DocumentLevelEdit || e.Effective.Via != DocumentViaShare {
			t.Fatalf("outsider: %+v", e)
		}
		if e := got[tn.creator.ID]; e.Active || e.Effective.Level != DocumentLevelNone {
			t.Fatalf("deactivated grantee: %+v", e)
		}
		if e := got[tn.wsB]; !e.Active || e.Effective.Level != DocumentLevelView {
			t.Fatalf("workspace grant: %+v", e)
		}
		// Anyone below manage sees only their own level.
		ov, err = f.svc.DocumentAccessList(f.ctx, H(tn.outsider.ID), d.ID)
		if err != nil || ov.My.Level != DocumentLevelEdit || ov.Shares != nil || ov.ACLOwner != nil {
			t.Fatalf("editor overview: %+v %v", ov, err)
		}
		if _, err := f.svc.DocumentAccessList(f.ctx, H(tn.member.ID), d.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader overview: %v", err)
		}
	})

	t.Run("shared with me spans workspaces and follows revokes", func(t *testing.T) {
		page, err := f.svc.ListSharedWithMe(f.ctx, tn.outsider.ID, tn.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		ids := map[string]bool{}
		for _, r := range page.Items {
			if r.Access.Via != DocumentViaShare {
				t.Fatalf("non-share row: %+v", r.Access)
			}
			ids[r.Document.ID] = true
		}
		if !ids[doc.ID] {
			t.Fatalf("shared doc missing from %v", ids)
		}
		// A workspace member reaching a document through membership is not
		// "shared with me".
		mine, err := f.svc.ListSharedWithMe(f.ctx, tn.member.ID, tn.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range mine.Items {
			if r.Access.Via != DocumentViaShare {
				t.Fatalf("member row: %+v", r)
			}
		}
		if _, err := f.svc.ListSharedWithMe(f.ctx, foreign.owner.ID, tn.orgID, SharedWithMeQuery{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other tenant: %v", err)
		}
	})

	t.Run("shares to workspaces the person is not in never crowd out theirs", func(t *testing.T) {
		// BE 02b r1 F1: the candidate limit used to run before the
		// workspace filter, so a page of other workspaces' shares hid the
		// person's own. Fill a whole candidate page of wsB shares, then share
		// one newer document with the outsider directly.
		oldPage := sharedWithMeCandidatePage
		sharedWithMeCandidatePage = 25
		t.Cleanup(func() { sharedWithMeCandidatePage = oldPage })

		cr := f.tenant(t, "swm")
		for i := 0; i < sharedWithMeCandidatePage; i++ {
			d := f.doc(t, cr, docSpec{ws: cr.wsA, visibility: "workspace", aclOwner: cr.aclOwner.ID, createdBy: cr.aclOwner.ID})
			f.share(t, d, DocumentPrincipalWorkspace, cr.wsB, DocumentLevelView, cr.aclOwner.ID)
		}
		direct := f.doc(t, cr, docSpec{ws: cr.wsA, visibility: "restricted", aclOwner: cr.aclOwner.ID, createdBy: cr.aclOwner.ID})
		f.share(t, direct, DocumentPrincipalUser, cr.outsider.ID, DocumentLevelView, cr.aclOwner.ID)

		page, err := f.svc.ListSharedWithMe(f.ctx, cr.outsider.ID, cr.orgID, SharedWithMeQuery{})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].Document.ID != direct.ID {
			t.Fatalf("outsider list = %d rows, want only the direct share", len(page.Items))
		}
		// The workspace B member reaches the workspace shares, walked in
		// pages of 10 by the keyset cursor.
		seen := map[string]bool{}
		after := SharedWithMeQuery{Limit: 10}
		for pages := 0; ; pages++ {
			if pages > 10 {
				t.Fatal("shared-with-me walk did not terminate")
			}
			p, err := f.svc.ListSharedWithMe(f.ctx, cr.bMember.ID, cr.orgID, after)
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Items) > 10 {
				t.Fatalf("page %d = %d rows, over limit", pages, len(p.Items))
			}
			for _, r := range p.Items {
				if seen[r.Document.ID] {
					t.Fatalf("cursor repeated %s", r.Document.ID)
				}
				seen[r.Document.ID] = true
			}
			if p.NextID == "" {
				break
			}
			after = SharedWithMeQuery{Limit: 10, AfterCreatedAt: p.NextCreatedAt, AfterID: p.NextID}
		}
		if len(seen) != sharedWithMeCandidatePage {
			t.Fatalf("wsB member walk saw %d rows, want %d", len(seen), sharedWithMeCandidatePage)
		}
	})

	t.Run("revoke ends access; the reader resolver sees it at delivery time", func(t *testing.T) {
		live, err := f.q.GetDocumentShare(f.ctx, db.GetDocumentShareParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		readers, err := f.svc.FilterDocumentReaders(f.ctx, doc.ID, []string{tn.outsider.ID, tn.member.ID, tn.bMember.ID, foreign.owner.ID})
		if err != nil {
			t.Fatal(err)
		}
		if len(readers) != 2 || readers[0] != tn.outsider.ID || readers[1] != tn.bMember.ID {
			t.Fatalf("readers before revoke: %v", readers)
		}
		if err := f.svc.RevokeDocumentShare(f.ctx, H(tn.outsider.ID), doc.ID, live.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("editor revoking: %v", err)
		}
		if err := f.svc.RevokeDocumentShare(f.ctx, mgr, doc.ID, live.ID); err != nil {
			t.Fatal(err)
		}
		if ok, err := f.svc.CanReadDocument(f.ctx, tn.outsider.ID, doc.ID); err != nil || ok {
			t.Fatalf("after revoke: %v %v", ok, err)
		}
		if err := f.svc.RevokeDocumentShare(f.ctx, mgr, doc.ID, live.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("second revoke: %v", err)
		}
		if n := countAudit(t, f, audit.ActionDocumentShareRevoked, doc.ID); n != 1 {
			t.Fatalf("share_revoked audit rows = %d", n)
		}
		if n := countOutbox(t, f, "document.share_revoked", doc.ID); n != 1 {
			t.Fatalf("share_revoked events = %d", n)
		}
		// A share id of another document is not found through this one.
		other := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		osh, err := f.svc.ShareDocument(f.ctx, mgr, other.ID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := f.svc.RevokeDocumentShare(f.ctx, mgr, doc.ID, osh.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign share id: %v", err)
		}
	})
}
