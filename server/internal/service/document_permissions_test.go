package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-676 (G1-02a): the document permission gate. effectiveLevel is proven
// with a positive + negative table over every actor kind C-01 §4/§13.4 and
// plan G1-02 name; TestDocumentIsolation proves ids of another tenant are
// not found (never forbidden); the revoke race proves a mutation never
// trusts a decision taken before its own transaction.

// newDocumentServiceForTest wires DocumentService with real membership gates.
func newDocumentServiceForTest(pool *pgxpool.Pool, q *db.Queries) *DocumentService {
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	return NewDocumentService(pool, q, orgs, ws)
}

// mapOwnerResolver answers per actor id; everyone else resolves to none.
type mapOwnerResolver map[string]DocumentLevel

func (m mapOwnerResolver) Resolve(_ context.Context, actor Actor, _ string) (DocumentLevel, error) {
	return m[actor.ID], nil
}

type docPermFixture struct {
	ctx  context.Context
	pool *pgxpool.Pool
	q    *db.Queries
	as   *AuthService
	svc  *DocumentService
}

func newDocPermFixture(t *testing.T) *docPermFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	return &docPermFixture{
		ctx:  context.Background(),
		pool: pool,
		q:    q,
		as:   NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil),
		svc:  newDocumentServiceForTest(pool, q),
	}
}

// docTenant is one organization with two workspaces and one person per
// membership shape the permission table needs.
type docTenant struct {
	orgID, wsA, wsB string
	owner           db.User // organization owner (implicit workspace admin)
	orgAdmin        db.User // organization admin, no workspace row
	wsAdmin         db.User // workspace A admin
	aclOwner        db.User // workspace A member holding acl_owner_id
	creator         db.User // workspace A member in created_by, not ACL owner
	member          db.User // workspace A member
	outsider        db.User // organization member in no workspace
	bMember         db.User // workspace B member only
	deact           db.User // workspace A member, deactivated in the org
	agent           string  // agent in workspace A
	agentOut        string  // agent of the org, not in workspace A
}

func (f *docPermFixture) user(t *testing.T, slug, name string) db.User {
	t.Helper()
	return registerVerified(t, f.q, f.as, slug+"-"+name+"@example.com", name)
}

