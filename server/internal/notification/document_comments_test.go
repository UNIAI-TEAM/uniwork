package notification

// G8-05 (UNI-1400): the UNI-1337 recipient table over the durable mention
// rows (contract-collab sections 8.1-8.3). A mention notifies only a user who
// can read the document at delivery time, through the row the service wrote
// and exactly one claim; a reply reaches the parent's author, a resolve the
// resolved comment's author; a new comment or thread without a mention
// notifies nobody (document_commented is no longer emitted, its kind stays
// registered for rows written before this change).

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

// addMember registers a person and joins them to the fixture organization and
// workspace.
func (f *documentFixture) addMember(t *testing.T, email, name string) db.User {
	t.Helper()
	u := f.user(t, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	return u
}

// commentOf is a create with an explicit thread kind; an empty kind defaults
// to a discussion like the API.
func (f *documentFixture) commentOf(t *testing.T, actorID, docID, body, kind string) db.DocumentComment {
	t.Helper()
	c, err := f.docs.AddDocumentComment(f.ctx, service.Human(actorID), docID, service.AddCommentInput{Body: body, CommentType: kind}, "")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (f *documentFixture) comment(t *testing.T, actorID, docID, body string) db.DocumentComment {
	t.Helper()
	return f.commentOf(t, actorID, docID, body, "")
}

func (f *documentFixture) reply(t *testing.T, actorID, docID, parentID, body string) db.DocumentComment {
	t.Helper()
	c, err := f.docs.AddDocumentComment(f.ctx, service.Human(actorID), docID, service.AddCommentInput{Body: body, ParentID: &parentID}, "")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (f *documentFixture) edit(t *testing.T, actorID, commentID, body string) db.DocumentComment {
	t.Helper()
	c, err := f.docs.UpdateDocumentComment(f.ctx, service.Human(actorID), commentID, service.UpdateCommentInput{Body: body})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (f *documentFixture) resolve(t *testing.T, actorID, commentID string) db.DocumentComment {
	t.Helper()
	c, err := f.docs.ResolveDocumentComment(f.ctx, service.Human(actorID), commentID)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// handleAll delivers every committed outbox row of a topic, oldest first, so
// a test can drive repeated edits through the consumer in one pass.
func (f *documentFixture) handleAll(t *testing.T, topic string) {
	t.Helper()
	for _, ev := range f.events(t, topic) {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
}

// handleComment delivers the newest document.comment_added row.
func (f *documentFixture) handleComment(t *testing.T) {
	t.Helper()
	f.handleLast(t, "document.comment_added")
}

// mentionState reads one durable mention row of a comment.
func (f *documentFixture) mentionState(t *testing.T, commentID, userID string) (string, pgtype.Timestamptz) {
	t.Helper()
	var state string
	var notified pgtype.Timestamptz
	if err := f.pool.QueryRow(f.ctx,
		`SELECT state, notified_at FROM document_comment_mentions WHERE comment_id = $1 AND user_id = $2`,
		commentID, userID).Scan(&state, &notified); err != nil {
		t.Fatal(err)
	}
	return state, notified
}

// inboxKinds lists a user's notification kinds, oldest first.
func (f *documentFixture) inboxKinds(t *testing.T, userID string) []string {
	t.Helper()
	var out []string
	for _, n := range f.inbox(t, userID) {
		out = append(out, n.Kind)
	}
	return out
}

func mentionOf(u db.User) string {
	return fmt.Sprintf("[@%s](mention://member/%s)", u.DisplayName, u.ID)
}

// A mention in a Comment lands as document_mentioned with the row claimed;
// the actor is skipped; a repeat Handle dedups on the delivery row.
func TestDocumentCommentMentionNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Kế hoạch Q4")

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" nhìn giúp", "comment")
	f.handleComment(t)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentMentioned || got[0].TitleKey != "notifications.kind.document_mentioned" {
		t.Fatalf("member inbox = %+v", got)
	}
	if !contains(got[0].Params, "Kế hoạch Q4") || !contains(got[0].Params, created.ID) {
		t.Fatalf("params missing document/comment id: %s", got[0].Params)
	}
	if state, notified := f.mentionState(t, created.ID, f.member.ID); state != "active" || !notified.Valid {
		t.Fatalf("mention row = %s/%v, want claimed active", state, notified)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the actor was notified of their own comment")
	}
	f.handleComment(t)
	if n := f.inbox(t, f.member.ID); len(n) != 1 {
		t.Fatalf("redelivery duplicated the mention: %d rows", len(n))
	}
}

// A mention in a Discussion is its own kind.
func TestDocumentDiscussionMentionNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Trao đổi")

	f.comment(t, f.owner.ID, docID, mentionOf(f.member)+" thảo luận nhé")
	f.handleComment(t)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentDiscussionMentioned || got[0].TitleKey != "notifications.kind.document_discussion_mentioned" {
		t.Fatalf("member inbox = %+v", got)
	}
}

// A new comment or thread without a mention notifies nobody: the old
// document_commented row for the ACL owner and earlier commenters is gone.
func TestDocumentCommentWithoutMentionNotifiesNobody(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Không nhắc")

	f.commentOf(t, f.member.ID, docID, "đã đọc xong", "comment")
	f.handleAll(t, "document.comment_added")
	f.commentOf(t, f.member.ID, docID, "bình luận thứ hai", "comment")
	f.handleAll(t, "document.comment_added")

	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("owner inbox = %+v, want nothing", n)
	}
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("author inbox = %+v, want nothing", n)
	}
}

// A reply in a Comment notifies the parent's author; the actor never hears
// their own reply.
func TestDocumentCommentReplyNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Phản hồi")

	root := f.commentOf(t, f.owner.ID, docID, "gốc", "comment")
	f.reply(t, f.member.ID, docID, root.ID, "trả lời của thành viên")
	f.handleLast(t, "document.comment_added")

	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentCommentReplied || got[0].TitleKey != "notifications.kind.document_comment_replied" {
		t.Fatalf("owner inbox = %+v", got)
	}
	if len(f.inbox(t, f.member.ID)) != 0 {
		t.Fatal("the replying actor was notified")
	}

	// Replying to your own comment notifies nobody.
	f.reply(t, f.owner.ID, docID, root.ID, "tự trả lời")
	f.handleLast(t, "document.comment_added")
	if n := f.inbox(t, f.owner.ID); len(n) != 1 {
		t.Fatalf("self reply added a row: %+v", n)
	}
}

