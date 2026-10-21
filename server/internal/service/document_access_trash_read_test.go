package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// BE-R2-2 (UNI-2056): FilterReadableDocumentsIgnoringTrash judges the
// documents of a trash notice like the people who could read them before the
// command: the trash step is skipped, everything else still applies.
func TestFilterReadableDocumentsIgnoringTrash(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "frdt")
	svc, _ := tracedDocumentService(t, f.pool)
	trash := func(spec docSpec) db.Document {
		d := f.doc(t, tn, spec)
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
		return d
	}
	state := func(userID string, ids ...string) map[string]DocumentReadState {
		t.Helper()
		out, err := svc.FilterReadableDocumentsIgnoringTrash(f.ctx, userID, ids)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	open := trash(docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	t.Run("a reader who does not manage it reads it, the manager administers it", func(t *testing.T) {
		if got := state(tn.member.ID, open.ID)[open.ID]; got != DocumentReadable {
			t.Fatalf("member state = %q, want readable", got)
		}
		if got := state(tn.aclOwner.ID, open.ID)[open.ID]; got != DocumentTrashable {
			t.Fatalf("owner state = %q, want trashable", got)
		}
		// The plain gate still hides it from the reader.
		plain, err := svc.FilterReadableDocuments(f.ctx, tn.member.ID, []string{open.ID})
		if err != nil || plain[open.ID] != DocumentGone {
			t.Fatalf("plain gate = %v, %v; want gone", plain, err)
		}
	})

	t.Run("no read level is access_lost", func(t *testing.T) {
		if got := state(tn.outsider.ID, open.ID)[open.ID]; got != DocumentAccessLost {
			t.Fatalf("outsider state = %q, want access_lost", got)
		}
	})

	t.Run("a revoked share is access_lost", func(t *testing.T) {
		restricted := trash(docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		share := f.share(t, restricted, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
		if got := state(tn.outsider.ID, restricted.ID)[restricted.ID]; got != DocumentReadable {
			t.Fatalf("shared state = %q, want readable", got)
		}
		if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
			ID: share.ID, OrganizationID: tn.orgID, WorkspaceID: tn.wsA, DocumentID: restricted.ID,
		}); err != nil {
			t.Fatal(err)
		}
		if got := state(tn.outsider.ID, restricted.ID)[restricted.ID]; got != DocumentAccessLost {
			t.Fatalf("revoked state = %q, want access_lost", got)
		}
	})

	t.Run("a deactivated member and a missing row are gone", func(t *testing.T) {
		if got := state(tn.deact.ID, open.ID)[open.ID]; got != DocumentGone {
			t.Fatalf("deactivated state = %q, want gone", got)
		}
		missing := util.NewID()
		if got := state(tn.member.ID, missing)[missing]; got != DocumentGone {
			t.Fatalf("missing state = %q, want gone", got)
		}
	})

	t.Run("a live document answers as the plain gate does", func(t *testing.T) {
		live := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
		if got := state(tn.member.ID, live.ID)[live.ID]; got != DocumentReadable {
			t.Fatalf("live state = %q, want readable", got)
		}
	})
}