func (f *docPermFixture) orgMember(t *testing.T, orgID, userID, role string) {
	t.Helper()
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: orgID, UserID: userID, Role: role,
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *docPermFixture) wsMember(t *testing.T, wsID, userID, role string) {
	t.Helper()
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: wsID, UserID: userID, Role: role,
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *docPermFixture) newAgent(t *testing.T, orgID, handle, ownerID string) string {
	t.Helper()
	a, err := f.q.CreateAgent(f.ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: orgID, Name: handle, Handle: handle,
		OwnerUserID: ownerID, AutonomyPolicy: "{}",
		CreatedBy: ownerID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

func (f *docPermFixture) addAgent(t *testing.T, orgID, wsID, agentID, by string) {
	t.Helper()
	if err := f.q.AddWorkspaceAgentMember(f.ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: wsID, AgentID: agentID, OrganizationID: orgID,
		CreatedBy: by, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *docPermFixture) tenant(t *testing.T, slug string) docTenant {
	t.Helper()
	var tn docTenant
	tn.owner = f.user(t, slug, "owner")
	org, err := f.svc.orgs.Create(f.ctx, tn.owner.ID, "Org "+slug, slug)
	if err != nil {
		t.Fatal(err)
	}
	tn.orgID = org.ID
	a, err := f.svc.ws.CreateInOrg(f.ctx, tn.owner.ID, org.ID, "A "+slug, slug+"-a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.svc.ws.CreateInOrg(f.ctx, tn.owner.ID, org.ID, "B "+slug, slug+"-b")
	if err != nil {
		t.Fatal(err)
	}
	tn.wsA, tn.wsB = a.ID, b.ID

	tn.orgAdmin = f.user(t, slug, "orgadmin")
	f.orgMember(t, org.ID, tn.orgAdmin.ID, OrgRoleAdmin)
	for _, p := range []struct {
		u    *db.User
		name string
		ws   string
		role string
	}{
		{&tn.wsAdmin, "wsadmin", tn.wsA, "admin"},
		{&tn.aclOwner, "aclowner", tn.wsA, "member"},
		{&tn.creator, "creator", tn.wsA, "member"},
		{&tn.member, "member", tn.wsA, "member"},
		{&tn.outsider, "outsider", "", ""},
		{&tn.bMember, "bmember", tn.wsB, "member"},
		{&tn.deact, "deact", tn.wsA, "member"},
	} {
		*p.u = f.user(t, slug, p.name)
		f.orgMember(t, org.ID, p.u.ID, OrgRoleMember)
		if p.ws != "" {
			f.wsMember(t, p.ws, p.u.ID, p.role)
		}
	}
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		org.ID, tn.deact.ID); err != nil {
		t.Fatal(err)
	}
	tn.agent = f.newAgent(t, org.ID, slug+"-agent", tn.owner.ID)
	f.addAgent(t, org.ID, tn.wsA, tn.agent, tn.owner.ID)
	tn.agentOut = f.newAgent(t, org.ID, slug+"-agentout", tn.owner.ID)
	f.addAgent(t, org.ID, tn.wsB, tn.agentOut, tn.owner.ID)
	return tn
}

type docSpec struct {
	ws         string
	visibility string
	aclOwner   string
	createdBy  string
	ownerID    string // non-empty: owned by a work product
}

func (f *docPermFixture) doc(t *testing.T, tn docTenant, s docSpec) db.Document {
	t.Helper()
	id := util.NewID()
	row := baseDoc(map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": s.ws,
		"visibility": s.visibility, "created_by": s.createdBy, "updated_by": s.createdBy,
	})
	if s.aclOwner != "" {
		row["acl_owner_id"] = s.aclOwner
	}
	if s.ownerID != "" {
		row["owner_kind"] = "work_product"
		row["owner_id"] = s.ownerID
	}
	insertRow(t, f.ctx, f.pool, "documents", row)
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (f *docPermFixture) share(t *testing.T, d db.Document, principalType, principalID string, level DocumentLevel, by string) db.DocumentShare {
	t.Helper()
	sh, err := f.q.InsertDocumentShare(f.ctx, db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		DocumentID: d.ID, PrincipalType: principalType, PrincipalID: principalID,
		Level: string(level), GrantedBy: by, GrantedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return sh
}

func (f *docPermFixture) revoke(t *testing.T, sh db.DocumentShare, by string) {
	t.Helper()
	if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
		ID: sh.ID, OrganizationID: sh.OrganizationID, WorkspaceID: sh.WorkspaceID,
		DocumentID: sh.DocumentID, RevokedBy: nullText(by),
	}); err != nil {
		t.Fatal(err)
	}
}

func agentActor(id string) Actor { return Actor{Kind: audit.KindAgent, ID: id} }

type permCase struct {
	name    string
	actor   Actor
	doc     db.Document
	level   DocumentLevel
	via     DocumentVia
	wantErr error // effectiveLevel error (closed tenant)
}

func runPermCases(t *testing.T, f *docPermFixture, cases []permCase) {
	t.Helper()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := f.svc.effectiveLevel(f.ctx, f.q, c.actor, c.doc)
			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("effectiveLevel err = %v, want %v", err, c.wantErr)
				}
			} else if err != nil {
				t.Fatalf("effectiveLevel: %v", err)
			}
			if got.Level != c.level || (c.level != DocumentLevelNone && got.Via != c.via) {
				t.Fatalf("effectiveLevel = %+v, want level %q via %q", got, c.level, c.via)
			}

			// The authorize helper agrees: none (or a closed tenant) never
			// reveals the document; a level lets view in and refuses above it.
			_, _, aerr := f.svc.authorizeDocument(f.ctx, c.actor, c.doc.ID, DocumentLevelView)
			switch {
			case c.wantErr != nil:
				if !errors.Is(aerr, c.wantErr) {
					t.Fatalf("authorize err = %v, want %v", aerr, c.wantErr)
				}
			case c.level == DocumentLevelNone:
				if !errors.Is(aerr, ErrNotFound) {
					t.Fatalf("authorize err = %v, want ErrNotFound", aerr)
				}
			default:
				if aerr != nil {
					t.Fatalf("authorize view: %v", aerr)
				}
				if c.level != DocumentLevelManage {
					if _, _, e := f.svc.authorizeDocument(f.ctx, c.actor, c.doc.ID, DocumentLevelManage); !errors.Is(e, ErrForbidden) {
						t.Fatalf("authorize manage with %q = %v, want ErrForbidden", c.level, e)
					}
				}
			}
		})
	}
}

