package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The UNI-2012 S1-fix-2 regressions for the grant and the reconcile: the
// grant reads its audience without a lock and re-checks it after its commit
// (SF2), a share's level follows the levels its backing messages granted
// (SF3), a failing share does not stop the others (SF4), and the backing rule
// is pinned for deactivated members, archived rooms and promoted messages
// (SF6).

// messageShareLevel is the share_level a document message recorded.
func (f *chatDocumentFixture) messageShareLevel(t *testing.T, messageID string) string {
	t.Helper()
	var raw []byte
	if err := f.pool.QueryRow(context.Background(), `SELECT metadata FROM chat_messages WHERE id = $1`, messageID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	lv, _ := meta["share_level"].(string)
	return lv
}

// filler is the fixture's one extra member, for a group that needs a second
// member besides the one a test watches. Created once per fixture.
func (f *chatDocumentFixture) filler(t *testing.T) db.User {
	t.Helper()
	u, err := f.q.GetUserByEmail(context.Background(), "chatdoc-filler@example.com")
	if err == nil {
		return u
	}
	return f.reconcileMember(t, "chatdoc-filler@example.com", "Filler")
}

// TestDecideChatShare pins the level and anchor rule for every branch.
func TestDecideChatShare(t *testing.T) {
	live := func(level, prior string) db.DocumentShare {
		sh := db.DocumentShare{ID: "s", Level: level, SourceRoomID: nullText("r-own"), SourceMessageID: nullText("m-own")}
		if prior != "" {
			sh.PriorManualLevel = nullText(prior)
		}
		return sh
	}
	own := chatShareBacking{roomID: "r-own", messageID: "m-own", level: DocumentLevelEdit, isSource: true}
	comment := chatShareBacking{roomID: "r2", messageID: "m2", level: DocumentLevelComment}
	view := chatShareBacking{roomID: "r3", messageID: "m3", level: DocumentLevelView}
	legacy := chatShareBacking{roomID: "r4", messageID: "m4"}
	editElsewhere := chatShareBacking{roomID: "r5", messageID: "m5", level: DocumentLevelEdit}
	cases := []struct {
		name     string
		share    db.DocumentShare
		backings []chatShareBacking
		action   chatShareAction
		level    DocumentLevel
		anchor   string
	}{
		{"no backing", live("edit", ""), nil, chatShareRevoke, "", ""},
		{"own source still backs", live("edit", ""), []chatShareBacking{own, comment}, chatShareKeep, "", "m-own"},
		{"backed at its level elsewhere", live("edit", ""), []chatShareBacking{comment, editElsewhere}, chatShareRepoint, "", "m5"},
		{"backed lower", live("edit", ""), []chatShareBacking{view, comment}, chatShareLower, DocumentLevelComment, "m2"},
		{"backed lower, manual below it", live("edit", "view"), []chatShareBacking{comment}, chatShareLower, DocumentLevelComment, "m2"},
		{"backed lower, manual at it", live("edit", "comment"), []chatShareBacking{comment}, chatShareRevoke, "", ""},
		{"never raised", live("comment", ""), []chatShareBacking{editElsewhere}, chatShareRepoint, "", "m5"},
		{"legacy backs the current level", live("edit", ""), []chatShareBacking{comment, legacy}, chatShareRepoint, "", "m4"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := decideChatShare(c.share, c.backings)
			if d.action != c.action || d.level != c.level || d.anchor.messageID != c.anchor {
				t.Fatalf("decision = %+v, want action %d level %q anchor %q", d, c.action, c.level, c.anchor)
			}
		})
	}
	if _, ok := chatMessageShareLevel("manage"); ok {
		t.Fatal("manage read as a chat share level")
	}
}

