package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The UNI-2012 S1-fix regressions: the chat-origin share reconcile is
// state-based (current membership, current messages), so ordering, retries,
// replays and re-pointing stop mattering; and a grant re-checks the room's
// members under a lock that a leave has to wait for.

// reconcileMember registers one more organization and workspace member.
func (f *chatDocumentFixture) reconcileMember(t *testing.T, email, name string) db.User {
	t.Helper()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, f.q, as, email, name)
	addOrgMember(t, f.q, f.orgID, u.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, u.ID)
	return u
}

// reconcileGroup creates a group room of the fixture's sender and members.
func (f *chatDocumentFixture) reconcileGroup(t *testing.T, name string, members ...string) db.ChatRoom {
	t.Helper()
	ctx := context.Background()
	sum, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: name, MemberUserIDs: members})
	if err != nil {
		t.Fatalf("create group %s: %v", name, err)
	}
	room, err := f.q.GetChatRoomByID(ctx, sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	return room
}

// deliver runs the revoker on one synthetic outbox row of topic.
func deliver(t *testing.T, revoker *ChatDocumentShareRevoker, orgID, topic string, payload map[string]string) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := revoker.Handle(context.Background(), outbox.Row{
		ID: util.NewID(), Topic: topic, Payload: string(raw),
		OrganizationID: pgtype.Text{String: orgID, Valid: true},
	}); err != nil {
		t.Fatalf("revoker %s: %v", topic, err)
	}
}

// levelOf is userID's effective level on documentID.
func (f *chatDocumentFixture) levelOf(t *testing.T, userID, documentID string) DocumentLevel {
	t.Helper()
	ctx := context.Background()
	doc, err := f.q.GetDocumentByID(ctx, documentID)
	if err != nil {
		t.Fatal(err)
	}
	acc, err := f.docs.effectiveLevel(ctx, f.q, Human(userID), doc)
	if err != nil && !isGateRefusal(err) {
		t.Fatal(err)
	}
	return acc.Level
}

// liveShareOf is userID's live direct share on documentID, if any.
func (f *chatDocumentFixture) liveShareOf(t *testing.T, userID, documentID string) (db.DocumentShare, bool) {
	t.Helper()
	for _, sh := range f.liveSharesOfDocument(t, documentID) {
		if sh.PrincipalType == DocumentPrincipalUser && sh.PrincipalID == userID {
			return sh, true
		}
	}
	return db.DocumentShare{}, false
}