func TestDocumentPermission(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "perm")
	foreign := f.tenant(t, "permx")
	H := Human

	docW := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.creator.ID})
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, docR, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, docR, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
	docR2 := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, docR2, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, docR2, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
	f.revoke(t, f.share(t, docR2, DocumentPrincipalUser, tn.creator.ID, DocumentLevelEdit, tn.aclOwner.ID), tn.aclOwner.ID)
	// A share on another organization's id never applies.
	f.share(t, docR2, DocumentPrincipalOrganization, foreign.orgID, DocumentLevelManage, tn.aclOwner.ID)

	const wp = "01WPPERM000000000000000000"
	docO := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID, ownerID: wp})
	// §13.7 test 1, full version: a live manage share for someone without a
	// level on the work product is ignored.
	f.share(t, docO, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelManage, tn.aclOwner.ID)
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{
		tn.member.ID:   DocumentLevelEdit,
		tn.aclOwner.ID: DocumentLevelView,
		tn.agent:       DocumentLevelManage,
		tn.bMember.ID:  DocumentLevelManage,
	})

	none := DocumentLevelNone
	view, edit, manage := DocumentLevelView, DocumentLevelEdit, DocumentLevelManage
	member, share, owner := DocumentViaMember, DocumentViaShare, DocumentViaOwner

	runPermCases(t, f, []permCase{
		// Workspace-visible document.
		{"org owner is implicit ws admin", H(tn.owner.ID), docW, manage, member, nil},
		{"org admin is implicit ws admin", H(tn.orgAdmin.ID), docW, manage, member, nil},
		{"ws admin", H(tn.wsAdmin.ID), docW, manage, member, nil},
		{"acl owner", H(tn.aclOwner.ID), docW, manage, member, nil},
		{"creator without acl slot edits only", H(tn.creator.ID), docW, edit, member, nil},
		{"effective member", H(tn.member.ID), docW, edit, member, nil},
		{"org member outside the workspace", H(tn.outsider.ID), docW, none, "", nil},
		{"member of another workspace", H(tn.bMember.ID), docW, none, "", nil},
		{"deactivated member", H(tn.deact.ID), docW, none, "", ErrMemberDeactivated},
		{"agent member reads", agentActor(tn.agent), docW, view, member, nil},
		{"agent outside the workspace", agentActor(tn.agentOut), docW, none, "", nil},
		{"system actor", audit.System("job"), docW, none, "", nil},
		{"other tenant's owner", H(foreign.owner.ID), docW, none, "", nil},
		{"other tenant's agent", agentActor(foreign.agent), docW, none, "", nil},

		// Restricted document: the member line is gone, shares remain.
		{"restricted: acl owner", H(tn.aclOwner.ID), docR, manage, member, nil},
		{"restricted: ws admin", H(tn.wsAdmin.ID), docR, manage, member, nil},
		{"restricted: plain member", H(tn.member.ID), docR, none, "", nil},
		{"restricted: user share view", H(tn.outsider.ID), docR, view, share, nil},
		{"restricted: workspace share edit", H(tn.bMember.ID), docR, edit, share, nil},
		{"restricted: agent", agentActor(tn.agent), docR, none, "", nil},
		{"restricted: organization share view", H(tn.outsider.ID), docR2, view, share, nil},
		{"restricted: user share manage", H(tn.member.ID), docR2, manage, share, nil},
		{"restricted: revoked share falls back to org share", H(tn.creator.ID), docR2, view, share, nil},
		{"restricted: deactivated member", H(tn.deact.ID), docR2, none, "", ErrMemberDeactivated},
		{"restricted: foreign org share ignored", H(foreign.owner.ID), docR2, none, "", nil},

		// Owned document: the owner resolver decides alone.
		{"owned: resolver edit", H(tn.member.ID), docO, edit, owner, nil},
		{"owned: acl owner gets resolver view", H(tn.aclOwner.ID), docO, view, owner, nil},
		{"owned: ws admin without delegation", H(tn.wsAdmin.ID), docO, none, "", nil},
		{"owned: org owner without delegation", H(tn.owner.ID), docO, none, "", nil},
		{"owned: live manage share ignored", H(tn.outsider.ID), docO, none, "", nil},
		{"owned: resolver manage for non-member", H(tn.bMember.ID), docO, manage, owner, nil},
		{"owned: agent capped at view", agentActor(tn.agent), docO, view, owner, nil},
		{"owned: deactivated member", H(tn.deact.ID), docO, none, "", ErrMemberDeactivated},
	})

	t.Run("owned with the default resolver denies everyone", func(t *testing.T) {
		f.svc.SetOwnerLevelResolver(nil)
		defer f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelEdit})
		for _, a := range []Actor{H(tn.owner.ID), H(tn.aclOwner.ID), H(tn.member.ID), agentActor(tn.agent)} {
			got, err := f.svc.effectiveLevel(f.ctx, f.q, a, docO)
			if err != nil || got.Level != DocumentLevelNone {
				t.Fatalf("%s: %+v %v", a.ID, got, err)
			}
		}
	})

	t.Run("workspace share follows membership at read time", func(t *testing.T) {
		if err := f.q.DeleteWorkspaceMember(f.ctx, db.DeleteWorkspaceMemberParams{
			WorkspaceID: tn.wsB, UserID: tn.bMember.ID,
		}); err != nil {
			t.Fatal(err)
		}
		got, err := f.svc.effectiveLevel(f.ctx, f.q, H(tn.bMember.ID), docR)
		if err != nil || got.Level != DocumentLevelNone {
			t.Fatalf("after leaving workspace B: %+v %v", got, err)
		}
		f.wsMember(t, tn.wsB, tn.bMember.ID, "member")
	})

	t.Run("paused or archived agent loses read", func(t *testing.T) {
		for _, c := range []struct{ set, reset string }{
			{`UPDATE agents SET status = 'paused' WHERE id = $1`, `UPDATE agents SET status = 'active' WHERE id = $1`},
			{`UPDATE agents SET archived_at = now() WHERE id = $1`, `UPDATE agents SET archived_at = NULL WHERE id = $1`},
		} {
			if _, err := f.pool.Exec(f.ctx, c.set, tn.agent); err != nil {
				t.Fatal(err)
			}
			got, err := f.svc.effectiveLevel(f.ctx, f.q, agentActor(tn.agent), docW)
			if _, rerr := f.pool.Exec(f.ctx, c.reset, tn.agent); rerr != nil {
				t.Fatal(rerr)
			}
			if err != nil || got.Level != DocumentLevelNone {
				t.Fatalf("%s: %+v %v", c.set, got, err)
			}
		}
	})

	t.Run("agent of another organization seated in the workspace", func(t *testing.T) {
		// A workspace_agent_members row naming a foreign agent (bad data, an
		// import) still grants nothing: the agent must belong to the
		// document's organization.
		f.addAgent(t, tn.orgID, tn.wsA, foreign.agent, tn.owner.ID)
		got, err := f.svc.effectiveLevel(f.ctx, f.q, agentActor(foreign.agent), docW)
		if err != nil || got.Level != DocumentLevelNone {
			t.Fatalf("foreign agent: %+v %v", got, err)
		}
	})

	t.Run("workspace share of another organization never applies", func(t *testing.T) {
		// dual is a member of both organizations and of the foreign
		// workspace. A share row naming that workspace on this tenant's
		// document grants nothing, and the foreign tenant's state never
		// leaks into this document's answer.
		dual := f.user(t, "perm", "dual")
		f.orgMember(t, tn.orgID, dual.ID, OrgRoleMember)
		f.orgMember(t, foreign.orgID, dual.ID, OrgRoleMember)
		f.wsMember(t, foreign.wsA, dual.ID, "member")
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, d, DocumentPrincipalWorkspace, foreign.wsA, DocumentLevelEdit, tn.aclOwner.ID)
		got, err := f.svc.effectiveLevel(f.ctx, f.q, H(dual.ID), d)
		if err != nil || got.Level != DocumentLevelNone {
			t.Fatalf("foreign workspace share: %+v %v", got, err)
		}
		if _, err := f.pool.Exec(f.ctx, `UPDATE organizations SET status = 'suspended' WHERE id = $1`, foreign.orgID); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = f.pool.Exec(f.ctx, `UPDATE organizations SET status = 'active' WHERE id = $1`, foreign.orgID)
		}()
		// Same answer, no foreign organization_suspended.
		f.share(t, d, DocumentPrincipalUser, dual.ID, DocumentLevelView, tn.aclOwner.ID)
		got, err = f.svc.effectiveLevel(f.ctx, f.q, H(dual.ID), d)
		if err != nil || got.Level != DocumentLevelView || got.Via != DocumentViaShare {
			t.Fatalf("with the foreign org suspended: %+v %v", got, err)
		}
	})

	t.Run("archived documents are found by manage only", func(t *testing.T) {
		d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
		noop := func(*db.Queries, db.Document, DocumentAccess) error { return nil }
		for _, a := range []Actor{H(tn.member.ID), agentActor(tn.agent)} {
			if _, _, err := f.svc.authorizeDocument(f.ctx, a, d.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s reading archived: %v", a.ID, err)
			}
			if err := f.svc.withDocumentMutation(f.ctx, a, d.ID, DocumentLevelView, noop); !errors.Is(err, ErrNotFound) {
				t.Fatalf("%s mutating archived: %v", a.ID, err)
			}
		}
		for _, a := range []Actor{H(tn.aclOwner.ID), H(tn.wsAdmin.ID), H(tn.owner.ID)} {
			if _, _, err := f.svc.authorizeDocument(f.ctx, a, d.ID, DocumentLevelManage); err != nil {
				t.Fatalf("%s (manage) reading archived: %v", a.ID, err)
			}
			if err := f.svc.withDocumentMutation(f.ctx, a, d.ID, DocumentLevelManage, noop); err != nil {
				t.Fatalf("%s (manage) mutating archived: %v", a.ID, err)
			}
		}
	})

	t.Run("suspended organization closes every path", func(t *testing.T) {
		if _, err := f.pool.Exec(f.ctx, `UPDATE organizations SET status = 'suspended' WHERE id = $1`, tn.orgID); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = f.pool.Exec(f.ctx, `UPDATE organizations SET status = 'active' WHERE id = $1`, tn.orgID)
		}()
		for _, c := range []struct {
			a Actor
			d db.Document
		}{
			{H(tn.owner.ID), docW}, {H(tn.aclOwner.ID), docR}, {H(tn.outsider.ID), docR},
			{H(tn.member.ID), docO}, {agentActor(tn.agent), docW},
		} {
			got, err := f.svc.effectiveLevel(f.ctx, f.q, c.a, c.d)
			if !errors.Is(err, ErrOrganizationSuspended) || got.Level != DocumentLevelNone {
				t.Fatalf("%s on %s: %+v %v", c.a.ID, c.d.ID, got, err)
			}
			if _, _, err := f.svc.authorizeDocument(f.ctx, c.a, c.d.ID, DocumentLevelView); !errors.Is(err, ErrOrganizationSuspended) {
				t.Fatalf("authorize %s: %v", c.a.ID, err)
			}
		}
	})

	t.Run("unknown id and invalid actor are not found", func(t *testing.T) {
		if _, _, err := f.svc.authorizeDocument(f.ctx, H(tn.owner.ID), util.NewID(), DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown id: %v", err)
		}
		if _, _, err := f.svc.authorizeDocument(f.ctx, Actor{}, docW.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("empty actor: %v", err)
		}
	})

	t.Run("child paths authorize the parent document", func(t *testing.T) {
		verRow := map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": docR.ID, "version": 1, "kind": "page", "reason": "manual",
			"content": []byte(`{"type":"doc"}`), "created_by": tn.aclOwner.ID, "created_by_kind": "human",
		}
		insertRow(t, f.ctx, f.pool, "document_versions", verRow)
		asset, err := f.q.InsertDocumentAsset(f.ctx, db.InsertDocumentAssetParams{
			ID: util.NewID(), OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: docR.ID,
			FileID: util.NewID(), MimeType: "image/png", SizeBytes: 1,
			CreatedBy: tn.aclOwner.ID, CreatedByKind: "human",
		})
		if err != nil {
			t.Fatal(err)
		}
		// A reader of the document reaches its children.
		if _, v, _, err := f.svc.authorizeDocumentVersion(f.ctx, H(tn.outsider.ID), docR.ID, 1, DocumentLevelView); err != nil || v.DocumentID != docR.ID {
			t.Fatalf("reader version: %v", err)
		}
		if _, a, _, err := f.svc.authorizeDocumentAsset(f.ctx, H(tn.outsider.ID), docR.ID, asset.ID, DocumentLevelView); err != nil || a.ID != asset.ID {
			t.Fatalf("reader asset: %v", err)
		}
		// A non-reader gets not found for the child, same as for a missing one.
		if _, _, _, err := f.svc.authorizeDocumentVersion(f.ctx, H(tn.member.ID), docR.ID, 1, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader version: %v", err)
		}
		if _, _, _, err := f.svc.authorizeDocumentAsset(f.ctx, H(tn.member.ID), docR.ID, asset.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-reader asset: %v", err)
		}
		// A child reached through a readable document it does not belong to.
		if _, _, _, err := f.svc.authorizeDocumentAsset(f.ctx, H(tn.member.ID), docW.ID, asset.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("asset through foreign parent: %v", err)
		}
		if _, _, _, err := f.svc.authorizeDocumentVersion(f.ctx, H(tn.member.ID), docW.ID, 1, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("version through foreign parent: %v", err)
		}
		// Level is checked on the parent: a viewer cannot edit a child.
		if _, _, _, err := f.svc.authorizeDocumentAsset(f.ctx, H(tn.outsider.ID), docR.ID, asset.ID, DocumentLevelEdit); !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer editing asset: %v", err)
		}
	})
}

