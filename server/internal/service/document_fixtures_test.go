package service

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// G1-09 acceptance scene (plan §4 G1-09, §7 matrix): two organizations,
// three workspaces, and one account per membership shape the isolation rows
// need. The scene is deliberately not admin-only - every positive row below
// runs as a plain member, so a case can never pass just because an admin
// could. e2e/documents-fixtures.ts mirrors the same shape over the HTTP API
// for the browser specs.

// documentMatrix is one built scene.
type documentMatrix struct {
	f *docPermFixture

	aOrgID           string
	bOrgID           string
	aWS1, aWS2, bWS1 string

	aOwner   db.User // organization A owner (implicit workspace admin)
	aAdmin   db.User // admin of A.ws1 only
	aMember  db.User // plain member of A.ws1
	aOutside db.User // A member in A.ws2 only: the recipient outside the workspace
	aDeact   db.User // A.ws1 member, deactivated in organization A
	bOwner   db.User // organization B owner
	bMember  db.User // plain member of B.ws1
	public   db.User // verified account in no organization at all

	aAgent string // active agent of organization A, seated in A.ws1
	bAgent string // active agent of organization B, seated in B.ws1
}

// documentMatrix builds the scene on the fixture's test database.
func (f *docPermFixture) documentMatrix(t *testing.T) *documentMatrix {
	t.Helper()
	m := &documentMatrix{f: f}

	m.aOwner = f.user(t, "matrix", "aowner")
	orgA, err := f.svc.orgs.Create(f.ctx, m.aOwner.ID, "Matrix A", "matrix-a")
	if err != nil {
		t.Fatal(err)
	}
	m.aOrgID = orgA.ID
	a1, err := f.svc.ws.CreateInOrg(f.ctx, m.aOwner.ID, orgA.ID, "A One", "matrix-a-one")
	if err != nil {
		t.Fatal(err)
	}
	a2, err := f.svc.ws.CreateInOrg(f.ctx, m.aOwner.ID, orgA.ID, "A Two", "matrix-a-two")
	if err != nil {
		t.Fatal(err)
	}
	m.aWS1, m.aWS2 = a1.ID, a2.ID

	m.bOwner = f.user(t, "matrix", "bowner")
	orgB, err := f.svc.orgs.Create(f.ctx, m.bOwner.ID, "Matrix B", "matrix-b")
	if err != nil {
		t.Fatal(err)
	}
	m.bOrgID = orgB.ID
	b1, err := f.svc.ws.CreateInOrg(f.ctx, m.bOwner.ID, orgB.ID, "B One", "matrix-b-one")
	if err != nil {
		t.Fatal(err)
	}
	m.bWS1 = b1.ID

	m.aAdmin = f.user(t, "matrix", "aadmin")
	f.orgMember(t, orgA.ID, m.aAdmin.ID, OrgRoleMember)
	f.wsMember(t, m.aWS1, m.aAdmin.ID, "admin")

	m.aMember = f.user(t, "matrix", "amember")
	f.orgMember(t, orgA.ID, m.aMember.ID, OrgRoleMember)
	f.wsMember(t, m.aWS1, m.aMember.ID, "member")

	m.aOutside = f.user(t, "matrix", "aoutside")
	f.orgMember(t, orgA.ID, m.aOutside.ID, OrgRoleMember)
	f.wsMember(t, m.aWS2, m.aOutside.ID, "member")

	m.aDeact = f.user(t, "matrix", "adeact")
	f.orgMember(t, orgA.ID, m.aDeact.ID, OrgRoleMember)
	f.wsMember(t, m.aWS1, m.aDeact.ID, "member")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		orgA.ID, m.aDeact.ID); err != nil {
		t.Fatal(err)
	}

	m.bMember = f.user(t, "matrix", "bmember")
	f.orgMember(t, orgB.ID, m.bMember.ID, OrgRoleMember)
	f.wsMember(t, m.bWS1, m.bMember.ID, "member")

	m.public = f.user(t, "matrix", "public")

	m.aAgent = f.newAgent(t, orgA.ID, "matrix-a-agent", m.aOwner.ID)
	f.addAgent(t, orgA.ID, m.aWS1, m.aAgent, m.aOwner.ID)
	m.bAgent = f.newAgent(t, orgB.ID, "matrix-b-agent", m.bOwner.ID)
	f.addAgent(t, orgB.ID, m.bWS1, m.bAgent, m.bOwner.ID)
	return m
}