// documentMessageIn writes a live document message of documentID into room,
// the shape a later send (or the S2 link route) leaves behind.
func (f *chatDocumentFixture) documentMessageIn(t *testing.T, room db.ChatRoom, documentID string) db.ChatMessage {
	t.Helper()
	msg, err := f.q.CreateChatDocumentMessage(context.Background(), db.CreateChatDocumentMessageParams{
		ID: util.NewID(), RoomID: room.ID, OrganizationID: f.orgID, WorkspaceID: roomAnchorWorkspaceID(room),
		SenderID: f.ua.ID, SenderKind: "human", Body: "doc",
		Metadata: []byte(fmt.Sprintf(`{"document_id":%q}`, documentID)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return msg
}

// TestChatDocumentGrantSkipsRecipientWhoLeftDuringUpload is B1 for a send:
// the audience is read before the upload; a recipient who leaves (and whose
// removal is fully reconciled) before the grant is written gets nothing.
func TestChatDocumentGrantSkipsRecipientWhoLeftDuringUpload(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-b1-c@example.com", "C")
	room := f.reconcileGroup(t, "b1-send", f.ub.ID, uc.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	var once sync.Once
	chatDocumentShareFault = func() error {
		once.Do(func() {
			if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, room.ID); err != nil {
				t.Errorf("leave during upload: %v", err)
			}
			deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": f.ub.ID})
		})
		return nil
	}
	t.Cleanup(func() { chatDocumentShareFault = nil })

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("b1-send-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	docID := sent.Document.DocumentID
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
		t.Fatalf("the member who left during the upload got a share")
	}
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelNone {
		t.Fatalf("leaver level = %q, want none", got)
	}
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelComment {
		t.Fatalf("remaining member level = %q, want comment", got)
	}
}

// TestShareAttachmentAsDocumentSkipsRecipientWhoLeft is B1 for a promotion.
func TestShareAttachmentAsDocumentSkipsRecipientWhoLeft(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-b1p-c@example.com", "C")
	room := f.reconcileGroup(t, "b1-promote", f.ub.ID, uc.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	fileMsg, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename: "ke-hoach.md", Body: bytes.NewReader([]byte("# Kế hoạch\n")), ClientMsgID: "b1-promote-file",
	})
	if err != nil {
		t.Fatalf("send file: %v", err)
	}
	var once sync.Once
	chatDocumentShareFault = func() error {
		once.Do(func() {
			if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, room.ID); err != nil {
				t.Errorf("leave during promotion: %v", err)
			}
			deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": f.ub.ID})
		})
		return nil
	}
	t.Cleanup(func() { chatDocumentShareFault = nil })

	row, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, fileMsg.ID, ShareAttachmentAsDocumentInput{})
	if err != nil {
		t.Fatalf("share as document: %v", err)
	}
	docID := row.Document.DocumentID
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelNone {
		t.Fatalf("leaver level = %q, want none", got)
	}
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelComment {
		t.Fatalf("remaining member level = %q, want comment", got)
	}
	// The promoted message keeps its older created_at, yet the grant was made
	// during uc's membership: a later reconcile for uc keeps it.
	deliver(t, revoker, f.orgID, "member.removed", map[string]string{"organization_id": f.orgID, "user_id": uc.ID})
	if got := f.levelOf(t, uc.ID, docID); got != DocumentLevelComment {
		t.Fatalf("remaining member level after a reconcile = %q, want comment", got)
	}
}

// TestChatDocumentShareRevokedOnOrganizationLeave is B2: leaving the
// organization leaves every chat room, and member.left revokes the chat
// grants, so being invited back does not bring them back.
func TestChatDocumentShareRevokedOnOrganizationLeave(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	revoker := NewChatDocumentShareRevoker(f.docs)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("b2-send-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	docID := sent.Document.DocumentID
	members := NewOrganizationMemberService(f.pool, f.q, f.docs.orgs)
	if err := members.Leave(ctx, f.ub.ID, f.orgID); err != nil {
		t.Fatalf("leave organization: %v", err)
	}
	deliver(t, revoker, f.orgID, "member.left", map[string]string{"organization_id": f.orgID, "user_id": f.ub.ID})
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
		t.Fatalf("chat share survived leaving the organization")
	}
	addOrgMember(t, f.q, f.orgID, f.ub.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, f.ub.ID)
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelNone {
		t.Fatalf("level after rejoining the organization = %q, want none", got)
	}
}

// TestChatDocumentShareReconcileRacingRemovals is B3's schedule: the reconcile
// for leaving room A finds the user still in room B and is about to re-point
// the share to B; the user leaves B and B's reconcile runs meanwhile. However
// the two interleave, the user ends with no chat access.
func TestChatDocumentShareReconcileRacingRemovals(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-b3-c@example.com", "C")
	ud := f.reconcileMember(t, "chatdoc-b3-d@example.com", "D")
	roomA := f.reconcileGroup(t, "b3-a", f.ub.ID, uc.ID)
	roomB := f.reconcileGroup(t, "b3-b", f.ub.ID, ud.ID)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, roomA.ID, documentMessageInput("b3-send-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	docID := sent.Document.DocumentID
	f.documentMessageIn(t, roomB, docID)

	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, roomA.ID); err != nil {
		t.Fatal(err)
	}
	paused, resume := make(chan struct{}), make(chan struct{})
	var once sync.Once
	chatShareReconcileBeforeCommit = func() {
		once.Do(func() {
			close(paused)
			<-resume
		})
	}
	t.Cleanup(func() { chatShareReconcileBeforeCommit = nil })

	errA := make(chan error, 1)
	go func() {
		errA <- f.docs.ReconcileChatDocumentSharesForMember(ctx, f.orgID, f.ub.ID)
	}()
	select {
	case <-paused:
	case <-time.After(10 * time.Second):
		t.Fatal("room A's reconcile never reached its commit")
	}
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, roomB.ID); err != nil {
		t.Fatal(err)
	}
	errB := make(chan error, 1)
	go func() {
		errB <- f.docs.ReconcileChatDocumentSharesForMember(ctx, f.orgID, f.ub.ID)
	}()
	// Let B's reconcile reach the document lock A holds before A commits.
	waitForChatShareLockWaiter(t, f)
	close(resume)
	for _, ch := range []chan error{errA, errB} {
		select {
		case err := <-ch:
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("a reconcile did not finish")
		}
	}
	if got := f.levelOf(t, f.ub.ID, docID); got != DocumentLevelNone {
		t.Fatalf("level after leaving both rooms = %q, want none", got)
	}
}