// TestDocumentIsolation: two organizations x two workspaces. Every id of
// another tenant is not found - never forbidden - on the document gate, the
// child gates and the mutation gate; inside one organization a workspace
// member cannot reach the other workspace's documents either.
func TestDocumentIsolation(t *testing.T) {
	f := newDocPermFixture(t)
	tenants := []docTenant{f.tenant(t, "isoa"), f.tenant(t, "isob")}

	type cell struct {
		tn    int
		ws    string
		doc   db.Document
		asset db.DocumentAsset
	}
	var cells []cell
	for i, tn := range tenants {
		for _, ws := range []string{tn.wsA, tn.wsB} {
			d := f.doc(t, tn, docSpec{ws: ws, visibility: "workspace", aclOwner: tn.owner.ID, createdBy: tn.owner.ID})
			insertRow(t, f.ctx, f.pool, "document_versions", map[string]any{
				"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": ws,
				"document_id": d.ID, "version": 1, "kind": "page", "reason": "manual",
				"content": []byte(`{"type":"doc"}`), "created_by": tn.owner.ID, "created_by_kind": "human",
			})
			a, err := f.q.InsertDocumentAsset(f.ctx, db.InsertDocumentAssetParams{
				ID: util.NewID(), OrganizationID: tn.orgID, WorkspaceID: ws, DocumentID: d.ID,
				FileID: util.NewID(), MimeType: "image/png", SizeBytes: 1,
				CreatedBy: tn.owner.ID, CreatedByKind: "human",
			})
			if err != nil {
				t.Fatal(err)
			}
			cells = append(cells, cell{tn: i, ws: ws, doc: d, asset: a})
		}
	}

	for i, tn := range tenants {
		actors := []struct {
			name string
			a    Actor
			ws   string // "" = every workspace of the org
		}{
			{"owner", Human(tn.owner.ID), ""},
			{"ws A member", Human(tn.member.ID), tn.wsA},
			{"ws B member", Human(tn.bMember.ID), tn.wsB},
			{"ws A agent", agentActor(tn.agent), tn.wsA},
		}
		for _, ac := range actors {
			for _, c := range cells {
				readable := c.tn == i && (ac.ws == "" || ac.ws == c.ws)
				name := ac.name + "/" + tenants[c.tn].orgID[len(tenants[c.tn].orgID)-4:] + "/" + c.ws[len(c.ws)-4:]
				t.Run(name, func(t *testing.T) {
					_, _, err := f.svc.authorizeDocument(f.ctx, ac.a, c.doc.ID, DocumentLevelView)
					_, _, _, verr := f.svc.authorizeDocumentVersion(f.ctx, ac.a, c.doc.ID, 1, DocumentLevelView)
					_, _, _, aerr := f.svc.authorizeDocumentAsset(f.ctx, ac.a, c.doc.ID, c.asset.ID, DocumentLevelView)
					called := false
					merr := f.svc.withDocumentMutation(f.ctx, ac.a, c.doc.ID, DocumentLevelView,
						func(*db.Queries, db.Document, DocumentAccess) error { called = true; return nil })
					if readable {
						if err != nil || verr != nil || aerr != nil || merr != nil || !called {
							t.Fatalf("readable cell refused: %v / %v / %v / %v", err, verr, aerr, merr)
						}
						return
					}
					for _, e := range []error{err, verr, aerr, merr} {
						if !errors.Is(e, ErrNotFound) {
							t.Fatalf("unreadable cell: got %v, want ErrNotFound (never forbidden)", e)
						}
					}
					if called {
						t.Fatal("mutation ran on an unreadable document")
					}
				})
			}
		}
	}

	t.Run("child id of another tenant through a readable parent", func(t *testing.T) {
		own, other := cells[0], cells[len(cells)-1]
		a := Human(tenants[0].owner.ID)
		if _, _, _, err := f.svc.authorizeDocumentAsset(f.ctx, a, own.doc.ID, other.asset.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign asset id: %v", err)
		}
	})
}

