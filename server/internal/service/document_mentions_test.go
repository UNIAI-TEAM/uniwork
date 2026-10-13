package service

// G8-06 (UNI-1401): mention candidates per document. The candidate set is the
// people who hold at least view on the document today - effective workspace
// members, the ACL owner and the live shares - minus deactivated members; the
// email rides along only for a caller who may list the document workspace's
// members, and the same gate decides whether the search may match an email.
// The search folds accents, so "nguyen" finds "Nguyễn".

import (
	"bytes"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// mentionPNG sniffs as image/png - http.DetectContentType reads the magic
// bytes - so the avatar purpose's allowlist accepts it.
var mentionPNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)

// mentionLimit builds the pointer an explicit limit travels as; nil is "no
// limit asked for".
func mentionLimit(n int) *int { return &n }

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

	// The organization principal is the whole tenant: an organization member
	// with no workspace row and no user share becomes a candidate through it.
	f.share(t, doc, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	if _, ok := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{})[tn.outsider.ID]; !ok {
		t.Error("an organization share does not bring the organization's members in")
	}

	// A caller who may not see addresses must not be able to confirm one
	// through q: the email leg is gated like the email field itself, so the
	// share reader finds nobody by the member's address while a workspace
	// member finds them.
	address := "mensh-member@example.com"
	if got := mentionCandidatesOf(t, f, Human(tn.outsider.ID), doc.ID, MentionCandidateQuery{Query: address}); len(got) != 0 {
		t.Errorf("the share reader confirmed an address through q: %v", got)
	}
	if _, ok := mentionCandidatesOf(t, f, member, doc.ID, MentionCandidateQuery{Query: address})[tn.member.ID]; !ok {
		t.Error("a workspace member can no longer search by email")
	}
}

// A workspace-principal share only covers the document's own organization: a
// stale or hand-written row naming a workspace of another tenant does not
// bring that workspace's members in, exactly like the level rule refuses it
// (document_permissions.go:176 re-checks workspaceInOrganization).
func TestDocumentMentionCandidatesForeignWorkspaceShare(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "menfw")
	foreign := f.tenant(t, "menfx")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	// The member belongs to the document's organization AND to the foreign
	// workspace, so only the tenant re-check can keep them out.
	f.orgMember(t, foreign.orgID, tn.member.ID, OrgRoleMember)
	f.wsMember(t, foreign.wsA, tn.member.ID, "member")
	f.share(t, doc, DocumentPrincipalWorkspace, foreign.wsA, DocumentLevelView, tn.aclOwner.ID)

	if _, ok := mentionCandidatesOf(t, f, Human(tn.aclOwner.ID), doc.ID, MentionCandidateQuery{})[tn.member.ID]; ok {
		t.Error("a workspace share of another organization brought its member in")
	}
}

