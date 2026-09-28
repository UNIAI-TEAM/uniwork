package service

// G1-05b AC-1: an agent actor never writes through any of the 05b service
// verbs. Agents are capped at view (ADR 0010: writes go through proposals),
// so every 05b command refuses the agent before any row moves. One shared
// workspace-visible document keeps the check on the write gate rather than on
// visibility; the restricted-document variant is covered by
// TestDocumentCommentAnonymousAndAgent.

import (
	"errors"
	"testing"
)

func TestDocument05bAgentWritesRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "agentw")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	agent := agentActor(tn.agent)

	refused := func(name string, err error) {
		t.Helper()
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("%s agent write = %v, want ErrForbidden", name, err)
		}
	}

	_, err := f.svc.MoveDocument(f.ctx, agent, d.ID, MoveDocumentInput{Revision: d.Revision})
	refused("move", err)
	_, err = f.svc.ArchiveDocument(f.ctx, agent, d.ID, ArchiveDocumentInput{})
	refused("archive", err)
	_, err = f.svc.RestoreDocument(f.ctx, agent, d.ID, ArchiveDocumentInput{})
	refused("restore", err)
	_, err = f.svc.ShareDocument(f.ctx, agent, d.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: DocumentLevelView,
	})
	refused("share", err)
	refused("revoke share", f.svc.RevokeDocumentShare(f.ctx, agent, d.ID, "01J8X4SHAREN1P2Q3R4S5T6U7"))
	_, err = f.svc.CreateDocumentLink(f.ctx, agent, d.ID, 7)
	refused("create link", err)
	refused("revoke link", f.svc.RevokeDocumentLink(f.ctx, agent, d.ID, "01J8X4LINK0N1P2Q3R4S5T6U7"))
	_, err = f.svc.SetDocumentPublicLinks(f.ctx, agent, tn.orgID, true)
	refused("public-links setting", err)

	// The document is untouched: the same revision and no archive flag.
	got, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != d.Revision || got.ArchivedAt.Valid {
		t.Fatalf("agent writes moved a row: revision %d->%d archived=%v", d.Revision, got.Revision, got.ArchivedAt.Valid)
	}
}
