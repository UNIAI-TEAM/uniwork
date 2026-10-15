package service

// G8-18 / DOC-05 (UNI-1413): the mention picker on a restricted document no
// longer counts organization/workspace admins as readers; only the ACL owner,
// a live share or a live break-glass grant does.

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// breakGlass inserts a live emergency view grant for the person, the row the
// DOC-05 break-glass route will write.
func (f *docPermFixture) breakGlass(t *testing.T, tn docTenant, docID, ws, userID string, expiresIn time.Duration) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_break_glass_grants
		   (id, organization_id, workspace_id, document_id, actor_id, actor_kind, level, reason, expires_at)
		 VALUES ($1, $2, $3, $4, $5, 'human', 'view', 'incident review for the test', now() + $6::interval)`,
		util.NewID(), tn.orgID, ws, docID, userID, expiresIn.String()); err != nil {
		t.Fatal(err)
	}
}

// On a restricted document the default picker lists the ACL owner, a live
// share and a live break-glass grant - and not the organization owner/admin or
// the workspace admin, who read it only through the break-glass gate.
func TestMentionCandidatesRestrictedAdminsAreNotReaders(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnrs")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)

	got := mentionCandidatesOf(t, f, acl, doc.ID, MentionCandidateQuery{})
	if _, ok := got[tn.aclOwner.ID]; !ok {
		t.Error("the ACL owner is missing")
	}
	for name, id := range map[string]string{
		"organization owner": tn.owner.ID, "organization admin": tn.orgAdmin.ID, "workspace admin": tn.wsAdmin.ID,
	} {
		if _, ok := got[id]; ok {
			t.Errorf("%s is listed as a reader of the restricted document", name)
		}
	}

	f.breakGlass(t, tn, doc.ID, doc.WorkspaceID, tn.wsAdmin.ID, time.Hour)
	f.breakGlass(t, tn, doc.ID, doc.WorkspaceID, tn.orgAdmin.ID, -time.Minute) // expired
	got = mentionCandidatesOf(t, f, acl, doc.ID, MentionCandidateQuery{})
	if _, ok := got[tn.wsAdmin.ID]; !ok {
		t.Error("a live break-glass grant does not make the admin a reader")
	}
	if _, ok := got[tn.orgAdmin.ID]; ok {
		t.Error("an expired break-glass grant still lists the admin")
	}

	// A workspace-visible document keeps the implicit admins.
	open := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	got = mentionCandidatesOf(t, f, acl, open.ID, MentionCandidateQuery{})
	for name, id := range map[string]string{"organization owner": tn.owner.ID, "organization admin": tn.orgAdmin.ID, "workspace admin": tn.wsAdmin.ID} {
		if _, ok := got[id]; !ok {
			t.Errorf("%s is missing from the workspace-visible document", name)
		}
	}
}
