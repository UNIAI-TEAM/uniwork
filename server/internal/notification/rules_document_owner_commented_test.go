package notification

// UNI-2012 D6 edge cases of the owner's document_commented notice
// (ownerCommentedDraft): who still hears it, and who never does. The base
// behaviour (live card, owner's own comment, deleted card) is in
// document_comments_test.go.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ownedBy hands the fixture document to aclOwner, an organization member who
// is not (yet) in the workspace.
func (f *documentFixture) ownedBy(t *testing.T, docID, email, name string) db.User {
	t.Helper()
	u := f.user(t, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = $1 WHERE id = $2`, u.ID, docID); err != nil {
		t.Fatal(err)
	}
	return u
}

// commentNotices counts the document_commented rows a user holds.
func (f *documentFixture) commentNotices(t *testing.T, userID string) int {
	t.Helper()
	n := 0
	for _, kind := range f.inboxKinds(t, userID) {
		if kind == KindDocumentCommented {
			n++
		}
	}
	return n
}

// An owner who can no longer read the document hears nothing; the same comment
// stream reaches them again the moment access returns.
func TestDocumentCommentOwnerWithoutReadAccessGetsNoNotice(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Chủ mất quyền")
	f.chatCard(t, docID)
	owner := f.ownedBy(t, docID, "owner-no-read@example.com", "Chủ Ngoài")

	f.commentOf(t, f.member.ID, docID, "chủ chưa vào workspace", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, owner.ID); got != 0 {
		t.Fatalf("an owner outside the workspace got %d notices, want none", got)
	}

	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: owner.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	f.commentOf(t, f.member.ID, docID, "chủ đã vào lại", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, owner.ID); got != 1 {
		t.Fatalf("an owner with access got %d notices, want 1", got)
	}
}

// A deactivated owner keeps ownership of the row but is refused by the gate, so
// they hear nothing until reactivated.
func TestDocumentCommentDeactivatedOwnerGetsNoNotice(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Chủ bị khóa")
	f.chatCard(t, docID)
	owner := f.ownedBy(t, docID, "owner-deact@example.com", "Chủ Bị Khóa")
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: owner.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, f.orgID, owner.ID); err != nil {
		t.Fatal(err)
	}

	f.commentOf(t, f.member.ID, docID, "chủ đã bị khóa", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, owner.ID); got != 0 {
		t.Fatalf("a deactivated owner got %d notices, want none", got)
	}

	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`, f.orgID, owner.ID); err != nil {
		t.Fatal(err)
	}
	f.commentOf(t, f.member.ID, docID, "chủ đã mở khóa", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, owner.ID); got != 1 {
		t.Fatalf("a reactivated owner got %d notices, want 1", got)
	}
}

// An agent's comment is somebody else's comment: the human owner hears it,
// named after the agent. Document access gives an agent no comment right today,
// so the person's comment and its event are rewritten to an agent's: the rule's
// own author and actor guards are what is under test. An agent's work product
// has no human owner to tell.
func TestDocumentCommentByAnAgentNotifiesTheOwner(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Agent bình luận")
	f.chatCard(t, docID)
	agent, err := f.q.CreateAgent(f.ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: f.orgID, Name: "Trợ Lý", Handle: "tro-ly",
		OwnerUserID: f.member.ID, AutonomyPolicy: "{}", CreatedBy: f.member.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	agentComment := func(body string, beforeHandle func()) {
		t.Helper()
		c := f.commentOf(t, f.member.ID, docID, body, "comment")
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE document_comments SET author_kind = 'agent', author_id = $1 WHERE id = $2`, agent.ID, c.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE outbox_events SET actor_kind = 'agent', actor_id = $1 WHERE id = $2`,
			agent.ID, f.lastEvent(t, "document.comment_added").ID); err != nil {
			t.Fatal(err)
		}
		beforeHandle()
		f.handleLast(t, "document.comment_added")
	}

	agentComment("agent đã rà soát", func() {})
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentCommented || !contains(got[0].Params, "Trợ Lý") {
		t.Fatalf("owner inbox = %+v, want one document_commented from the agent", got)
	}

	agentComment("agent ghi chú thêm", func() {
		if _, err := f.pool.Exec(f.ctx,
			`UPDATE documents SET owner_kind = 'work_product', owner_id = $1 WHERE id = $2`, agent.ID, docID); err != nil {
			t.Fatal(err)
		}
	})
	if got := f.commentNotices(t, f.owner.ID); got != 1 {
		t.Fatalf("a work product notified its ACL owner again: %d notices, want still 1", got)
	}
}

// A third person replying to the owner's comment reaches the owner as a reply
// only: the reply rule already drafted them, so no second document_commented.
func TestDocumentCommentReplyToTheOwnerIsOneNotice(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Trả lời chủ")
	f.chatCard(t, docID)

	root := f.commentOf(t, f.owner.ID, docID, "chủ hỏi", "comment")
	f.handleLast(t, "document.comment_added")
	f.reply(t, f.member.ID, docID, root.ID, "thành viên trả lời")
	f.handleLast(t, "document.comment_added")

	kinds := f.inboxKinds(t, f.owner.ID)
	if len(kinds) != 1 || kinds[0] != KindDocumentCommentReplied {
		t.Fatalf("owner kinds = %v, want one document_comment_replied and no document_commented", kinds)
	}
}

// An owner who turned document_commented off hears nothing, and turning it back
// on restores it: the notice follows the person's own preference.
func TestDocumentCommentOwnerOptedOutGetsNoNotice(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Chủ tắt thông báo")
	f.chatCard(t, docID)

	f.setPref(t, f.owner.ID, KindDocumentCommented, false)
	f.commentOf(t, f.member.ID, docID, "chủ đã tắt", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, f.owner.ID); got != 0 {
		t.Fatalf("an owner who opted out got %d notices, want none", got)
	}

	f.setPref(t, f.owner.ID, KindDocumentCommented, true)
	f.commentOf(t, f.member.ID, docID, "chủ đã bật lại", "comment")
	f.handleLast(t, "document.comment_added")
	if got := f.commentNotices(t, f.owner.ID); got != 1 {
		t.Fatalf("an owner who opted back in got %d notices, want 1", got)
	}
}
