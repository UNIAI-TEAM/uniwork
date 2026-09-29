package notification

// UNI-681 (G1-07a): document.comment_added rules. A mention notifies only a
// user who can read the document at delivery time; earlier commenters and
// the ACL owner get a commented draft. Every candidate goes through the
// injected FilterDocumentReaders, so a revoke between the comment and this
// run stores no row and no snippet; a direct-share recipient in another
// workspace is still reached while the share holds.

import (
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// documentFixture adds the real DocumentService - the production
// DocumentReadChecker - to the shared fixture; comments go through
// AddDocumentComment so the outbox row under test is the production event.
type documentFixture struct {
	*fixture
	docs *service.DocumentService
	auth *service.AuthService
}

func newDocumentFixture(t *testing.T) *documentFixture {
	t.Helper()
	f := newFixture(t)
	minter := authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	auth := service.NewAuthService(f.pool, f.q, minter, time.Hour, nil)
	orgs := service.NewOrganizationService(f.pool, f.q)
	docs := service.NewDocumentService(f.pool, f.q, orgs, f.ws)
	docs.SetEntitlements(service.NewEntitlementService(f.pool, f.q))
	f.consumer.SetDocumentReaders(docs)
	return &documentFixture{fixture: f, docs: docs, auth: auth}
}

// document inserts a minimal row: page kind, the fixture workspace, the
// fixture owner as ACL owner.
func (f *documentFixture) document(t *testing.T, visibility, title string) string {
	t.Helper()
	id := util.NewID()
	_, err := f.pool.Exec(f.ctx,
		`INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility, acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
		 VALUES ($1,$2,$3,'page',$4,$5,$6,$6,'human',$6,'human')`,
		id, f.orgID, f.wsID, title, visibility, f.owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (f *documentFixture) user(t *testing.T, email, name string) db.User {
	t.Helper()
	return f.register(t, f.auth, email, name)
}

func (f *documentFixture) comment(t *testing.T, actorID, docID, body string) db.DocumentComment {
	t.Helper()
	c, err := f.docs.AddDocumentComment(f.ctx, service.Human(actorID), docID, service.AddCommentInput{Body: body}, "")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (f *documentFixture) handleComment(t *testing.T) {
	t.Helper()
	f.handleLast(t, "document.comment_added")
}

func mentionOf(u db.User) string {
	return fmt.Sprintf("[@%s](mention://member/%s)", u.DisplayName, u.ID)
}

// A mention lands as document_mentioned; the actor is skipped and a repeat
// Handle dedups on the group key.
func TestDocumentCommentMentionNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Kế hoạch Q4")

	f.comment(t, f.owner.ID, docID, mentionOf(f.member)+" nhìn giúp")
	f.handleComment(t)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentMentioned || got[0].TitleKey != "notifications.kind.document_mentioned" {
		t.Fatalf("member inbox = %+v", got)
	}
	if !contains(got[0].Params, "Kế hoạch Q4") {
		t.Fatalf("params missing the document title: %s", got[0].Params)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the actor was notified of their own comment")
	}
	f.handleComment(t)
	if n := f.inbox(t, f.member.ID); len(n) != 1 {
		t.Fatalf("redelivery duplicated the mention: %d rows", len(n))
	}
}

// An earlier commenter and the ACL owner are the commented candidates; a
// mentioned user never also gets the generic row.
func TestDocumentCommentCommentedNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Báo cáo")

	// The member comments: the owner - ACL owner - is the one notified.
	f.comment(t, f.member.ID, docID, "đã đọc xong")
	f.handleComment(t)
	owner := f.inbox(t, f.owner.ID)
	if len(owner) != 1 || owner[0].Kind != KindDocumentCommented || owner[0].TitleKey != "notifications.kind.document_commented" {
		t.Fatalf("owner inbox = %+v", owner)
	}

	// The owner replies mentioning the member - a prior commenter. Mention
	// wins; no second document_commented row lands for the member.
	f.comment(t, f.owner.ID, docID, mentionOf(f.member)+" xem phần 2")
	f.handleComment(t)
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentMentioned {
		t.Fatalf("member inbox = %+v, want one document_mentioned", got)
	}
}

// A share revoked between the comment and the delivery stores nothing -
// the permission is re-checked at delivery, not at write time.
func TestDocumentCommentNotificationRevokeBeforeDelivery(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Mật")

	// outsider is an organization member in a different workspace only - the
	// direct user share is the one access path, which is exactly the case a
	// workspace-membership gate would miss.
	outsider := f.user(t, "outsider@example.com", "Người Ngoài")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: outsider.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	wsB, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "WS B", "ws-b")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsB.Workspace.ID, UserID: outsider.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}

	share := db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		PrincipalType: "user", PrincipalID: outsider.ID, Level: "view",
		GrantedBy: f.owner.ID, GrantedByKind: "human",
	}
	if _, err := f.q.InsertDocumentShare(f.ctx, share); err != nil {
		t.Fatal(err)
	}

	f.comment(t, f.owner.ID, docID, mentionOf(outsider)+" bí mật")
	// Revoke before the consumer runs: no row, no snippet.
	if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
		ID: share.ID, OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		RevokedBy: pgtype.Text{String: f.owner.ID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	f.handleComment(t)
	if n := f.inbox(t, outsider.ID); len(n) != 0 {
		t.Fatalf("revoked reader was notified: %+v", n)
	}
}

// A mention to a user who cannot read the document - org member, no share -
// is dropped by FilterDocumentReaders rather than leaking a snippet.
func TestDocumentCommentMentionNeedsRead(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Mật")
	outsider := f.user(t, "outsider2@example.com", "Người Ngoài")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: outsider.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}

	f.comment(t, f.owner.ID, docID, mentionOf(outsider)+" không được đọc")
	f.handleComment(t)
	if n := f.inbox(t, outsider.ID); len(n) != 0 {
		t.Fatalf("unreadable mention notified: %+v", n)
	}
}

// The snippet param is bounded at snippetRunes so a long body cannot swell
// the notification row.
func TestDocumentCommentSnippetBound(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Dài")
	f.comment(t, f.owner.ID, docID, mentionOf(f.member)+" "+repeat("đ", 500))
	f.handleComment(t)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 {
		t.Fatalf("member inbox = %d rows", len(got))
	}
	if len(got[0].Params) > 400 || !contains(got[0].Params, "…") {
		t.Fatalf("snippet not bounded: %s", got[0].Params)
	}
}
