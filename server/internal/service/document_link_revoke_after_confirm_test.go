package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-1914: the e2e sequence of documents-sharing-ui.spec.ts, one service call
// per request. A public link is revoked after the organization share was
// revoked through the access update (dry run, then confirm) while the owner
// holds an edit tenure and the release consumer has re-checked it. Every step
// runs under a deadline, so a transaction or pool connection left behind fails
// the test instead of blocking it, and the pool must be back to what it held
// before the first call.
func TestLinkRevokeAfterAccessConfirmDoesNotBlock(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "revokehang")
	f.withLinks(t)
	mgr := Human(tn.aclOwner.ID)
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.owner.ID), tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	idle := f.pool.Stat().AcquiredConns()

	created, err := f.svc.CreateDocumentLink(ctx, mgr, doc.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ShareDocument(ctx, mgr, doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	tenure, err := f.svc.AcquireDocumentEditLock(ctx, mgr, doc.ID, AcquireDocumentEditLockInput{
		EditorID: "revoke-hang-editor", Client: DocumentEditClientWebPage,
	})
	if err != nil {
		t.Fatalf("acquire the edit tenure: %v", err)
	}

	revoke := UpdateDocumentAccessInput{Items: []DocumentAccessBatchItem{
		{PrincipalType: DocumentPrincipalOrganization, PrincipalID: tn.orgID, Level: nil},
	}}
	dry := revoke
	dry.DryRun = true
	if _, err := f.svc.UpdateDocumentAccess(ctx, mgr, doc.ID, dry); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if _, err := f.svc.UpdateDocumentAccess(ctx, mgr, doc.ID, revoke); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	ev := outbox.Row{
		ID: util.NewID(), Topic: "document.share_revoked", OrganizationID: pgText(tn.orgID),
		Payload: `{"document_id":"` + doc.ID + `","organization_id":"` + tn.orgID + `"}`,
	}
	if err := NewDocumentEditLockReleaser(f.svc).Handle(ctx, ev); err != nil {
		t.Fatalf("release consumer: %v", err)
	}
	if _, err := f.svc.HeartbeatDocumentEditLock(ctx, mgr, doc.ID, tenure.Lock.ID); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	overview, err := f.svc.DocumentAccessList(ctx, mgr, doc.ID)
	if err != nil {
		t.Fatalf("access list: %v", err)
	}
	if len(overview.Links) != 1 {
		t.Fatalf("live links before the revoke = %d, want 1", len(overview.Links))
	}

	if err := f.svc.RevokeDocumentLink(ctx, mgr, doc.ID, created.Link.ID); err != nil {
		t.Fatalf("revoke the link: %v", err)
	}
	overview, err = f.svc.DocumentAccessList(ctx, mgr, doc.ID)
	if err != nil {
		t.Fatalf("access list after the revoke: %v", err)
	}
	if len(overview.Links) != 0 {
		t.Fatalf("live links after the revoke = %d, want 0", len(overview.Links))
	}
	if got := f.pool.Stat().AcquiredConns(); got != idle {
		t.Fatalf("pool holds %d connections after the sequence, want %d", got, idle)
	}
}