// A reply in a Discussion carries the discussion kind.
func TestDocumentDiscussionReplyNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Thảo luận chung")

	root := f.comment(t, f.owner.ID, docID, "gốc thảo luận")
	f.reply(t, f.member.ID, docID, root.ID, "trả lời trong thảo luận")
	f.handleLast(t, "document.comment_added")

	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentDiscussionReplied || got[0].TitleKey != "notifications.kind.document_discussion_replied" {
		t.Fatalf("owner inbox = %+v", got)
	}
}

// Reply and mention to the same person is one mention notification: the
// priority is mention > reply (G8-D4).
func TestDocumentCommentReplyMentionPriority(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Ưu tiên")

	root := f.commentOf(t, f.owner.ID, docID, "gốc", "comment")
	f.reply(t, f.member.ID, docID, root.ID, mentionOf(f.owner)+" xem phần 2")
	f.handleLast(t, "document.comment_added")

	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentMentioned {
		t.Fatalf("owner inbox = %+v, want one document_mentioned", got)
	}
}

// Resolving a Comment notifies its author; resolving your own comment or a
// Discussion notifies nobody.
func TestDocumentCommentResolveNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Giải quyết")

	// The author here is the member; the owner resolves it.
	root := f.commentOf(t, f.member.ID, docID, "cần xử lý", "comment")
	f.resolve(t, f.owner.ID, root.ID)
	f.handleLast(t, "document.comment_resolved")

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentCommentResolved || got[0].TitleKey != "notifications.kind.document_comment_resolved" {
		t.Fatalf("member inbox = %+v", got)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the resolving actor was notified")
	}

	// Self-resolve: silent.
	own := f.commentOf(t, f.member.ID, docID, "tự xử lý", "comment")
	f.resolve(t, f.member.ID, own.ID)
	f.handleLast(t, "document.comment_resolved")
	if n := f.inbox(t, f.member.ID); len(n) != 1 {
		t.Fatalf("self resolve added a row: %+v", n)
	}

	// A Discussion resolve has no notification row in the table.
	disc := f.comment(t, f.member.ID, docID, "thảo luận")
	f.resolve(t, f.owner.ID, disc.ID)
	f.handleLast(t, "document.comment_resolved")
	if n := f.inbox(t, f.member.ID); len(n) != 1 {
		t.Fatalf("discussion resolve added a row: %+v", n)
	}
}

