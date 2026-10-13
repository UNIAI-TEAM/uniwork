package service

// G8-06 (UNI-1401): mention candidates per document. The candidate set is the
// people who hold at least view on the document today - effective workspace
// members, the ACL owner and the live shares - minus deactivated members; the
// email rides along only for a caller who may list the document workspace's
// members. The search folds accents, so "nguyen" finds "Nguyễn", and it
// matches the email as well as the display name.

import (
	"errors"
	"testing"
)

// mentionCandidatesOf runs the picker and keys the answer by user id, so a
// case reads as a set of people.
func mentionCandidatesOf(t *testing.T, f *docPermFixture, actor Actor, docID string, in MentionCandidateQuery) map[string]MentionCandidate {
	t.Helper()
	rows, err := f.svc.MentionCandidates(f.ctx, actor, docID, in)
	if err != nil {
		t.Fatalf("MentionCandidates: %v", err)
	}
	out := make(map[string]MentionCandidate, len(rows))
	for _, c := range rows {
		out[c.UserID] = c
	}
	return out
}

// The list is the document's readers: every effective workspace member of a
// workspace-visible document, plus the implicit admins, minus people who
// cannot read it and people the organization deactivated.
func TestDocumentMentionCandidatesReaders(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "menr1")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	got := mentionCandidatesOf(t, f, Human(tn.member.ID), doc.ID, MentionCandidateQuery{})

	// The plain member asks and sees every reader, including the implicit
	// organization admins who hold manage without a workspace row.
	for name, id := range map[string]string{
		"organization owner": tn.owner.ID, "organization admin": tn.orgAdmin.ID,
		"workspace admin": tn.wsAdmin.ID, "acl owner": tn.aclOwner.ID,
		"creator": tn.creator.ID, "member": tn.member.ID,
	} {
		if _, ok := got[id]; !ok {
			t.Errorf("%s is a reader of the document and is missing from the candidates", name)
		}
	}
	for name, id := range map[string]string{
		"organization member outside the workspace": tn.outsider.ID,
		"member of another workspace":               tn.bMember.ID,
		"deactivated member":                        tn.deact.ID,
	} {
		if _, ok := got[id]; ok {
			t.Errorf("%s holds no view on the document yet is listed", name)
		}
	}

	// A caller who may list the workspace's members sees the emails.
	for _, c := range got {
		if c.Email == "" {
			t.Errorf("candidate %s has no email for a workspace member", c.UserID)
		}
	}
}

// A caller outside the organization is refused like every other document
// read: not found, never a hint that the document exists.
func TestDocumentMentionCandidatesRefuseOutsiders(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "menr2")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	stranger := f.user(t, "menr2", "stranger")

	if _, err := f.svc.MentionCandidates(f.ctx, Human(stranger.ID), doc.ID, MentionCandidateQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("caller in no organization = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.MentionCandidates(f.ctx, Human(tn.bMember.ID), doc.ID, MentionCandidateQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("organization member outside the workspace = %v, want ErrNotFound", err)
	}
}

// The search folds accents on both sides ("nguyen" finds "Nguyễn") and covers
// the email column as well as the display name.
func TestDocumentMentionCandidatesSearch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mens1")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	an := registerVerified(t, f.q, f.as, "men-an@example.com", "Nguyễn Văn An")
	f.orgMember(t, tn.orgID, an.ID, OrgRoleMember)
	f.wsMember(t, tn.wsA, an.ID, "member")
	hang := registerVerified(t, f.q, f.as, "hang.le@example.com", "Chị Hằng")
	f.orgMember(t, tn.orgID, hang.ID, OrgRoleMember)
	f.wsMember(t, tn.wsA, hang.ID, "member")

	member := Human(tn.member.ID)
	byName := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{Query: "nguyen"})
	if _, ok := byName[an.ID]; !ok {
		t.Error(`q="nguyen" does not match "Nguyễn Văn An"`)
	}
	if _, ok := byName[hang.ID]; ok {
		t.Error(`q="nguyen" matched someone who does not carry it`)
	}
	if folded := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{Query: "nguyen van an"}); len(folded) != 1 {
		t.Errorf(`q="nguyen van an" returned %d rows, want exactly the folded name`, len(folded))
	}

	// The email is searched too, and only the email separates Hằng from the
	// term: her display name folds to "chi hang", which has no dot.
	byEmail := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{Query: "hang.le"})
	if _, ok := byEmail[hang.ID]; !ok {
		t.Error(`q="hang.le" does not match the email hang.le@example.com`)
	}
	if _, ok := byEmail[an.ID]; ok {
		t.Error(`q="hang.le" matched someone without it`)
	}

	if none := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{Query: "khong-co-ai"}); len(none) != 0 {
		t.Errorf("a term nobody carries returned %d rows", len(none))
	}
}