// The mutation gate re-evaluates access inside its own transaction, under
// the document row lock that share grants/revokes take too. Two orders:
// a revoke that commits while the mutation waits for the lock is seen; a
// revoke that starts while the mutation holds the lock waits for it, and the
// next mutation is refused even though an earlier open said "edit".
func TestDocumentPermissionRevokeRace(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "race")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	sh := f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)
	actor := Human(tn.outsider.ID)

	// The decision a client would have cached at open time.
	if _, acc, err := f.svc.authorizeDocument(f.ctx, actor, d.ID, DocumentLevelEdit); err != nil || acc.Level != DocumentLevelEdit {
		t.Fatalf("open: %+v %v", acc, err)
	}

	t.Run("revoke commits while the mutation waits", func(t *testing.T) {
		tx, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(f.ctx) }()
		qtx := f.q.WithTx(tx)
		if _, err := qtx.LockDocumentByID(f.ctx, d.ID); err != nil {
			t.Fatal(err)
		}
		if err := qtx.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
			ID: sh.ID, OrganizationID: sh.OrganizationID, WorkspaceID: sh.WorkspaceID,
			DocumentID: sh.DocumentID, RevokedBy: nullText(tn.aclOwner.ID),
		}); err != nil {
			t.Fatal(err)
		}

		var ran atomic.Bool
		done := make(chan error, 1)
		go func() {
			done <- f.svc.withDocumentMutation(f.ctx, actor, d.ID, DocumentLevelEdit,
				func(*db.Queries, db.Document, DocumentAccess) error { ran.Store(true); return nil })
		}()
		waitForLockWaiter(t, f)
		select {
		case err := <-done:
			t.Fatalf("mutation finished while the document was locked: %v", err)
		default:
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-done; !errors.Is(err, ErrNotFound) {
			t.Fatalf("mutation after revoke: %v, want ErrNotFound", err)
		}
		if ran.Load() {
			t.Fatal("mutation body ran after the share was revoked")
		}
	})

	t.Run("revoke waits for a mutation that holds the lock", func(t *testing.T) {
		sh2 := f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelEdit, tn.aclOwner.ID)
		inside := make(chan struct{})
		release := make(chan struct{})
		done := make(chan error, 1)
		go func() {
			done <- f.svc.withDocumentMutation(f.ctx, actor, d.ID, DocumentLevelEdit,
				func(*db.Queries, db.Document, DocumentAccess) error {
					close(inside)
					<-release
					return nil
				})
		}()
		<-inside
		revoked := make(chan error, 1)
		go func() {
			tx, err := f.pool.Begin(f.ctx)
			if err != nil {
				revoked <- err
				return
			}
			defer func() { _ = tx.Rollback(f.ctx) }()
			qtx := f.q.WithTx(tx)
			if _, err := qtx.LockDocumentByID(f.ctx, d.ID); err != nil {
				revoked <- err
				return
			}
			if err := qtx.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
				ID: sh2.ID, OrganizationID: sh2.OrganizationID, WorkspaceID: sh2.WorkspaceID,
				DocumentID: sh2.DocumentID, RevokedBy: nullText(tn.aclOwner.ID),
			}); err != nil {
				revoked <- err
				return
			}
			revoked <- tx.Commit(f.ctx)
		}()
		waitForLockWaiter(t, f)
		close(release)
		if err := <-done; err != nil {
			t.Fatalf("mutation holding the lock: %v", err)
		}
		if err := <-revoked; err != nil {
			t.Fatalf("revoke: %v", err)
		}
		err := f.svc.withDocumentMutation(f.ctx, actor, d.ID, DocumentLevelEdit,
			func(*db.Queries, db.Document, DocumentAccess) error { return nil })
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("next mutation: %v, want ErrNotFound", err)
		}
	})
}

