package service

// G1-05b AC-1: an agent actor never writes through any of the 05b service
// verbs. Agents are capped at view (ADR 0010: writes go through proposals),
// so every 05b command refuses the agent before any row moves. The owner
// seeds a live share and a live link first, and the test proves the refusals
// left both active, the settings row untouched and an archived document
// archived.

import (
	"errors"
	"testing"
)

func TestDocument05bAgentWritesRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "agentw")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	agent := agentActor(tn.agent)
	mgr := Human(tn.aclOwner.ID)
	orgOwner := Human(tn.owner.ID)

	// Real revoke targets: a live share and a live link, and the switch on.
	f.svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, orgOwner, tn.orgID, true); err != nil {
		t.Fatalf("enable links: %v", err)
	}
	liveShare, err := f.svc.ShareDocument(f.ctx, mgr, d.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.member.ID, Level: DocumentLevelView,
	})
	if err != nil {
		t.Fatalf("seed share: %v", err)
	}
	liveLink, err := f.svc.CreateDocumentLink(f.ctx, mgr, d.ID, 7)
	if err != nil {
		t.Fatalf("seed link: %v", err)
	}
	settingsBefore, settingsErrBefore := f.q.GetDocumentSettings(f.ctx, tn.orgID)
	if settingsErrBefore != nil {
		t.Fatalf("settings before: %v", settingsErrBefore)
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
	refused("revoke share", f.svc.RevokeDocumentShare(f.ctx, agent, d.ID, liveShare.ID))
	_, err = f.svc.CreateDocumentLink(f.ctx, agent, d.ID, 7)
	refused("create link", err)
	refused("revoke link", f.svc.RevokeDocumentLink(f.ctx, agent, d.ID, liveLink.Link.ID))
	_, err = f.svc.SetDocumentPublicLinks(f.ctx, agent, tn.orgID, false)
	refused("public-links setting", err)

	// Nothing moved: revision, archive flag, the seeded share and link, the
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
	shareLive, linkLive := false, false
	for _, sh := range ov.Shares {
		if sh.Share.ID == liveShare.ID && !sh.Share.RevokedAt.Valid {
			shareLive = true
		}
	}
	for _, l := range ov.Links {
		if l.ID == liveLink.Link.ID {
			linkLive = true
		}
	}
	if !shareLive {
		t.Fatalf("seeded share is no longer live: %+v", ov.Shares)
	}
	if !linkLive {
		t.Fatalf("seeded link is no longer live: %+v", ov.Links)
	}
	settingsAfter, settingsErrAfter := f.q.GetDocumentSettings(f.ctx, tn.orgID)
	if settingsErrAfter != nil {
		t.Fatalf("settings after: %v", settingsErrAfter)
	}
	if settingsAfter.PublicLinksEnabled != settingsBefore.PublicLinksEnabled {
		t.Fatalf("agent touched the settings row: before %+v after %+v", settingsBefore, settingsAfter)
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