// TestChatGrantRecheckCatchesLeaveBeforeCommit is SF2's first order: a
// recipient leaves after the grant read its audience and before the grant
// commits, and the leave's own reconcile runs before the grant is visible.
// The leave and the recipients' read-cursor updates do not wait for the send,
// and the post-commit re-check revokes the grant.
func TestChatGrantRecheckCatchesLeaveBeforeCommit(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-sf2a-c@example.com", "C")
	room := f.reconcileGroup(t, "sf2-a", f.ub.ID, uc.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	var once sync.Once
	chatGrantAfterAudienceRead = func() {
		once.Do(func() {
			quick, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := f.q.UpdateChatRoomMemberLastRead(quick, db.UpdateChatRoomMemberLastReadParams{
				RoomID: room.ID, UserID: uc.ID, LastReadAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
			}); err != nil {
				t.Errorf("a recipient's read cursor waited for the send: %v", err)
			}
			if err := f.svc.LeaveChatRoom(quick, f.ub.ID, f.ws.ID, room.ID); err != nil {
				t.Errorf("leave during the grant: %v", err)
			}
			deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": f.ub.ID})
		})
	}
	t.Cleanup(func() { chatGrantAfterAudienceRead = nil })

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("sf2-order-a-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	docID := sent.Document.DocumentID
	if got := f.messageShareLevel(t, sent.ID); got != string(DocumentLevelComment) {
		t.Fatalf("message share_level = %q, want comment", got)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
		t.Fatal("the grant of a member who left before the commit survived the re-check")
	}
	if n := len(f.auditRows(t, audit.ActionDocumentShareRevoked, docID)); n != 1 {
		t.Fatalf("share_revoked rows = %d, want 1 (granted, then revoked by the re-check)", n)
	}
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelComment {
		t.Fatalf("remaining member level = %q, want comment", got)
	}
}

// TestChatGrantLeaveAfterCommitIsReconciled is SF2's second order: a leave
// that is in flight for the whole send (its member row held by another
// transaction) commits after the grant. The send is not blocked by it, the
// re-check still sees the member, and the leave's own reconcile revokes.
func TestChatGrantLeaveAfterCommitIsReconciled(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	revoker := NewChatDocumentShareRevoker(f.docs)

	hold, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx,
		`SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
		room.ID, f.ub.ID); err != nil {
		t.Fatal(err)
	}
	left := make(chan error, 1)
	go func() { left <- f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, room.ID) }()
	waitForLockWaiterOn(t, f, "LeaveChatRoomMember")

	rechecked := false
	chatGrantBeforeRecheck = func() { rechecked = true }
	t.Cleanup(func() { chatGrantBeforeRecheck = nil })
	sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	sent, err := f.svc.SendDocumentMessage(sendCtx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("sf2-order-b-1"))
	if err != nil {
		t.Fatalf("send while a leave was in flight: %v", err)
	}
	docID := sent.Document.DocumentID
	if !rechecked {
		t.Fatal("the send did not re-check its audience")
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); !ok {
		t.Fatal("setup: the re-check saw the member still in the room, the grant must stand")
	}

	if err := hold.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-left:
		if err != nil {
			t.Fatalf("leave: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the leave never committed")
	}
	deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": f.ub.ID})
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelNone {
		t.Fatalf("level after the leave's reconcile = %q, want none", got)
	}
}

// leaveOneFreeConnection holds every pool connection but one until the test
// ends, so a command that asks the pool for a second connection while its
// transaction holds the first waits forever instead of passing on a host
// whose pool happens to be large.
func (f *chatDocumentFixture) leaveOneFreeConnection(t *testing.T) {
	t.Helper()
	st := f.pool.Stat()
	for range int(st.MaxConns()) - int(st.AcquiredConns()) - 1 {
		quick, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn, err := f.pool.Acquire(quick)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(conn.Release)
	}
}

// TestChatDocumentSendsCommitOnOneConnection pins why
// TestChatGrantLeaveAfterCommitIsReconciled timed out on a 4-CPU host: the
// document, link and share-as-document commits re-checked the send gate
// through the pool while their transaction held a connection, so with the
// pool otherwise taken they waited on themselves. Each now runs its commit on
// the transaction's connection alone.
func TestChatDocumentSendsCommitOnOneConnection(t *testing.T) {
	f := newChatDocumentFixture(t)
	room := f.dm(t)
	fileMsg, err := f.svc.SendFileMessage(context.Background(), f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename: "mot-ket-noi.md", Body: bytes.NewReader([]byte("# Một kết nối\n")), ClientMsgID: "one-conn-file",
	})
	if err != nil {
		t.Fatal(err)
	}
	f.leaveOneFreeConnection(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("one-conn-doc"))
	if err != nil {
		t.Fatalf("document send on one free connection: %v", err)
	}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(sent.Document.DocumentID, "one-conn-link")); err != nil {
		t.Fatalf("link send on one free connection: %v", err)
	}
	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, fileMsg.ID, ShareAttachmentAsDocumentInput{}); err != nil {
		t.Fatalf("share as document on one free connection: %v", err)
	}
}

// TestChatDocumentShareLowersToBackingLevelOnLeave is SF3 for a leave: ub got
// edit from room A and comment from room B; leaving A leaves ub with comment,
// sourced by B, audited and announced as a level change. A legacy card
// (no share_level) in another room backs the current level instead.
func TestChatDocumentShareLowersToBackingLevelOnLeave(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-sf3-c@example.com", "C")
	roomA := f.reconcileGroup(t, "sf3-a", f.ub.ID, f.filler(t).ID)
	roomB := f.reconcileGroup(t, "sf3-b", f.ub.ID, uc.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Hai phòng")
	editIn := linkInput(page.ID, "sf3-a-edit")
	editIn.ShareLevel = "edit"
	msgA, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, roomA.ID, editIn)
	if err != nil {
		t.Fatal(err)
	}
	msgB, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, roomB.ID, linkInput(page.ID, "sf3-b-comment"))
	if err != nil {
		t.Fatal(err)
	}
	if a, b := f.messageShareLevel(t, msgA.ID), f.messageShareLevel(t, msgB.ID); a != "edit" || b != "comment" {
		t.Fatalf("message share_level = %q / %q, want edit / comment", a, b)
	}
	before, ok := f.liveShareOf(t, f.ub.ID, page.ID)
	if !ok || before.Level != "edit" || before.SourceMessageID.String != msgA.ID {
		t.Fatalf("setup share = %+v, want edit from room A", before)
	}
	sharedBefore := len(f.auditRows(t, audit.ActionDocumentShared, page.ID))

	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, roomA.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": roomA.ID, "user_id": f.ub.ID})
	}
	after, ok := f.liveShareOf(t, f.ub.ID, page.ID)
	if !ok || after.ID == before.ID || after.Level != "comment" || after.SourceRoomID.String != roomB.ID ||
		after.SourceMessageID.String != msgB.ID || after.SourceKind.String != DocumentShareSourceKindChat {
		t.Fatalf("share after leaving A = %+v, want a comment chat grant from room B", after)
	}
	shared := f.auditRows(t, audit.ActionDocumentShared, page.ID)
	if len(shared) != sharedBefore+1 {
		t.Fatalf("document.shared rows = %d, want %d (one level change, replayed delivery writes nothing)", len(shared), sharedBefore+1)
	}
	last := shared[len(shared)-1]
	if !strings.Contains(last.Changes, `"edit"`) || !strings.Contains(last.Changes, `"comment"`) || !strings.Contains(last.Metadata, "chat_level_lowered") {
		t.Fatalf("level change audit = %s %s", last.Changes, last.Metadata)
	}
	if n := f.countRows(t,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'share_id' = $1`, after.ID); n != 1 {
		t.Fatalf("document.shared events naming the lowered share = %d, want 1", n)
	}
	if got := f.levelOf(t, uc.ID, page.ID); got != DocumentLevelComment {
		t.Fatalf("uc level = %q, want comment untouched", got)
	}

	// Legacy: the backing card did not record its level, so it backs edit.
	legacyDoc := f.linkPage(t, f.ua.ID, f.ws.ID, "Thẻ cũ")
	roomC := f.reconcileGroup(t, "sf3-c", f.ub.ID, f.filler(t).ID)
	editIn = linkInput(legacyDoc.ID, "sf3-c-edit")
	editIn.ShareLevel = "edit"
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, roomC.ID, editIn); err != nil {
		t.Fatal(err)
	}
	legacyCard := f.documentMessageIn(t, roomB, legacyDoc.ID)
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, roomC.ID); err != nil {
		t.Fatal(err)
	}
	deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": roomC.ID, "user_id": f.ub.ID})
	if sh, ok := f.liveShareOf(t, f.ub.ID, legacyDoc.ID); !ok || sh.Level != "edit" || sh.SourceMessageID.String != legacyCard.ID {
		t.Fatalf("share backed by a legacy card = %+v, want edit re-pointed to it", sh)
	}
}