// doc inserts one live document in the named tenant pair. An empty aclOwner
// leaves the column NULL (the production INSERT binds the creator only when
// the caller is human); tests do not have to build a full DocumentService
// command for a fixture row.
func (m *documentMatrix) doc(t *testing.T, orgID, wsID, visibility, aclOwner string) db.Document {
	t.Helper()
	id := util.NewID()
	row := baseDoc(map[string]any{
		"id": id, "organization_id": orgID, "workspace_id": wsID,
		"visibility": visibility, "created_by": aclOwner, "updated_by": aclOwner,
	})
	if aclOwner == "" {
		row["created_by"] = m.aMember.ID
		row["updated_by"] = m.aMember.ID
	} else {
		row["acl_owner_id"] = aclOwner
	}
	insertRow(t, m.f.ctx, m.f.pool, "documents", row)
	d, err := m.f.q.GetDocumentByID(m.f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestDocumentMatrixScene proves the G1-09 fixture is the scene the §7 rows
// need and runs the cross-cutting rows that are service-testable on the
// current root: organization/workspace isolation across read, history,
// comments and list; a share to a recipient outside the document's
// workspace and the revoke that blocks the next read; two saves from one
// base such that exactly one wins; and the agent read cap.
func TestDocumentMatrixScene(t *testing.T) {
	f := newDocPermFixture(t)
	m := f.documentMatrix(t)
	H := Human

	t.Run("scene shape", func(t *testing.T) {
		// Two organizations and exactly three workspaces.
		var orgs, workspaces int
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM organizations WHERE id IN ($1, $2)`, m.aOrgID, m.bOrgID).Scan(&orgs); err != nil {
			t.Fatal(err)
		}
		if err := f.pool.QueryRow(f.ctx,
			`SELECT count(*) FROM workspaces WHERE organization_id IN ($1, $2)`, m.aOrgID, m.bOrgID).Scan(&workspaces); err != nil {
			t.Fatal(err)
		}
		if orgs != 2 || workspaces != 3 {
			t.Fatalf("scene has %d organizations and %d workspaces, want 2 and 3", orgs, workspaces)
		}
		// Roles come from the same gates production uses.
		if _, err := f.svc.orgs.RequireMember(f.ctx, m.aOrgID, m.aOwner.ID); err != nil {
			t.Fatalf("aOwner: %v", err)
		}
		if mm, err := f.svc.ws.RequireMember(f.ctx, m.aWS1, m.aMember.ID); err != nil || mm.Role != "member" {
			t.Fatalf("aMember: %v %+v", err, mm)
		}
		if _, err := f.svc.orgs.RequireMember(f.ctx, m.bOrgID, m.bMember.ID); err != nil {
			t.Fatalf("bMember: %v", err)
		}
		if _, err := f.svc.orgs.RequireMember(f.ctx, m.aOrgID, m.public.ID); !isGateRefusal(err) {
			t.Fatalf("public must not be a member: %v", err)
		}
		if _, err := f.svc.ws.RequireAgentMember(f.ctx, m.aWS1, m.aAgent); err != nil {
			t.Fatalf("aAgent: %v", err)
		}
		// The recipient outside the workspace is a member of the sibling,
		// never of the document's workspace.
		if _, err := f.svc.ws.RequireMember(f.ctx, m.aWS1, m.aOutside.ID); !isGateRefusal(err) {
			t.Fatalf("aOutside must not be in A.ws1: %v", err)
		}
	})

	t.Run("read, history, comments and list never cross the tenant pair", func(t *testing.T) {
		doc := m.doc(t, m.aOrgID, m.aWS1, "workspace", "")

		// Positive control: a plain member reads without any admin role.
		view, err := f.svc.GetDocument(f.ctx, H(m.aMember.ID), doc.ID)
		if err != nil || view.Access.Level != DocumentLevelEdit || view.Access.Via != DocumentViaMember {
			t.Fatalf("plain member read = %+v, %v", view.Access, err)
		}

		for _, c := range []struct {
			name  string
			actor Actor
			want  error
			// The list is the one path a workspace non-member may still use
			// through share legs: cross-tenant callers meet a gate refusal
			// (any), an unshared sibling-workspace member gets an empty
			// page, and the deactivated gate answer stays exact.
			listGateRefusal bool
			listEmptyOK     bool
		}{
			{"other organization", H(m.bMember.ID), ErrNotFound, true, false},
			{"account in no organization", H(m.public.ID), ErrNotFound, true, false},
			{"organization member outside the workspace", H(m.aOutside.ID), ErrNotFound, false, true},
			{"deactivated member", H(m.aDeact.ID), ErrMemberDeactivated, false, false},
		} {
			t.Run(c.name, func(t *testing.T) {
				if _, err := f.svc.GetDocument(f.ctx, c.actor, doc.ID); !errors.Is(err, c.want) {
					t.Fatalf("read: %v, want %v", err, c.want)
				}
				if _, err := f.svc.ListDocumentVersions(f.ctx, c.actor, doc.ID, ListDocumentVersionsInput{}); !errors.Is(err, c.want) {
					t.Fatalf("history: %v, want %v", err, c.want)
				}
				if _, err := f.svc.DocumentComments(f.ctx, c.actor, doc.ID); !errors.Is(err, c.want) {
					t.Fatalf("comments: %v, want %v", err, c.want)
				}
				page, err := f.svc.ListDocuments(f.ctx, c.actor, m.aWS1, ListDocumentsInput{Query: "matrix"})
				switch {
				case c.listEmptyOK:
					if err != nil {
						t.Fatalf("list: %v, want an empty page", err)
					}
				case c.listGateRefusal:
					if !isGateRefusal(err) {
						t.Fatalf("list: %v, want a gate refusal", err)
					}
				default:
					if !errors.Is(err, c.want) {
						t.Fatalf("list: %v, want %v", err, c.want)
					}
				}
				if len(page.Items) != 0 {
					t.Fatalf("list leaked %d row(s)", len(page.Items))
				}
			})
		}

		// The sibling workspace in the same organization stays closed too:
		// membership in A.ws2 is not membership in A.ws1.
		if _, err := f.svc.GetDocument(f.ctx, H(m.aOutside.ID), doc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("sibling workspace read: %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("share to a recipient outside the workspace, revoke blocks the next read", func(t *testing.T) {
		doc := m.doc(t, m.aOrgID, m.aWS1, "restricted", "")
		if _, err := f.svc.GetDocument(f.ctx, H(m.aOutside.ID), doc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("before the share: %v, want %v", err, ErrNotFound)
		}
		sh := f.share(t, doc, DocumentPrincipalUser, m.aOutside.ID, DocumentLevelView, m.aMember.ID)
		view, err := f.svc.GetDocument(f.ctx, H(m.aOutside.ID), doc.ID)
		if err != nil || view.Access.Level != DocumentLevelView || view.Access.Via != DocumentViaShare {
			t.Fatalf("after the share = %+v, %v", view.Access, err)
		}
		f.revoke(t, sh, m.aMember.ID)
		if _, err := f.svc.GetDocument(f.ctx, H(m.aOutside.ID), doc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("after the revoke: %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("two saves on one base: one wins, the stale one conflicts", func(t *testing.T) {
		doc := m.doc(t, m.aOrgID, m.aWS1, "workspace", "")
		save := func(text string, revision int64) error {
			content, err := json.Marshal(map[string]any{
				"type": "doc",
				"content": []any{map[string]any{
					"type":    "paragraph",
					"content": []any{map[string]any{"type": "text", "text": text}},
				}},
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.svc.UpdateDocument(f.ctx, H(m.aMember.ID), doc.ID, UpdateDocumentInput{
				Revision: revision, Content: content,
			})
			return err
		}
		if err := save("first", 1); err != nil {
			t.Fatalf("first save: %v", err)
		}
		err := save("second", 1)
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "revision_conflict" || ce.Status != 422 {
			t.Fatalf("stale save = %v, want revision_conflict 422", err)
		}
		// The winner's content is untouched.
		view, err := f.svc.GetDocument(f.ctx, H(m.aMember.ID), doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if view.Document.Revision != 2 {
			t.Fatalf("revision = %d, want 2", view.Document.Revision)
		}
	})

	t.Run("agent reads workspace-visible pages, never restricted ones, never saves", func(t *testing.T) {
		open := m.doc(t, m.aOrgID, m.aWS1, "workspace", "")
		view, err := f.svc.GetDocument(f.ctx, agentActor(m.aAgent), open.ID)
		if err != nil || view.Access.Level != DocumentLevelView {
			t.Fatalf("agent read = %+v, %v", view.Access, err)
		}
		restricted := m.doc(t, m.aOrgID, m.aWS1, "restricted", "")
		if _, err := f.svc.GetDocument(f.ctx, agentActor(m.aAgent), restricted.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("agent on restricted: %v, want %v", err, ErrNotFound)
		}
		title := "agent"
		if _, err := f.svc.UpdateDocument(f.ctx, agentActor(m.aAgent), open.ID, UpdateDocumentInput{Revision: 1, Title: &title}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent save: %v, want %v", err, ErrForbidden)
		}
	})

	// The agent of the other organization has nothing here, even though the
	// scene seats it in the other tenant's workspace.
	t.Run("agent of the other organization reads nothing", func(t *testing.T) {
		doc := m.doc(t, m.aOrgID, m.aWS1, "workspace", "")
		if _, err := f.svc.GetDocument(f.ctx, agentActor(m.bAgent), doc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign agent: %v, want %v", err, ErrNotFound)
		}
	})
}
