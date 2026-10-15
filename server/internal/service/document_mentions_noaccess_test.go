package service

// G8-18 (UNI-1413): GET mention-candidates?include=no_access. The pool is the
// workspace's effective members plus the direct-share users, each marked
// can_view with the predicate the default picker reads, readers first; the
// flag is honoured only for a caller who may list the workspace's members.

import (
	"testing"
	"time"
)

func noAccessQuery(limit int) MentionCandidateQuery {
	return MentionCandidateQuery{IncludeNoAccess: true, Limit: mentionLimit(limit)}
}

// include=no_access on an ordinary document: the workspace's members plus the
// direct-share users, readers first and then by name; can_view equals the
// default picker's predicate (a restricted admin is not a reader).
func TestMentionCandidatesIncludeNoAccessOrdinary(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnio")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)
	acl := Human(tn.aclOwner.ID)

	rows, err := f.svc.MentionCandidates(f.ctx, acl, doc.ID, MentionCandidateQuery{IncludeNoAccess: true})
	if err != nil {
		t.Fatal(err)
	}
	canView := map[string]bool{}
	seenFalse := false
	for _, r := range rows {
		if r.CanView == nil {
			t.Fatalf("row %s carries no can_view with include=no_access", r.UserID)
		}
		canView[r.UserID] = *r.CanView
		if !*r.CanView {
			seenFalse = true
		} else if seenFalse {
			t.Errorf("readable row %s comes after a non-reader: readers must come first", r.UserID)
		}
	}
	for name, c := range map[string]struct {
		id   string
		want bool
	}{
		"acl owner": {tn.aclOwner.ID, true}, "direct share outside the workspace": {tn.outsider.ID, true},
		"organization admin": {tn.orgAdmin.ID, false}, "organization owner": {tn.owner.ID, false},
		"workspace admin": {tn.wsAdmin.ID, false}, "plain member": {tn.member.ID, false},
	} {
		got, ok := canView[c.id]
		if !ok {
			t.Errorf("%s is missing from the no_access pool", name)
		} else if got != c.want {
			t.Errorf("%s can_view = %v, want %v", name, got, c.want)
		}
	}
	for name, id := range map[string]string{"deactivated member": tn.deact.ID, "member of another workspace": tn.bMember.ID} {
		if _, ok := canView[id]; ok {
			t.Errorf("%s is offered by the pool", name)
		}
	}

	// A live break-glass grant flips the admin to a reader.
	f.breakGlass(t, tn, doc.ID, doc.WorkspaceID, tn.wsAdmin.ID, time.Hour)
	rows, _ = f.svc.MentionCandidates(f.ctx, acl, doc.ID, MentionCandidateQuery{IncludeNoAccess: true})
	for _, r := range rows {
		if r.UserID == tn.wsAdmin.ID && !*r.CanView {
			t.Error("a break-glass holder is not can_view")
		}
	}

	// limit cuts after the ordering: the 1-row page is a reader, never a non-reader.
	one, err := f.svc.MentionCandidates(f.ctx, acl, doc.ID, noAccessQuery(1))
	if err != nil || len(one) != 1 || one[0].CanView == nil || !*one[0].CanView {
		t.Fatalf("limit 1 = %v, %v; want one readable row", one, err)
	}
	// The search term still applies.
	byName, err := f.svc.MentionCandidates(f.ctx, acl, doc.ID, MentionCandidateQuery{IncludeNoAccess: true, Query: "plain-none"})
	if err != nil || len(byName) != 0 {
		t.Fatalf("a term nobody carries = %v, %v", byName, err)
	}
}

// The flag is honoured only for a caller who may list the workspace's
// members: a share reader from outside gets the old readers-only shape (no
// can_view), never a hint of who else is in the workspace.
func TestMentionCandidatesIncludeNoAccessNeedsMemberList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnig")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)

	rows, err := f.svc.MentionCandidates(f.ctx, Human(tn.outsider.ID), doc.ID, MentionCandidateQuery{IncludeNoAccess: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("the share reader got an empty picker")
	}
	for _, r := range rows {
		if r.CanView != nil {
			t.Errorf("row %s has can_view for a caller who may not list members", r.UserID)
		}
	}
	// Without the flag nothing changes for a member either.
	plain, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, MentionCandidateQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range plain {
		if r.CanView != nil {
			t.Errorf("row %s has can_view without include=no_access", r.UserID)
		}
	}
}

// A Work Product document: the workspace's members split by what the owner
// resolver grants, readers first, can_view marked on both sides.
func TestMentionCandidatesIncludeNoAccessOwnedDocument(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mnwp")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "01J8X4WPR0N1P2Q3R4S5T6U7V8"})
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelView, tn.aclOwner.ID: DocumentLevelView})

	rows, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, MentionCandidateQuery{IncludeNoAccess: true})
	if err != nil {
		t.Fatal(err)
	}
	canView := map[string]bool{}
	for i, r := range rows {
		if r.CanView == nil {
			t.Fatalf("row %s carries no can_view", r.UserID)
		}
		canView[r.UserID] = *r.CanView
		if i >= 2 && *r.CanView {
			t.Errorf("reader %s sits after the non-readers", r.UserID)
		}
	}
	if !canView[tn.member.ID] || !canView[tn.aclOwner.ID] {
		t.Errorf("the granted members are not can_view: %v", canView)
	}
	if v, ok := canView[tn.wsAdmin.ID]; !ok || v {
		t.Errorf("the ungranted workspace admin = %v/%v, want listed with can_view=false", v, ok)
	}
	if _, ok := canView[tn.deact.ID]; ok {
		t.Error("a deactivated member is offered")
	}
	if len(rows) >= 2 && !(*rows[0].CanView && *rows[1].CanView) {
		t.Error("the two readers are not first")
	}
	one, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, noAccessQuery(1))
	if err != nil || len(one) != 1 || !*one[0].CanView {
		t.Fatalf("limit 1 on an owned document = %v, %v; want a reader", one, err)
	}
}