// The edit table of UNI-1336: keeping a mention adds nothing (twice, before
// the consumer runs, still one), adding a name notifies only the new one,
// dropping a name keeps the old notification, re-adding it never notifies
// again, and clearing a body removes every row.
func TestDocumentCommentMentionEditFlow(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Sửa bình luận")
	other := f.addMember(t, "other@example.com", "Người Khác")

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "discussion")
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" xem lại lần một")
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" xem lại lần hai")
	f.handleAll(t, "document.comment_added")
	f.handleAll(t, "document.comment_updated")

	if got := f.inboxKinds(t, f.member.ID); len(got) != 1 || got[0] != KindDocumentDiscussionMentioned {
		t.Fatalf("member inbox after kept edits = %v, want one discussion mention", got)
	}

	// Adding a second name notifies only that name.
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" và "+mentionOf(other)+" cùng xem")
	f.handleAll(t, "document.comment_updated")
	if got := f.inboxKinds(t, f.member.ID); len(got) != 1 {
		t.Fatalf("kept name notified again: %v", got)
	}
	if got := f.inboxKinds(t, other.ID); len(got) != 1 || got[0] != KindDocumentDiscussionMentioned {
		t.Fatalf("other inbox = %v, want one discussion mention", got)
	}

	// Dropping a name marks the row removed; the old notification stays.
	f.edit(t, f.owner.ID, created.ID, mentionOf(other)+" chỉ còn người này")
	f.handleAll(t, "document.comment_updated")
	if state, _ := f.mentionState(t, created.ID, f.member.ID); state != "removed" {
		t.Fatalf("dropped row state = %s, want removed", state)
	}
	if got := f.inboxKinds(t, f.member.ID); len(got) != 1 {
		t.Fatalf("dropped name lost its old notification: %v", got)
	}

	// Re-adding it turns the row active again with notified_at kept: still
	// exactly one notification for the person.
	f.edit(t, f.owner.ID, created.ID, mentionOf(other)+" và "+mentionOf(f.member)+" quay lại")
	f.handleAll(t, "document.comment_updated")
	if state, notified := f.mentionState(t, created.ID, f.member.ID); state != "active" || !notified.Valid {
		t.Fatalf("re-added row = %s/%v, want active with notified_at kept", state, notified)
	}
	if got := f.inboxKinds(t, f.member.ID); len(got) != 1 {
		t.Fatalf("re-added name was notified again: %v", got)
	}
}

// The same person named twice in one body is one row and one notification.
func TestDocumentCommentMentionDuplicateNames(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Nhắc hai lần")

	f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" và "+mentionOf(f.member)+" lần nữa", "discussion")
	f.handleComment(t)

	if got := f.inboxKinds(t, f.member.ID); len(got) != 1 {
		t.Fatalf("member inbox = %v, want one", got)
	}
}