// waitForChatShareLockWaiter blocks until some backend of the test database
// waits on a lock: room B's reconcile queued behind the document lock room A's
// reconcile holds.
func waitForChatShareLockWaiter(t *testing.T, f *chatDocumentFixture) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := f.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("room B's reconcile never waited on the document lock")
}

// TestManualShareOverChatGrantSurvivesLeave is B4: a manual grant at the level
// a chat grant already gave takes the row over, so leaving the room keeps it.
func TestManualShareOverChatGrantSurvivesLeave(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-b4-c@example.com", "C")
	ud := f.reconcileMember(t, "chatdoc-b4-d@example.com", "D")
	room := f.reconcileGroup(t, "b4", f.ub.ID, uc.ID, ud.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	// ud held manual view before the chat raise to edit.
	page, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{Title: "B4", Visibility: "restricted"})
	if err != nil {
		t.Fatal(err)
	}
	docID := page.Document.ID
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	msg := f.documentMessageIn(t, room, docID)
	for _, lv := range []DocumentLevel{DocumentLevelComment, DocumentLevelEdit} {
		recipients := []string{f.ub.ID, uc.ID}
		if lv == DocumentLevelEdit {
			recipients = []string{ud.ID}
		}
		doc, err := f.q.GetDocumentByID(ctx, docID)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.svc.grantDocumentToRoomMembers(ctx, f.q, Human(f.ua.ID),
			DocumentFileResult{Document: doc}, recipients, lv, room.ID, msg.ID); err != nil {
			t.Fatalf("chat grant at %s: %v", lv, err)
		}
	}
	if sh, ok := f.liveShareOf(t, ud.ID, docID); !ok || sh.PriorManualLevel.String != "view" {
		t.Fatalf("ud chat share = %+v, want prior manual view", sh)
	}

	// Manual confirmations at the chat level: ub through ShareDocument, uc
	// through the batch share, ud at the raised level.
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID, Level: DocumentLevelComment,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.ShareDocumentBatch(ctx, Human(f.ua.ID), docID, []string{uc.ID}, DocumentLevelComment); err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{f.ub.ID, uc.ID, ud.ID} {
		sh, ok := f.liveShareOf(t, id, docID)
		if !ok || sh.SourceKind.Valid || sh.SourceRoomID.Valid || sh.SourceMessageID.Valid || sh.PriorManualLevel.Valid {
			t.Fatalf("share of %s after the manual grant = %+v, want manual provenance", id, sh)
		}
	}
	// A manual replay at the same level writes nothing more.
	before := len(f.auditRows(t, "document.shared", docID))
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID, Level: DocumentLevelComment,
	}); err != nil {
		t.Fatal(err)
	}
	if after := len(f.auditRows(t, "document.shared", docID)); after != before {
		t.Fatalf("manual replay wrote %d document.shared rows, want 0", after-before)
	}

	for _, id := range []string{f.ub.ID, uc.ID, ud.ID} {
		if err := f.svc.RemoveChatRoomMember(ctx, f.ua.ID, f.ws.ID, room.ID, id); err != nil {
			t.Fatal(err)
		}
		deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": id})
	}
	for id, want := range map[string]DocumentLevel{f.ub.ID: DocumentLevelComment, uc.ID: DocumentLevelComment, ud.ID: DocumentLevelEdit} {
		if got := f.levelOf(t, id, docID); got != want {
			t.Fatalf("level of %s after leaving = %q, want the manual %q", id, got, want)
		}
	}
}