// TestChatDocumentReconcileContinuesPastAFailingShare is SF4: a share whose
// reconcile keeps failing does not keep the user's other stale shares, which
// come after it, from being revoked; the failure is still returned.
func TestChatDocumentReconcileContinuesPastAFailingShare(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	first, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("sf4-poison-1"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("sf4-poison-2"))
	if err != nil {
		t.Fatal(err)
	}
	poison, ok := f.liveShareOf(t, f.ub.ID, first.Document.DocumentID)
	if !ok {
		t.Fatal("setup: no share on the first document")
	}
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, room.ID); err != nil {
		t.Fatal(err)
	}
	errPoison := errors.New("poison share")
	chatShareReconcileFault = func(sh db.DocumentShare) error {
		if sh.ID == poison.ID {
			return errPoison
		}
		return nil
	}
	t.Cleanup(func() { chatShareReconcileFault = nil })

	if err := f.docs.ReconcileChatDocumentSharesForMember(ctx, f.orgID, f.ub.ID); !errors.Is(err, errPoison) {
		t.Fatalf("reconcile = %v, want the poison failure returned", err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, second.Document.DocumentID); ok {
		t.Fatal("the share after the failing one was not revoked")
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, first.Document.DocumentID); !ok {
		t.Fatal("setup: the failing share must still be live")
	}
	chatShareReconcileFault = nil
	if err := f.docs.ReconcileChatDocumentSharesForMember(ctx, f.orgID, f.ub.ID); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, first.Document.DocumentID); ok {
		t.Fatal("the retry did not revoke the share that had failed")
	}
}

