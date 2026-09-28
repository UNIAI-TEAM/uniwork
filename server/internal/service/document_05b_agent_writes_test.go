package service

// G1-05b AC-1: an agent actor never writes through any of the 05b service
// verbs. Agents are capped at view (ADR 0010: writes go through proposals),
// so every 05b command refuses the agent before any row moves. The owner
// seeds a live share first and the test proves the refusals left it active,
// the settings row untouched and an archived document archived.

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocument05bAgentWritesRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "agentw")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	agent := agentActor(tn.agent)
	mgr := Human(tn.aclOwner.ID)

	// A real live share the agent's revoke attempt must not touch.
	live, err := f.svc.ShareDocument(f.ctx, mgr, d.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: DocumentLevelView,
	})
	if err != nil {
		t.Fatalf("seed share: %v", err)
	}

	refused := func(name string, err error) {
		t.Helper()
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("%s agent write = %v, want ErrForbidden", name, err)
		}
	}
	_, err = f.svc.MoveDocument(f.ctx, agent, d.ID, MoveDocumentInput{Revision: d.Revision})
	refused("move", err)
	_, err = f.svc.ArchiveDocument(f.ctx, agent, d.ID, ArchiveDocumentInput{})
	refused("archive", err)
	_, err = f.svc.RestoreDocument(f.ctx, agent, d.ID, ArchiveDocumentInput{})
	refused("restore", err)
	_, err = f.svc.ShareDocument(f.ctx, agent, d.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.outsider.ID, Level: DocumentLevelView,
	})
	refused("share", err)
	refused("revoke share", f.svc.RevokeDocumentShare(f.ctx, agent, d.ID, live.ID))
	_, err = f.svc.CreateDocumentLink(f.ctx, agent, d.ID, 7)
	refused("create link", err)
	// The link gate (every link command authorizes through the same
	// requireDocumentACLChange path) refuses before the fabricated id is
	// ever looked up, so no link row can move.
	refused("revoke link", f.svc.RevokeDocumentLink(f.ctx, agent, d.ID, "01J8X4LINK0N1P2Q3R4S5T6U7"))
	_, err = f.svc.SetDocumentPublicLinks(f.ctx, agent, tn.orgID, true)
	refused("public-links setting", err)

	// Nothing moved: revision, archive flag, the seeded share, the absent
	// settings row.
	got, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != d.Revision || got.ArchivedAt.Valid {
		t.Fatalf("agent writes moved a row: revision %d->%d archived=%v", d.Revision, got.Revision, got.ArchivedAt.Valid)
	}
	ov, err := f.svc.DocumentAccessList(f.ctx, mgr, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	var seeded *db.DocumentShare
	for i := range ov.Shares {
		if ov.Shares[i].Share.ID == live.ID {
			seeded = &ov.Shares[i].Share
		}
	}
	if seeded == nil || !shareIsLive(t, f, *seeded) {
		t.Fatalf("seeded share is no longer live: %+v", ov.Shares)
	}
	if set, err := f.q.GetDocumentSettings(f.ctx, tn.orgID); err == nil && set.PublicLinksEnabled {
		t.Fatalf("agent enabled public links")
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal(err)
	}

	// An archived document is hidden below manage, so the agent's restore is
	// not found rather than forbidden - and the row stays archived.
	if _, err := f.svc.ArchiveDocument(f.ctx, mgr, d.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("owner archive: %v", err)
	}
	if _, err := f.svc.RestoreDocument(f.ctx, agent, d.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("agent restore of an archived doc = %v, want ErrNotFound", err)
	}
	after, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ArchivedAt.Valid {
		t.Fatal("agent restore unarchived the document")
	}
}

// shareIsLive re-reads a share row and answers whether it is still live.
func shareIsLive(t *testing.T, f *docPermFixture, sh db.DocumentShare) bool {
	t.Helper()
	row, err := f.q.GetDocumentShare(f.ctx, db.GetDocumentShareParams{
		OrganizationID: sh.OrganizationID, WorkspaceID: sh.WorkspaceID, DocumentID: sh.DocumentID,
		PrincipalType: sh.PrincipalType, PrincipalID: sh.PrincipalID,
	})
	if err != nil {
		return false
	}
	return !row.RevokedAt.Valid
}