// TestChatDocumentShareReconcileIsBoundToMembership is B5: an old removal
// delivered (twice) after a rejoin keeps the grant made after the rejoin and
// revokes the one made during the earlier membership.
func TestChatDocumentShareReconcileIsBoundToMembership(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-b5-c@example.com", "C")
	room := f.reconcileGroup(t, "b5", f.ub.ID, uc.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	old, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("b5-send-old"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, room.ID); err != nil {
		t.Fatal(err)
	}
	// The removal event stays queued while ub comes back and gets a new grant.
	if _, err := f.svc.InviteGroupMembers(ctx, f.ua.ID, f.ws.ID, room.ID, []string{f.ub.ID}); err != nil {
		t.Fatalf("rejoin: %v", err)
	}
	fresh, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("b5-send-fresh"))
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": room.ID, "user_id": f.ub.ID})
	}
	if got := f.levelOf(t, f.ub.ID, fresh.Document.DocumentID); got != DocumentLevelComment {
		t.Fatalf("grant made after the rejoin = %q, want comment", got)
	}
	if got := f.levelOf(t, f.ub.ID, old.Document.DocumentID); got != DocumentLevelNone {
		t.Fatalf("grant from the earlier membership = %q, want none", got)
	}
	// uc never left: nothing of theirs moves.
	if got := f.levelOf(t, uc.ID, old.Document.DocumentID); got != DocumentLevelComment {
		t.Fatalf("other member = %q, want comment", got)
	}
}

// auditRows lists the audit rows of one action on documentID, oldest first.
func (f *chatDocumentFixture) auditRows(t *testing.T, action, documentID string) []db.AuditEvent {
	t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT id, changes, metadata FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at, id`,
		action, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []db.AuditEvent
	for rows.Next() {
		var e db.AuditEvent
		if err := rows.Scan(&e.ID, &e.Changes, &e.Metadata); err != nil {
			t.Fatal(err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestChatDocumentShareRestoreAndRepointAreAudited is S2: the manual share a
// leave restores and a re-point to another room each leave an audit row in
// the reconcile's transaction, and the restored grant's event names it.
func TestChatDocumentShareRestoreAndRepointAreAudited(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "chatdoc-s2-c@example.com", "C")
	ud := f.reconcileMember(t, "chatdoc-s2-d@example.com", "D")
	roomA := f.reconcileGroup(t, "s2-a", f.ub.ID, uc.ID)
	roomB := f.reconcileGroup(t, "s2-b", f.ub.ID, ud.ID)
	revoker := NewChatDocumentShareRevoker(f.docs)

	// Restore: uc's manual view raised to comment by roomA.
	page, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{Title: "S2", Visibility: "restricted"})
	if err != nil {
		t.Fatal(err)
	}
	restoreDoc := page.Document
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), restoreDoc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: uc.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	msgA := f.documentMessageIn(t, roomA, restoreDoc.ID)
	if err := f.svc.grantDocumentToRoomMembers(ctx, f.q, Human(f.ua.ID),
		DocumentFileResult{Document: restoreDoc}, []string{uc.ID}, DocumentLevelComment, roomA.ID, msgA.ID); err != nil {
		t.Fatal(err)
	}
	sharedBefore := len(f.auditRows(t, "document.shared", restoreDoc.ID))
	if err := f.svc.LeaveChatRoom(ctx, uc.ID, f.ws.ID, roomA.ID); err != nil {
		t.Fatal(err)
	}
	deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": roomA.ID, "user_id": uc.ID})
	restored, ok := f.liveShareOf(t, uc.ID, restoreDoc.ID)
	if !ok || restored.Level != "view" || restored.SourceKind.Valid {
		t.Fatalf("restored share = %+v, want manual view", restored)
	}
	shared := f.auditRows(t, "document.shared", restoreDoc.ID)
	if len(shared) != sharedBefore+1 {
		t.Fatalf("document.shared rows after the restore = %d, want %d", len(shared), sharedBefore+1)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(shared[len(shared)-1].Metadata), &meta); err != nil {
		t.Fatal(err)
	}
	if meta["share_id"] != restored.ID || meta["principal_id"] != uc.ID {
		t.Fatalf("restore audit metadata = %v, want share_id %s", meta, restored.ID)
	}
	if !strings.Contains(shared[len(shared)-1].Changes, `"view"`) {
		t.Fatalf("restore audit changes = %s, want the level view", shared[len(shared)-1].Changes)
	}
	var events int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'share_id' = $1`,
		restored.ID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("document.shared events naming the restored share = %d (%v), want 1", events, err)
	}
	if n := len(f.auditRows(t, "document.share_revoked", restoreDoc.ID)); n != 1 {
		t.Fatalf("document.share_revoked rows = %d, want 1", n)
	}

	// Re-point: ub's chat grant from roomA, roomB also holds the document.
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, roomA.ID, documentMessageInput("s2-repoint"))
	if err != nil {
		t.Fatal(err)
	}
	docID := sent.Document.DocumentID
	msgB := f.documentMessageIn(t, roomB, docID)
	sharedBefore = len(f.auditRows(t, "document.shared", docID))
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, roomA.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": roomA.ID, "user_id": f.ub.ID})
	}
	sh, ok := f.liveShareOf(t, f.ub.ID, docID)
	if !ok || sh.SourceRoomID.String != roomB.ID || sh.SourceMessageID.String != msgB.ID {
		t.Fatalf("re-pointed share = %+v, want room %s message %s", sh, roomB.ID, msgB.ID)
	}
	shared = f.auditRows(t, "document.shared", docID)
	if len(shared) != sharedBefore+1 {
		t.Fatalf("audit rows after the re-point (delivered twice) = %d, want %d", len(shared), sharedBefore+1)
	}
	if !strings.Contains(shared[len(shared)-1].Changes, roomB.ID) {
		t.Fatalf("re-point audit changes = %s, want the new source room", shared[len(shared)-1].Changes)
	}
	if n := len(f.auditRows(t, "document.share_revoked", docID)); n != 0 {
		t.Fatalf("a re-point wrote %d share_revoked rows, want 0", n)
	}
}

