package notification

// G8-05 (UNI-1400): the UNI-1337 recipient table over the durable mention
// rows (contract-collab sections 8.1-8.3). A mention notifies only a user who
// can read the document at delivery time, through the row the service wrote
// and exactly one claim; a reply reaches the parent's author, a resolve the
// resolved comment's author; a new comment or thread without a mention
// notifies nobody (document_commented is no longer emitted, its kind stays
// registered for rows written before this change).

import (
	"encoding/json"
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

// anchorMime is the mime the fixture document's one version snapshots: an
// xlsx file document. G8-04's OQ-C2 rule requires a root kind=comment to bind
// an anchor and a base_version_id, and only an office file document carries
// the format an anchor names, so the fixture document is anchorable and every
// comment-kind root below binds this anchor.
const anchorMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// anchorBody is the canonical xlsx anchor the comment-kind roots bind to.
const anchorBody = `{"format":"xlsx","v":1,"sheet":"S1","range":"B7"}`

// document inserts a minimal anchorable row: an xlsx file document with one
// version at head, the fixture workspace, the fixture owner as ACL owner. The
// file format is what lets a root kind=comment satisfy OQ-C2; a discussion
// never carries an anchor, so the same document hosts both thread kinds.
func (f *documentFixture) document(t *testing.T, visibility, title string) string {
	t.Helper()
	id := util.NewID()
	_, err := f.pool.Exec(f.ctx,
		`INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility, acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
		 VALUES ($1,$2,$3,'file',$4,$5,$6,$6,'human',$6,'human')`,
		id, f.orgID, f.wsID, title, visibility, f.owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	versionID := util.NewID()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_versions (id, organization_id, workspace_id, document_id, version, kind, reason, file_id, mime_type, created_by, created_by_kind)
		 VALUES ($1,$2,$3,$4,1,'file','upload',$5,$6,$7,'human')`,
		versionID, f.orgID, f.wsID, id, "01J8X4FILEN1P2Q3R4S5T6U7V8", anchorMime, f.owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE documents SET current_version = 1, file_version_id = $1 WHERE id = $2`, versionID, id); err != nil {
		t.Fatal(err)
	}
	return id
}

// anchorVersion is the head version an anchored create binds to.
func (f *documentFixture) anchorVersion(t *testing.T, docID string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx, `SELECT file_version_id FROM documents WHERE id = $1`, docID).Scan(&id); err != nil {
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
// to a discussion like the API. A comment-kind root binds the fixture anchor
// and its base version (OQ-C2): an anchorless root kind=comment is a 400, so
// the comment arm stays a comment without silently becoming a discussion.
func (f *documentFixture) commentOf(t *testing.T, actorID, docID, body, kind string) db.DocumentComment {
	t.Helper()
	in := service.AddCommentInput{Body: body, CommentType: kind}
	if kind == "comment" {
		in.Anchor = json.RawMessage(anchorBody)
		in.BaseVersionID = f.anchorVersion(t, docID)
	}
	c, err := f.docs.AddDocumentComment(f.ctx, service.Human(actorID), docID, in, "")
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

// sharedCommentAuthor registers a person whose only access to the restricted
// document is a direct edit share, and returns them with that share: the
// share is the one path, so revoking it takes document read away.
func (f *documentFixture) sharedCommentAuthor(t *testing.T, docID, email, name string) (db.User, db.InsertDocumentShareParams) {
	t.Helper()
	u := f.user(t, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	share := db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		PrincipalType: "user", PrincipalID: u.ID, Level: "edit",
		GrantedBy: f.owner.ID, GrantedByKind: "human",
	}
	if _, err := f.q.InsertDocumentShare(f.ctx, share); err != nil {
		t.Fatal(err)
	}
	return u, share
}

// revokeShare ends the one access path of a sharedCommentAuthor.
func (f *documentFixture) revokeShare(t *testing.T, share db.InsertDocumentShareParams, docID string) {
	t.Helper()
	if err := f.q.RevokeDocumentShare(f.ctx, db.RevokeDocumentShareParams{
		ID: share.ID, OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
		RevokedBy: pgtype.Text{String: f.owner.ID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
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

// A reply to a comment whose author lost read access notifies nobody: the
// reply arm re-checks document read at delivery time (R1-3). The author's
// only access path was a direct share, revoked before the consumer ran.
func TestDocumentCommentReplyRevokedReader(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Thu hồi phản hồi")
	author, share := f.sharedCommentAuthor(t, docID, "revoked-reply@example.com", "Người Bị Thu Hồi")

	root := f.commentOf(t, author.ID, docID, "gốc", "comment")
	f.revokeShare(t, share, docID)

	f.reply(t, f.owner.ID, docID, root.ID, "trả lời")
	f.handleLast(t, "document.comment_added")
	if n := f.inbox(t, author.ID); len(n) != 0 {
		t.Fatalf("revoked parent author got a reply notification: %+v", n)
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("the replying actor was notified: %+v", n)
	}
}

// Resolving a Comment whose author lost read access notifies nobody (R1-3):
// the resolve arm re-checks document read at delivery time.
func TestDocumentCommentResolveRevokedReader(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Thu hồi giải quyết")
	author, share := f.sharedCommentAuthor(t, docID, "revoked-resolve@example.com", "Người Bị Thu Hồi")

	root := f.commentOf(t, author.ID, docID, "cần xử lý", "comment")
	f.revokeShare(t, share, docID)

	f.resolve(t, f.owner.ID, root.ID)
	f.handleLast(t, "document.comment_resolved")
	if n := f.inbox(t, author.ID); len(n) != 0 {
		t.Fatalf("revoked resolved-comment author got a notification: %+v", n)
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("the resolving actor was notified: %+v", n)
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

// A self-mention never notifies its own author, whichever actor triggers the
// event (R1-7): another member's edit that keeps the token must not
// resurrect it. The row stays stored and unclaimed.
func TestDocumentCommentMentionSelfKeptOnAnothersEdit(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Tự nhắc giữ tên")

	created := f.commentOf(t, f.member.ID, docID, mentionOf(f.member)+" ghi chú cho tôi", "comment")
	f.handleComment(t)
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("self mention notified its author: %+v", n)
	}

	// The owner holds manage, so the edit is allowed; the event actor is no
	// longer the self-mentioner.
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" sửa nhưng giữ tên")
	f.handleAll(t, "document.comment_updated")
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("another member's edit resurrected the self-mention: %+v", n)
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

// --- G8-07 §1: the inbox list marks document rows -------------------------

// documentInboxItem lists one recipient's inbox through the real Service and
// returns the document row the notification names, so the flags the list
// resolves are the ones the HTTP layer would ship.
func (f *documentFixture) documentInboxItem(t *testing.T, svc *Service, userID, notificationID string) Item {
	t.Helper()
	items, err := svc.List(f.ctx, userID, ListInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items {
		if it.ID == notificationID {
			return it
		}
	}
	t.Fatalf("notification %s not in the list", notificationID)
	return Item{}
}

// A readable document keeps its snippet and raises no flag; the params still
// carry the comment id and the thread kind (contract-G807 §1).
func TestServiceDocumentInboxReadableKeepsSnippet(t *testing.T) {
	f := newDocumentFixture(t)
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	docID := f.document(t, "workspace", "Kế hoạch")

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")
	f.handleComment(t)
	n := f.inbox(t, f.member.ID)[0]

	it := f.documentInboxItem(t, svc, f.member.ID, n.ID)
	if it.ResourceDeleted || it.ResourceAccessLost || it.CommentDeleted {
		t.Fatalf("readable row flags: %+v", it)
	}
	if !contains(it.Params, "snippet") || !contains(it.Params, "Kế hoạch") {
		t.Fatalf("snippet was dropped: %s", it.Params)
	}
	if !contains(it.Params, created.ID) || !contains(it.Params, `"kind":"comment"`) {
		t.Fatalf("params missing comment_id/kind: %s", it.Params)
	}
}

// A share revoked after delivery is access_lost: the snippet keys go, the
// link and the ids stay (contract-G807 §1; the FE renders a title-less
// sentence when params.document is missing).
func TestServiceDocumentInboxAccessLostDropsSnippetKeys(t *testing.T) {
	f := newDocumentFixture(t)
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	docID := f.document(t, "restricted", "Thu hồi")
	author, _ := f.sharedCommentAuthor(t, docID, "inbox-author@example.com", "Người Bình Luận")
	recipient, share := f.sharedCommentAuthor(t, docID, "inbox-revoked@example.com", "Người Bị Thu Hồi")

	created := f.commentOf(t, author.ID, docID, mentionOf(recipient)+" nhìn", "comment")
	f.handleComment(t)
	n := f.inbox(t, recipient.ID)[0]

	// Readable while the share lives: the snippet and title are present.
	it := f.documentInboxItem(t, svc, recipient.ID, n.ID)
	if it.ResourceAccessLost || !contains(it.Params, "document") {
		t.Fatalf("readable row: %+v", it)
	}
	f.revokeShare(t, share, docID)

	it = f.documentInboxItem(t, svc, recipient.ID, n.ID)
	if !it.ResourceAccessLost || it.ResourceDeleted {
		t.Fatalf("access_lost row: %+v", it)
	}
	if contains(it.Params, "snippet") || contains(it.Params, "document") {
		t.Fatalf("snippet keys survived access_lost: %s", it.Params)
	}
	if !contains(it.Params, created.ID) || !contains(it.Params, `"kind":"comment"`) {
		t.Fatalf("ids were dropped on access_lost: %s", it.Params)
	}
}

// An archived (or hard-deleted) document is resource_deleted, like a task.
func TestServiceDocumentInboxGoneIsResourceDeleted(t *testing.T) {
	f := newDocumentFixture(t)
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	docID := f.document(t, "workspace", "Lưu trữ")

	f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem", "comment")
	f.handleComment(t)
	n := f.inbox(t, f.member.ID)[0]

	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	it := f.documentInboxItem(t, svc, f.member.ID, n.ID)
	if !it.ResourceDeleted || it.ResourceAccessLost {
		t.Fatalf("archived row: %+v", it)
	}
	// R1-5: gone is decided before the organization/level gate, so a revoked
	// recipient of a trashed document would otherwise keep the comment
	// snippet; the content keys go for gone as they do for access_lost.
	if contains(it.Params, "snippet") || contains(it.Params, "document") {
		t.Fatalf("snippet keys survived a gone document: %s", it.Params)
	}
}

// A comment gone (tombstoned or hard-deleted) raises comment_deleted while
// the document stays readable, so the link still opens the document.
func TestServiceDocumentInboxCommentDeleted(t *testing.T) {
	for _, c := range []struct {
		name string
		gone func(t *testing.T, f *documentFixture, commentID string)
	}{
		{"tombstoned", func(t *testing.T, f *documentFixture, commentID string) {
			if _, err := f.pool.Exec(f.ctx,
				`UPDATE document_comments SET body = '', deleted_at = now(), deleted_by_id = $2, deleted_by_kind = 'human' WHERE id = $1`,
				commentID, f.owner.ID); err != nil {
				t.Fatal(err)
			}
		}},
		{"hard deleted", func(t *testing.T, f *documentFixture, commentID string) {
			if _, err := f.pool.Exec(f.ctx, `DELETE FROM document_comments WHERE id = $1`, commentID); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newDocumentFixture(t)
			svc := NewService(f.q, PushConfig{})
			svc.SetDocumentReaders(f.docs)
			docID := f.document(t, "workspace", "Bình luận đã xóa")

			created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem", "comment")
			f.handleComment(t)
			n := f.inbox(t, f.member.ID)[0]

			if it := f.documentInboxItem(t, svc, f.member.ID, n.ID); it.CommentDeleted {
				t.Fatalf("comment_deleted before the delete: %+v", it)
			}
			c.gone(t, f, created.ID)
			it := f.documentInboxItem(t, svc, f.member.ID, n.ID)
			if !it.CommentDeleted || it.ResourceDeleted || it.ResourceAccessLost {
				t.Fatalf("comment_deleted row: %+v", it)
			}
		})
	}
}

// Opening (listing) a notification never changes the comment's Open/Resolved
// state: the read path is a read.
func TestServiceDocumentInboxDoesNotChangeResolveState(t *testing.T) {
	f := newDocumentFixture(t)
	svc := NewService(f.q, PushConfig{})
	svc.SetDocumentReaders(f.docs)
	docID := f.document(t, "workspace", "Trạng thái")

	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem", "comment")
	f.handleComment(t)
	n := f.inbox(t, f.member.ID)[0]

	before, err := f.q.GetDocumentCommentByID(f.ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.documentInboxItem(t, svc, f.member.ID, n.ID)
	after, err := f.q.GetDocumentCommentByID(f.ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if before.ResolvedAt.Valid != after.ResolvedAt.Valid {
		t.Fatalf("resolve state moved on read: %v -> %v", before.ResolvedAt, after.ResolvedAt)
	}
}

// Every document comment kind the rules emit carries params.comment_id and
// params.kind, so the client can build the deep link (contract-G807 §1).
func TestDocumentCommentNotificationsCarryCommentIDAndKind(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Mọi loại")

	root := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" bình luận", "comment")
	f.handleLast(t, "document.comment_added")
	f.reply(t, f.member.ID, docID, root.ID, "phản hồi")
	f.handleLast(t, "document.comment_added")
	f.resolve(t, f.owner.ID, root.ID)
	f.handleLast(t, "document.comment_resolved")

	var checked int
	for _, uid := range []string{f.owner.ID, f.member.ID} {
		for _, n := range f.inbox(t, uid) {
			if n.ResourceType != "document" {
				continue
			}
			if !contains(n.Params, `"comment_id":"`) || !contains(n.Params, `"kind":"`) {
				t.Fatalf("kind %s params missing comment_id/kind: %s", n.Kind, n.Params)
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("no document notification rows to check")
	}
}

// --- G8-07 §2: the push deep link for a document notification --------------

// TestResourceURLDocumentVectors pins the push deep link for a document
// notification with the three shared vectors the FE mirrors plus a discussion
// thread. The workspace rule is ListWorkspacesForUser: the notification's own
// workspace when the recipient is in it, otherwise the first of the same
// organization, otherwise the workspace list. The comment id rides as
// ?comment= and a discussion thread appends &kind=discussion.
func TestResourceURLDocumentVectors(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Liên kết")
	// A second workspace of the same organization, created after the
	// fixture's own: for a recipient who is not a member of the document's
	// workspace it is the first (and only) workspace of that organization in
	// their ListWorkspacesForUser.
	second, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "Second WS", "notif-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	wsB := second.Workspace.ID

	notif := func(t *testing.T, userID, wsID, params string) db.Notification {
		t.Helper()
		row, err := f.q.UpsertNotification(f.ctx, db.UpsertNotificationParams{
			ID: util.NewID(), UserID: userID, OrganizationID: f.orgID,
			WorkspaceID: pgtype.Text{String: wsID, Valid: wsID != ""},
			Kind:        KindDocumentMentioned, GroupKey: "document:" + docID + ":mention:" + util.NewID(),
			ResourceType: "document", ResourceID: docID,
			ActorKind: "human", ActorID: f.owner.ID, TitleKey: TitleKey(KindDocumentMentioned), Params: params,
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	const commentID = "01J8X4CMTN1P2Q3R4S5T6U7V"
	commentParams := `{"comment_id":"` + commentID + `","kind":"comment"}`

	t.Run("vector 1: recipient is a member of the notification's workspace", func(t *testing.T) {
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", notif(t, f.member.ID, f.wsID, commentParams))
		if err != nil {
			t.Fatal(err)
		}
		want := "https://app.test/notif-org/notif-ws/documents/" + docID + "?comment=" + commentID
		if got != want {
			t.Fatalf("url = %q, want %q", got, want)
		}
	})

	t.Run("vector 2: shared from another workspace, recipient reads it there", func(t *testing.T) {
		outsider := f.user(t, "doc-outside@example.com", "Ngoài")
		if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: outsider.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsB, OrganizationID: f.orgID, UserID: outsider.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", notif(t, outsider.ID, f.wsID, commentParams))
		if err != nil {
			t.Fatal(err)
		}
		want := "https://app.test/notif-org/notif-ws-2/documents/" + docID + "?comment=" + commentID
		if got != want {
			t.Fatalf("url = %q, want %q", got, want)
		}
	})

	t.Run("vector 3: recipient has no workspace in the document's organization", func(t *testing.T) {
		stranger := f.user(t, "doc-stranger@example.com", "Xa")
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", notif(t, stranger.ID, f.wsID, commentParams))
		if err != nil {
			t.Fatal(err)
		}
		if want := "https://app.test/workspaces"; got != want {
			t.Fatalf("url = %q, want %q", got, want)
		}
	})

	t.Run("a discussion thread appends kind=discussion", func(t *testing.T) {
		params := `{"comment_id":"` + commentID + `","kind":"discussion"}`
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", notif(t, f.member.ID, f.wsID, params))
		if err != nil {
			t.Fatal(err)
		}
		want := "https://app.test/notif-org/notif-ws/documents/" + docID + "?comment=" + commentID + "&kind=discussion"
		if got != want {
			t.Fatalf("url = %q, want %q", got, want)
		}
	})

	t.Run("no comment id opens the bare document", func(t *testing.T) {
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", notif(t, f.member.ID, f.wsID, `{}`))
		if err != nil {
			t.Fatal(err)
		}
		want := "https://app.test/notif-org/notif-ws/documents/" + docID
		if got != want {
			t.Fatalf("url = %q, want %q", got, want)
		}
	})
}
