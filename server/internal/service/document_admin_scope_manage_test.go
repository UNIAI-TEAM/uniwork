package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// DOC5-A04 (UNI-1628): an admin-only caller (level none, AdminScope) on a
// restricted document passes both the outer gate and canAdminister for the
// administrative commands - share/revoke for others, links, the access list,
// access logs, archive impact/archive/restore, narrowing visibility - while
// every answer carries no read level (so the handler leaves the body out) and
// content reads stay document_restricted.
func TestAdminScopeCanAdministerRestrictedWithoutRead(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5a04")
	f.withLinks(t)
	admin := Human(tn.wsAdmin.ID)
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.owner.ID), tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	noRead := func(t *testing.T, what string, acc DocumentAccess) {
		t.Helper()
		if acc.Level != DocumentLevelNone || !acc.AdminScope {
			t.Fatalf("%s access = %+v, want level none + AdminScope (no body in the DTO)", what, acc)
		}
	}

	// Share with someone else, then revoke it.
	sh, err := f.svc.ShareDocument(f.ctx, admin, docR.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: DocumentLevelComment,
	})
	if err != nil {
		t.Fatalf("admin ShareDocument to member: %v", err)
	}
	if err := f.svc.RevokeDocumentShare(f.ctx, admin, docR.ID, sh.ID); err != nil {
		t.Fatalf("admin RevokeDocumentShare: %v", err)
	}
	// A share the ACL owner made is revocable too.
	other := f.share(t, docR, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	if err := f.svc.RevokeDocumentShare(f.ctx, admin, docR.ID, other.ID); err != nil {
		t.Fatalf("admin RevokeDocumentShare of owner's share: %v", err)
	}

	// Public links.
	link, err := f.svc.CreateDocumentLink(f.ctx, admin, docR.ID, 1)
	if err != nil {
		t.Fatalf("admin CreateDocumentLink: %v", err)
	}
	if err := f.svc.RevokeDocumentLink(f.ctx, admin, docR.ID, link.Link.ID); err != nil {
		t.Fatalf("admin RevokeDocumentLink: %v", err)
	}

	// Access list: the full lists, own access level none + AdminScope.
	f.share(t, docR, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	ov, err := f.svc.DocumentAccessList(f.ctx, admin, docR.ID)
	if err != nil {
		t.Fatalf("admin DocumentAccessList: %v", err)
	}
	noRead(t, "access list My", ov.My)
	if ov.ACLOwner == nil || ov.ACLOwner.UserID != tn.aclOwner.ID || len(ov.Shares) == 0 {
		t.Fatalf("admin access list = %+v, want ACL owner + shares", ov)
	}
	// A view reader still gets only My.
	ov, err = f.svc.DocumentAccessList(f.ctx, Human(tn.outsider.ID), docR.ID)
	if err != nil || ov.ACLOwner != nil || len(ov.Shares) != 0 || ov.My.Level != DocumentLevelView {
		t.Fatalf("view reader access list = %+v, %v; want My only", ov, err)
	}

	// Access logs: admin passes, a view reader is forbidden, a stranger not found.
	if _, err := f.svc.ListDocumentAccessLogs(f.ctx, admin, docR.ID, DocumentAccessLogQuery{}); err != nil {
		t.Fatalf("admin ListDocumentAccessLogs: %v", err)
	}
	if _, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.outsider.ID), docR.ID, DocumentAccessLogQuery{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("view reader ListDocumentAccessLogs = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ListDocumentAccessLogs(f.ctx, Human(tn.member.ID), docR.ID, DocumentAccessLogQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger ListDocumentAccessLogs = %v, want ErrNotFound", err)
	}

	// Visibility: restricted -> restricted is allowed (no-op narrowing), any
	// content field is document_restricted, widening is break_glass_required.
	restricted := documentVisibilityRestricted
	view, err := f.svc.UpdateDocument(f.ctx, admin, docR.ID, UpdateDocumentInput{Revision: docR.Revision, Visibility: &restricted})
	if err != nil {
		t.Fatalf("admin UpdateDocument visibility=restricted: %v", err)
	}
	noRead(t, "UpdateDocument view", view.Access)
	title := "Renamed by admin"
	if _, err := f.svc.UpdateDocument(f.ctx, admin, docR.ID, UpdateDocumentInput{Revision: docR.Revision, Title: &title}); !errors.Is(err, ErrDocumentRestricted) {
		t.Fatalf("admin UpdateDocument title = %v, want document_restricted", err)
	}
	ws := "workspace"
	if _, err := f.svc.UpdateDocument(f.ctx, admin, docR.ID, UpdateDocumentInput{Revision: docR.Revision, Visibility: &ws}); !codedIs(err, "break_glass_required") {
		t.Fatalf("admin UpdateDocument restricted->workspace = %v, want break_glass_required", err)
	}
	// The ACL owner (manage) still widens.
	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), docR.ID, UpdateDocumentInput{Revision: docR.Revision, Visibility: &ws}); err != nil {
		t.Fatalf("ACL owner widening: %v", err)
	}
	// Narrowing workspace -> restricted: the admin is manage there.
	cur, err := f.q.GetDocumentByID(f.ctx, docR.ID)
	if err != nil {
		t.Fatal(err)
	}
	view, err = f.svc.UpdateDocument(f.ctx, admin, docR.ID, UpdateDocumentInput{Revision: cur.Revision, Visibility: &restricted})
	if err != nil {
		t.Fatalf("admin narrowing workspace->restricted: %v", err)
	}
	noRead(t, "narrowed view", view.Access)

	// Archive impact, archive, restore - the tree under a restricted root
	// carries a restricted child the admin cannot read either.
	child := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET parent_id = $1 WHERE id = $2`, docR.ID, child.ID); err != nil {
		t.Fatal(err)
	}
	impact, err := f.svc.ArchiveImpact(f.ctx, admin, docR.ID)
	if err != nil || impact.Total != 2 {
		t.Fatalf("admin ArchiveImpact = %+v, %v; want total 2", impact, err)
	}
	arch, err := f.svc.ArchiveDocument(f.ctx, admin, docR.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("admin ArchiveDocument: %v", err)
	}
	noRead(t, "archive result", arch.View.Access)
	rest, err := f.svc.RestoreDocument(f.ctx, admin, docR.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("admin RestoreDocument: %v", err)
	}
	noRead(t, "restore result", rest.View.Access)

	// A reader below manage without AdminScope is still refused, a stranger
	// still not found.
	if _, err := f.svc.ArchiveImpact(f.ctx, Human(tn.outsider.ID), docR.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("view reader ArchiveImpact = %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ArchiveImpact(f.ctx, Human(tn.member.ID), docR.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger ArchiveImpact = %v, want ErrNotFound", err)
	}

	// Content stays closed through all of it.
	if _, err := f.svc.GetDocument(f.ctx, admin, docR.ID); !errors.Is(err, ErrDocumentRestricted) {
		t.Fatalf("admin GetDocument = %v, want document_restricted", err)
	}
	if _, err := f.svc.ListDocumentVersions(f.ctx, admin, docR.ID, ListDocumentVersionsInput{}); !errors.Is(err, ErrDocumentRestricted) {
		t.Fatalf("admin ListDocumentVersions = %v, want document_restricted", err)
	}
}

// DOC5-A04 self-grant half (UNI-1628): an admin-only caller sharing to a
// principal that reaches themselves - their user, a workspace they are in
// (every workspace for an organization owner/admin) or the organization - is
// break_glass_required; manage (the ACL owner, an admin with a manage share)
// shares freely.
func TestAdminSelfShareRequiresBreakGlass(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5self")
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	for _, c := range []struct {
		name  string
		actor Actor
		in    DocumentShareInput
	}{
		{"ws admin to self", Human(tn.wsAdmin.ID), DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelView}},
		{"ws admin to own workspace", Human(tn.wsAdmin.ID), DocumentShareInput{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsA, Level: DocumentLevelView}},
		{"ws admin to organization", Human(tn.wsAdmin.ID), DocumentShareInput{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelComment}},
		{"org owner to a workspace (implicit member)", Human(tn.owner.ID), DocumentShareInput{PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: DocumentLevelView}},
		{"org admin to self", Human(tn.orgAdmin.ID), DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: tn.orgAdmin.ID, Level: DocumentLevelManage}},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.ShareDocument(f.ctx, c.actor, docR.ID, c.in)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != "break_glass_required" || ce.Status != 403 {
				t.Fatalf("ShareDocument = %v, want 403 break_glass_required", err)
			}
		})
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, docR.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("shares written by refused self-grants = %d, %v", n, err)
	}

	// The ws admin shares a workspace they are not in: allowed.
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.wsAdmin.ID), docR.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: tn.wsB, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("ws admin to a workspace they are not in: %v", err)
	}
	// The ACL owner shares to the admin: the normal path.
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), docR.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelManage,
	}); err != nil {
		t.Fatalf("ACL owner to admin: %v", err)
	}
	// Holding manage through that share, the admin may share to themselves
	// (it changes nothing they could not already do).
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.wsAdmin.ID), docR.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("admin with manage share to organization: %v", err)
	}
}

// DOC5-A04 on the batch route (UNI-1641 path, g818 fx2): ShareDocumentBatch
// answers every caller exactly as ShareDocument does - an admin-only caller
// shares with others, a batch reaching themselves is one break_glass_required
// that writes nothing, and manage shares freely.
func TestAdminSelfShareRequiresBreakGlassBatch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "doc5selfb")
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	counts := func(t *testing.T) (shares, audits, outbox int) {
		t.Helper()
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_shares WHERE document_id = $1`, docR.ID).Scan(&shares); err != nil {
			t.Fatal(err)
		}
		return shares, countAudit(t, f, audit.ActionDocumentShared, docR.ID), countOutbox(t, f, "document.shared", docR.ID)
	}

	for _, c := range []struct {
		name  string
		actor Actor
		ids   []string
		level DocumentLevel
	}{
		{"ws admin includes self", Human(tn.wsAdmin.ID), []string{tn.member.ID, tn.wsAdmin.ID}, DocumentLevelView},
		{"ws admin only self at comment", Human(tn.wsAdmin.ID), []string{tn.wsAdmin.ID}, DocumentLevelComment},
		{"org admin includes self at manage", Human(tn.orgAdmin.ID), []string{tn.orgAdmin.ID, tn.outsider.ID}, DocumentLevelManage},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.ShareDocumentBatch(f.ctx, c.actor, docR.ID, c.ids, c.level)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != "break_glass_required" || ce.Status != 403 {
				t.Fatalf("ShareDocumentBatch = %v, want 403 break_glass_required", err)
			}
			if sh, au, ob := counts(t); sh != 0 || au != 0 || ob != 0 {
				t.Fatalf("refused batch wrote shares=%d audit=%d outbox=%d, want 0/0/0", sh, au, ob)
			}
		})
	}

	// An admin-only caller (Level none on a restricted document) shares with
	// others, as the single route lets them, at every level the batch takes.
	for _, level := range []DocumentLevel{DocumentLevelView, DocumentLevelComment} {
		shares, err := f.svc.ShareDocumentBatch(f.ctx, Human(tn.wsAdmin.ID), docR.ID, []string{tn.member.ID, tn.outsider.ID}, level)
		if err != nil || len(shares) != 2 {
			t.Fatalf("ws admin batch to others at %s = %v, %v", level, shares, err)
		}
		if shares[0].Level != string(level) || shares[1].Level != string(level) {
			t.Fatalf("batch at %s gave %+v", level, shares)
		}
	}

	// Holding manage through a share, the admin's batch may include themself.
	if _, err := f.svc.ShareDocument(f.ctx, Human(tn.aclOwner.ID), docR.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.wsAdmin.ID, Level: DocumentLevelManage,
	}); err != nil {
		t.Fatalf("ACL owner to admin: %v", err)
	}
	shares, err := f.svc.ShareDocumentBatch(f.ctx, Human(tn.wsAdmin.ID), docR.ID, []string{tn.wsAdmin.ID, tn.bMember.ID}, DocumentLevelEdit)
	if err != nil || len(shares) != 2 {
		t.Fatalf("manage admin batch including self = %v, %v", shares, err)
	}
}