// TestChatDocumentGrantSkipsEffectiveHomeRowEdit is S4: a recipient who
// already holds edit through the document's home row (no direct share) gets
// no share and no event from a comment chat grant.
func TestChatDocumentGrantSkipsEffectiveHomeRowEdit(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	page, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{Title: "S4", Visibility: "restricted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), page.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalWorkspace, PrincipalID: f.ws.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("home row edit: %v", err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, page.Document.ID); ok {
		t.Fatal("setup: the recipient must have no direct share")
	}
	if got := f.levelOf(t, f.ub.ID, page.Document.ID); got != DocumentLevelEdit {
		t.Fatalf("setup: recipient level = %q, want edit through the home row", got)
	}
	doc, err := f.q.GetDocumentByID(ctx, page.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	countEvents := func() int {
		var n int
		if err := f.pool.QueryRow(ctx,
			`SELECT count(*) FROM outbox_events WHERE topic = 'document.shared' AND payload::jsonb->>'document_id' = $1`,
			doc.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	eventsBefore := countEvents()
	msg := f.documentMessageIn(t, room, doc.ID)
	if err := f.svc.grantDocumentToRoomMembers(ctx, f.q, Human(f.ua.ID),
		DocumentFileResult{Document: doc}, []string{f.ub.ID}, DocumentLevelComment, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	if sh, ok := f.liveShareOf(t, f.ub.ID, doc.ID); ok {
		t.Fatalf("comment chat grant over home-row edit wrote %+v", sh)
	}
	if got := countEvents(); got != eventsBefore {
		t.Fatalf("document.shared events = %d, want %d (no notice)", got, eventsBefore)
	}
	if got := f.levelOf(t, f.ub.ID, doc.ID); got != DocumentLevelEdit {
		t.Fatalf("recipient level = %q, want edit kept", got)
	}
}