// A direct-share reader from another workspace is a candidate; the reader
// themselves gets the list without emails, because they may not list the
// document workspace's members.
func TestDocumentMentionCandidatesShareReaderSeesNoEmail(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mensh")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	if _, ok := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{})[tn.outsider.ID]; ok {
		t.Fatal("a person with no share and no workspace row is a candidate")
	}

	f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.aclOwner.ID)

	if _, ok := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{})[tn.outsider.ID]; !ok {
		t.Fatal("the direct-share reader is missing from the candidates")
	}

	rows, err := f.svc.MentionCandidates(f.ctx, Human(tn.outsider.ID), doc.ID, MentionCandidateQuery{})
	if err != nil {
		t.Fatalf("share reader: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("the share reader got an empty picker")
	}
	for _, c := range rows {
		if c.Email != "" {
			t.Errorf("the share reader sees %s's email", c.UserID)
		}
	}
	// The recipient answers all three share principals the same way: the
	// workspace gate is what decides, not which share brought them in.
	f.share(t, doc, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
	if _, ok := mentionCandidatesOf(t, f, Human(tn.bMember.ID), doc.ID, MentionCandidateQuery{})[tn.member.ID]; !ok {
		t.Error("a workspace share does not bring the other workspace's members in")
	}
}

// A restricted document has no member leg: only the ACL owner, the implicit
// admins and the live shares hold view, and the list says exactly that.
func TestDocumentMentionCandidatesRestrictedDocument(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "menrs")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	got := mentionCandidatesOf(t, f, Human(tn.aclOwner.ID), doc.ID, MentionCandidateQuery{})
	for name, id := range map[string]string{
		"organization owner": tn.owner.ID, "organization admin": tn.orgAdmin.ID,
		"workspace admin": tn.wsAdmin.ID, "acl owner": tn.aclOwner.ID,
	} {
		if _, ok := got[id]; !ok {
			t.Errorf("%s holds view on the restricted document and is missing", name)
		}
	}
	for name, id := range map[string]string{
		"plain workspace member": tn.member.ID, "creator": tn.creator.ID,
		"member of another workspace": tn.bMember.ID, "deactivated member": tn.deact.ID,
	} {
		if _, ok := got[id]; ok {
			t.Errorf("%s holds no view on the restricted document yet is listed", name)
		}
	}

	// The plain member cannot even ask: the document gate answers not found.
	if _, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, MentionCandidateQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member on a restricted document = %v, want ErrNotFound", err)
	}

	// Shared, they are a candidate and may ask.
	f.share(t, doc, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	if _, ok := mentionCandidatesOf(t, f, Human(tn.aclOwner.ID), doc.ID, MentionCandidateQuery{})[tn.member.ID]; !ok {
		t.Error("the shared member is missing from the candidates")
	}
	if _, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, MentionCandidateQuery{}); err != nil {
		t.Fatalf("shared member: %v", err)
	}
}

// The page size clamps: <= 0 is the default 20, more than 50 is 50.
func TestDocumentMentionCandidateLimits(t *testing.T) {
	for _, c := range []struct{ in, want int }{
		{0, defaultMentionCandidateLimit}, {-3, defaultMentionCandidateLimit},
		{1, 1}, {19, 19}, {20, 20}, {50, maxMentionCandidateLimit}, {51, maxMentionCandidateLimit}, {999, maxMentionCandidateLimit},
	} {
		if got := mentionCandidateLimit(c.in); got != c.want {
			t.Errorf("mentionCandidateLimit(%d) = %d, want %d", c.in, got, c.want)
		}
	}

	f := newDocPermFixture(t)
	tn := f.tenant(t, "menli")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	one, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{Limit: 1})
	if err != nil || len(one) != 1 {
		t.Fatalf("limit 1 = %d rows, %v", len(one), err)
	}
	// The default page covers the tenant's readers, and the answer is the
	// same set a huge limit asks for (the cap only bites past 50 rows).
	def, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{})
	if err != nil {
		t.Fatal(err)
	}
	capped, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{Limit: 1000})
	if err != nil || len(capped) != len(def) {
		t.Fatalf("cap 50 changed a %d-row answer to %d rows, %v", len(def), len(capped), err)
	}
}

// An owned document's level comes from its owning product, not from
// membership or shares, so the picker names nobody rather than offering
// people the owner service never granted.
func TestDocumentMentionCandidatesOwnedDocumentIsEmpty(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "meno")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "01J8X4WPR0N1P2Q3R4S5T6U7V8"})

	// The owner's resolver lets the caller read the document; the picker
	// still cannot name a set the resolver owns.
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{tn.member.ID: DocumentLevelView})
	rows, err := f.svc.MentionCandidates(f.ctx, Human(tn.member.ID), doc.ID, MentionCandidateQuery{})
	if err != nil {
		t.Fatalf("owned document: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("owned document offered %d candidates, want none", len(rows))
	}
}
