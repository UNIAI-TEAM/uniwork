package service

// G1-08 (UNI-682): the organization public-links read has the same gate as the
// write - owner/admin only, non-members learn nothing - and an organization
// that never touched the switch answers the same default the public-link gate
// applies (off) without writing a row. An agent actor is refused even though
// this is a read: agents never read tenant settings through a command actor.

import (
	"errors"
	"testing"
)

func TestDocumentSettingsRead(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "setread")

	if _, err := f.svc.GetDocumentSettings(f.ctx, agentActor(tn.agent), tn.orgID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent read = %v, want ErrForbidden", err)
	}

	// Untouched organization: default off, and no row was written just to read.
	set, err := f.svc.GetDocumentSettings(f.ctx, Human(tn.owner.ID), tn.orgID)
	if err != nil {
		t.Fatalf("owner default read: %v", err)
	}
	if set.PublicLinksEnabled || set.OrganizationID != tn.orgID {
		t.Fatalf("default = %+v, want disabled %s", set, tn.orgID)
	}
	var rows int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_settings WHERE organization_id = $1`, tn.orgID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("a read wrote %d settings rows", rows)
	}

	// The write's value is what the read reports, for an admin too.
	if _, err := f.svc.SetDocumentPublicLinks(f.ctx, Human(tn.owner.ID), tn.orgID, true); err != nil {
		t.Fatalf("owner set: %v", err)
	}
	set, err = f.svc.GetDocumentSettings(f.ctx, Human(tn.orgAdmin.ID), tn.orgID)
	if err != nil || !set.PublicLinksEnabled {
		t.Fatalf("admin read = %+v err=%v", set, err)
	}

	if _, err := f.svc.GetDocumentSettings(f.ctx, Human(tn.member.ID), tn.orgID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member read = %v, want ErrForbidden", err)
	}
	// A person outside the organization learns nothing: not found, not forbidden.
	stranger := f.user(t, "setread", "stranger")
	if _, err := f.svc.GetDocumentSettings(f.ctx, Human(stranger.ID), tn.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member read = %v, want ErrNotFound", err)
	}
}