// A self-mention is stored but never notified.
func TestDocumentCommentMentionSelfSkipped(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Tự nhắc")

	created := f.commentOf(t, f.member.ID, docID, mentionOf(f.member)+" ghi chú cho tôi", "comment")
	f.handleComment(t)

	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("self mention notified: %+v", n)
	}
	if state, notified := f.mentionState(t, created.ID, f.member.ID); state != "active" || notified.Valid {
		t.Fatalf("self mention row = %s/%v, want stored active unclaimed", state, notified)
	}
}

// A mention to a user who cannot read the document - org member, no share -
// is stored no_access (G8-D3 provisional) and notifies nobody.
func TestDocumentCommentMentionNeedsRead(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Mật")
	outsider := f.user(t, "outsider2@example.com", "Người Ngoài")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: outsider.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(outsider)+" không được đọc", "discussion")
	f.handleComment(t)
	if n := f.inbox(t, outsider.ID); len(n) != 0 {
		t.Fatalf("unreadable mention notified: %+v", n)
	}
	if state, _ := f.mentionState(t, created.ID, outsider.ID); state != "no_access" {
		t.Fatalf("row state = %s, want no_access", state)
	}
}

// A deactivated member is not a reader: no notification, no claim.
func TestDocumentCommentMentionDeactivated(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Đã vô hiệu")
	gone := f.addMember(t, "gone@example.com", "Đã Nghỉ")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		f.orgID, gone.ID); err != nil {
		t.Fatal(err)
	}

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(gone)+" ơi", "discussion")
	f.handleComment(t)
	if n := f.inbox(t, gone.ID); len(n) != 0 {
		t.Fatalf("deactivated member notified: %+v", n)
	}
	if state, _ := f.mentionState(t, created.ID, gone.ID); state != "no_access" {
		t.Fatalf("row state = %s, want no_access", state)
	}
}

// A direct-share reader in another workspace gets the mention while the
// share holds; a share revoked before delivery stores nothing.
func TestDocumentCommentMentionDirectShare(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Chia sẻ trực tiếp")

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
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsB.Workspace.ID, OrganizationID: wsB.Workspace.OrganizationID, UserID: outsider.ID, Role: "member"}); err != nil {
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

	f.commentOf(t, f.owner.ID, docID, mentionOf(outsider)+" cùng xem", "discussion")
	f.handleComment(t)
	got := f.inbox(t, outsider.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentDiscussionMentioned {
		t.Fatalf("direct-share reader inbox = %+v", got)
	}

	// Revoke before the next delivery: no row, no claim.
	second := f.commentOf(t, f.owner.ID, docID, mentionOf(outsider)+" bí mật", "discussion")
	if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
		ID: share.ID, OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		RevokedBy: pgtype.Text{String: f.owner.ID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	f.handleAll(t, "document.comment_added")
	if n := f.inbox(t, outsider.ID); len(n) != 1 {
		t.Fatalf("revoked reader got another notification: %+v", n)
	}
	if _, notified := f.mentionState(t, second.ID, outsider.ID); notified.Valid {
		t.Fatal("revoked reader's row was claimed")
	}
}

// The snippet param is bounded at snippetRunes so a long body cannot swell
// the notification row; the params carry the ids and the kind.
func TestDocumentCommentSnippetBound(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Dài")

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" "+repeat("đ", 500), "discussion")
	f.handleComment(t)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 {
		t.Fatalf("member inbox = %d rows", len(got))
	}
	if len(got[0].Params) > 400 || !contains(got[0].Params, "…") {
		t.Fatalf("snippet not bounded: %s", got[0].Params)
	}
	if !contains(got[0].Params, created.ID) || !contains(got[0].Params, `"kind":"discussion"`) {
		t.Fatalf("params missing comment_id/kind: %s", got[0].Params)
	}
}