// TestChatDocumentReconcileSkipsDeactivatedMember pins the deactivated skip:
// deactivation marks the rooms left but the reconcile keeps the grant, and
// reactivation restores the rooms with the grant still backed.
func TestChatDocumentReconcileSkipsDeactivatedMember(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	revoker := NewChatDocumentShareRevoker(f.docs)
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("deact-send-1"))
	if err != nil {
		t.Fatal(err)
	}
	docID := sent.Document.DocumentID
	members := NewOrganizationMemberService(f.pool, f.q, f.docs.orgs)
	if _, err := members.Deactivate(ctx, f.ua.ID, f.orgID, f.ub.ID); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	deliver(t, revoker, f.orgID, "member.removed", map[string]string{"organization_id": f.orgID, "user_id": f.ub.ID})
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); !ok {
		t.Fatal("the reconcile revoked a deactivated member's grant")
	}
	if _, err := members.Reactivate(ctx, f.ua.ID, f.orgID, f.ub.ID); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	deliver(t, revoker, f.orgID, "member.removed", map[string]string{"organization_id": f.orgID, "user_id": f.ub.ID})
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelComment {
		t.Fatalf("level after reactivation = %q, want comment", got)
	}
}

// TestChatDocumentShareBackedByArchivedRoom pins the archived-rooms decision:
// archiving a channel is not leaving it, so a card in an archived channel the
// user still belongs to keeps backing their grant when they leave another
// room.
func TestChatDocumentShareBackedByArchivedRoom(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	revoker := NewChatDocumentShareRevoker(f.docs)
	grp := f.reconcileGroup(t, "archived-grp", f.ub.ID, f.filler(t).ID)
	sum, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{Name: "kenh-luu-tru", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	ch, err := f.q.GetChatRoomByID(ctx, sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	addChatRoomMember(t, f.q, ch, f.ws.ID, f.orgID, f.ub.ID)
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Kênh lưu trữ")
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, linkInput(page.ID, "archived-grp-1")); err != nil {
		t.Fatal(err)
	}
	chMsg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, ch.ID, linkInput(page.ID, "archived-ch-1"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ArchiveChannel(ctx, f.ua.ID, f.ws.ID, ch.ID); err != nil {
		t.Fatalf("archive channel: %v", err)
	}
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, grp.ID); err != nil {
		t.Fatal(err)
	}
	deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": grp.ID, "user_id": f.ub.ID})
	sh, ok := f.liveShareOf(t, f.ub.ID, page.ID)
	if !ok || sh.SourceRoomID.String != ch.ID || sh.SourceMessageID.String != chMsg.ID {
		t.Fatalf("share after leaving the group = %+v, want it backed by the archived channel's card", sh)
	}
}

// TestPromotedMessageBacksAMemberWhoJoinedAfterIt is disjunct 2 of the backing
// rule with a real case: uc joins the group after the file message was sent,
// the sender promotes it, and the promoted card (older than uc's membership)
// still backs uc's grant because the grant was made during it. After uc
// leaves and rejoins, the same card no longer rescues the old grant.
func TestPromotedMessageBacksAMemberWhoJoinedAfterIt(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-dj2-c@example.com", "C")
	room := f.reconcileGroup(t, "disjunct-2", f.ub.ID, f.filler(t).ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	fileMsg, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename: "ke-hoach.md", Body: bytes.NewReader([]byte("# Kế hoạch\n")), ClientMsgID: "dj2-file",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Joining is a later transaction, so uc's member row is newer than the
	// file message.
	if _, err := f.svc.InviteGroupMembers(ctx, f.ua.ID, f.ws.ID, room.ID, []string{uc.ID}); err != nil {
		t.Fatalf("invite: %v", err)
	}
	row, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, fileMsg.ID, ShareAttachmentAsDocumentInput{})
	if err != nil {
		t.Fatalf("promote: %v", err)
	}
	docID := row.Document.DocumentID
	if got := f.messageShareLevel(t, fileMsg.ID); got != string(DocumentLevelComment) {
		t.Fatalf("promoted message share_level = %q, want comment", got)
	}
	var msgAt, memberAt time.Time
	if err := f.pool.QueryRow(ctx, `SELECT created_at FROM chat_messages WHERE id = $1`, fileMsg.ID).Scan(&msgAt); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx,
		`SELECT created_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND status IN ('invited','active')`,
		room.ID, uc.ID).Scan(&memberAt); err != nil {
		t.Fatal(err)
	}
	if !msgAt.Before(memberAt) {
		t.Fatalf("setup: the file message (%v) must be older than uc's membership (%v)", msgAt, memberAt)
	}
	deliver(t, revoker, f.orgID, "member.removed", map[string]string{"organization_id": f.orgID, "user_id": uc.ID})
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelComment {
		t.Fatalf("uc level after a reconcile = %q, want comment (the grant was made during the membership)", got)
	}

	if err := f.svc.LeaveChatRoom(ctx, uc.ID, f.ws.ID, room.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.InviteGroupMembers(ctx, f.ua.ID, f.ws.ID, room.ID, []string{uc.ID}); err != nil {
		t.Fatalf("re-invite: %v", err)
	}
	deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": uc.ID})
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelNone {
		t.Fatalf("uc level after leaving and rejoining = %q, want none", got)
	}
}