// A candidate whose photo lives in FileService carries the resolved avatar
// URL, exactly as GET /workspaces/{id}/members shows it.
func TestDocumentMentionCandidatesResolveFileBackedAvatar(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "menav")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	fake := filesfake.New(filesfake.Options{})
	f.svc.SetFiles(fake)
	up, err := fake.Upload(f.ctx, files.UploadInput{
		Actor: Human(tn.member.ID), Purpose: files.UserAvatar,
		Scope:          files.Scope{UserID: tn.member.ID},
		IdempotencyKey: "mention-avatar", Filename: "me.png", Body: bytes.NewReader(mentionPNG),
	})
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	if _, err := f.q.UpdateUserAvatarFile(f.ctx, db.UpdateUserAvatarFileParams{
		ID: tn.member.ID, AvatarFileID: pgtype.Text{String: string(up.File.ID), Valid: true},
	}); err != nil {
		t.Fatalf("attach avatar: %v", err)
	}

	got := mentionCandidatesOf(t, f, Human(tn.aclOwner.ID), doc.ID, MentionCandidateQuery{})
	member, ok := got[tn.member.ID]
	if !ok {
		t.Fatal("the member is missing from the candidates")
	}
	if want := "fake://presign/" + string(up.File.ID); member.AvatarURL != want {
		t.Errorf("avatar_url = %q, want the resolved file URL %q", member.AvatarURL, want)
	}
	if !strings.HasPrefix(member.AvatarURL, "fake://") {
		t.Errorf("avatar_url = %q, want a resolved URL rather than the stored column", member.AvatarURL)
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

// The page size clamps into [1, 50]: no limit is the default 20, and an
// explicit 0 or negative is the floor 1 (contract 2.8).
func TestDocumentMentionCandidateLimits(t *testing.T) {
	for _, c := range []struct {
		in   *int
		want int
	}{
		{nil, defaultMentionCandidateLimit},
		{mentionLimit(0), minMentionCandidateLimit}, {mentionLimit(-3), minMentionCandidateLimit},
		{mentionLimit(1), 1}, {mentionLimit(19), 19}, {mentionLimit(20), 20},
		{mentionLimit(50), maxMentionCandidateLimit}, {mentionLimit(51), maxMentionCandidateLimit}, {mentionLimit(999), maxMentionCandidateLimit},
	} {
		if got := mentionCandidateLimit(c.in); got != c.want {
			in := "nil"
			if c.in != nil {
				in = strconv.Itoa(*c.in)
			}
			t.Errorf("mentionCandidateLimit(%s) = %d, want %d", in, got, c.want)
		}
	}

	f := newDocPermFixture(t)
	tn := f.tenant(t, "menli")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	one, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{Limit: mentionLimit(1)})
	if err != nil || len(one) != 1 {
		t.Fatalf("limit 1 = %d rows, %v", len(one), err)
	}
	// An explicit 0 is the floor, not the default page.
	floor, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{Limit: mentionLimit(0)})
	if err != nil || len(floor) != 1 {
		t.Fatalf("limit 0 = %d rows, %v; want the floor 1", len(floor), err)
	}
	// The default page covers the tenant's readers, and the answer is the
	// same set a huge limit asks for (the cap only bites past 50 rows).
	def, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{})
	if err != nil {
		t.Fatal(err)
	}
	capped, err := f.svc.MentionCandidates(f.ctx, member, doc.ID, MentionCandidateQuery{Limit: mentionLimit(1000)})
	if err != nil || len(capped) != len(def) {
		t.Fatalf("cap 50 changed a %d-row answer to %d rows, %v", len(def), len(capped), err)
	}
}

// An owned document's level comes from its owning product, so the picker
// answers the workspace's members the owner resolver actually grants: a
// granted reader is listed, and a member the resolver never granted is not.
func TestDocumentMentionCandidatesOwnedDocumentReaders(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "meno")
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", createdBy: tn.aclOwner.ID, ownerID: "01J8X4WPR0N1P2Q3R4S5T6U7V8"})

	// The owner's resolver grants the member and the ACL owner view; the
	// workspace admin, the creator and the organization admin hold no
	// delegation path, so the read-time gate drops them.
	f.svc.SetOwnerLevelResolver(mapOwnerResolver{
		tn.member.ID: DocumentLevelView, tn.aclOwner.ID: DocumentLevelView,
	})

	got := mentionCandidatesOf(t, f, Human(tn.member.ID), doc.ID, MentionCandidateQuery{})
	for name, id := range map[string]string{
		"the granted member": tn.member.ID, "the granted ACL owner": tn.aclOwner.ID,
	} {
		if _, ok := got[id]; !ok {
			t.Errorf("%s reads the owned document and is missing from the candidates", name)
		}
	}
	for name, id := range map[string]string{
		"a workspace admin the resolver never granted":     tn.wsAdmin.ID,
		"the creator the resolver never granted":           tn.creator.ID,
		"an organization admin the resolver never granted": tn.orgAdmin.ID,
		"a deactivated member":                             tn.deact.ID,
	} {
		if _, ok := got[id]; ok {
			t.Errorf("%s cannot read the owned document yet is listed", name)
		}
	}
}