// waitForLockWaiter blocks until some backend of the test database waits on
// a row lock, so the race tests order their steps without sleeping blind.
func waitForLockWaiter(t *testing.T, f *docPermFixture) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no backend waited on the document lock")
}

// The mutation gate never borrows a second pool connection while its
// transaction holds the document lock: every membership read goes through
// the transaction's q. With two connections and three concurrent mutations
// (each on a document with a workspace share, so several gate reads), a gate
// that read through the pool would wait forever for a connection its
// siblings hold.
func TestDocumentMutationGateOnSmallPool(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "pool")
	cfg := f.pool.Config().Copy()
	cfg.MaxConns = 2
	small, err := pgxpool.NewWithConfig(f.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	svc := newDocumentServiceForTest(small, db.New(small))

	docs := make([]db.Document, 3)
	for i := range docs {
		docs[i] = f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		f.share(t, docs[i], DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
	defer cancel()
	errs := make(chan error, 6)
	start := make(chan struct{})
	for i := 0; i < 6; i++ {
		d := docs[i%len(docs)]
		go func() {
			<-start
			errs <- svc.withDocumentMutation(ctx, Human(tn.bMember.ID), d.ID, DocumentLevelEdit,
				func(*db.Queries, db.Document, DocumentAccess) error {
					time.Sleep(20 * time.Millisecond)
					return nil
				})
		}()
	}
	close(start)
	for i := 0; i < 6; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("mutation %d on a 2-connection pool: %v", i, err)
		}
	}
}
