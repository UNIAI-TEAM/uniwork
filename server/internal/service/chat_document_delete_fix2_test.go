package service

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The UNI-2012 S1-fix-2 regressions for deleting a document message: the
// revokes are set-based (SF1), the link path lowers to the backing level (SF3)
// and skips deactivated members (SF5), and the refusal, manual-share and
// concurrency paths are pinned (SF6).

// seedChannelMembers adds n fresh organization, workspace and room members to
// room in four statements and answers their ids.
func (f *chatDocumentFixture) seedChannelMembers(t *testing.T, room db.ChatRoom, n int, tag string) []string {
	t.Helper()
	ctx := context.Background()
	ids := make([]string, n)
	emails := make([]string, n)
	names := make([]string, n)
	rowIDs := make([]string, n)
	for i := range n {
		ids[i] = util.NewID()
		emails[i] = fmt.Sprintf("chatdoc-%s-%04d-%s@example.com", tag, i, ids[i])
		names[i] = fmt.Sprintf("%s %04d", tag, i)
		rowIDs[i] = util.NewID()
	}
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		  SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()`, []any{ids, emails, names}},
		{`INSERT INTO organization_members (organization_id, user_id, role)
		  SELECT $1, unnest($2::text[]), 'member'`, []any{f.orgID, ids}},
		{`INSERT INTO workspace_members (workspace_id, user_id, role, organization_id)
		  SELECT $1, unnest($2::text[]), 'member', $3`, []any{f.ws.ID, ids, f.orgID}},
		{`INSERT INTO chat_room_members (id, room_id, workspace_id, user_id, role, status, organization_id, joined_at, created_at, updated_at)
		  SELECT unnest($1::text[]), $2, $3, unnest($4::text[]), 'member', 'active', $5, now(), now(), now()`,
			[]any{rowIDs, room.ID, f.ws.ID, ids, f.orgID}},
	} {
		if _, err := f.pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatalf("seed %d members: %v", n, err)
		}
	}
	return ids
}

// TestDeleteDocumentMessage1000Recipients is SF1: deleting an upload card of a
// 1,000-member channel revokes every grant with one audit and one outbox row
// each, and deleting a link card whose grants a second card backs re-points
// all of them, both in bounded time with the tree lock held.
func TestDeleteDocumentMessage1000Recipients(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	sum, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{Name: "delete-1000", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	ch, err := f.q.GetChatRoomByID(ctx, sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	const n = 1000
	f.seedChannelMembers(t, ch, n, "del1000")
	// The bound is a hang guard; the timing is logged, not asserted.
	bounded, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	sent, err := f.svc.SendDocumentMessage(bounded, f.ua.ID, f.ws.ID, ch.ID, documentMessageInput("del-1000-upload"))
	if err != nil {
		t.Fatal(err)
	}
	docID := sent.Document.DocumentID
	if got := len(f.liveSharesOfDocument(t, docID)); got != n {
		t.Fatalf("setup live shares = %d, want %d", got, n)
	}
	started := time.Now()
	if err := f.svc.DeleteChatMessage(bounded, f.ua.ID, f.ws.ID, ch.ID, sent.ID); err != nil {
		t.Fatalf("delete upload card: %v", err)
	}
	uploadElapsed := time.Since(started)
	if got := len(f.liveSharesOfDocument(t, docID)); got != 0 {
		t.Fatalf("live shares after the delete = %d, want 0", got)
	}
	if got := len(f.auditRows(t, audit.ActionDocumentShareRevoked, docID)); got != n {
		t.Fatalf("share_revoked audit rows = %d, want %d", got, n)
	}
	if got := f.countOutboxFor(t, "document.share_revoked", docID); got != n {
		t.Fatalf("share_revoked outbox rows = %d, want %d", got, n)
	}
	if meta := f.chatDeleteAuditMeta(t, sent.ID); meta["document_shares_revoked"] != float64(n) || meta["document_archived"] != true {
		t.Fatalf("delete audit = %+v", meta)
	}

	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Một nghìn")
	first, err := f.svc.SendDocumentLinkMessage(bounded, f.ua.ID, f.ws.ID, ch.ID, linkInput(page.ID, "del-1000-link-1"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.SendDocumentLinkMessage(bounded, f.ua.ID, f.ws.ID, ch.ID, linkInput(page.ID, "del-1000-link-2"))
	if err != nil {
		t.Fatal(err)
	}
	started = time.Now()
	if err := f.svc.DeleteChatMessage(bounded, f.ua.ID, f.ws.ID, ch.ID, first.ID); err != nil {
		t.Fatalf("delete link card: %v", err)
	}
	linkElapsed := time.Since(started)
	shares := f.liveSharesOfDocument(t, page.ID)
	if len(shares) != n {
		t.Fatalf("live shares after the link delete = %d, want %d", len(shares), n)
	}
	for _, sh := range shares {
		if sh.SourceMessageID.String != second.ID || sh.Level != string(DocumentLevelComment) {
			t.Fatalf("share after the link delete = %+v, want re-pointed to the second card", sh)
		}
	}
	if got := f.countRows(t,
		`SELECT count(*) FROM audit_events WHERE resource_id = $1 AND metadata::jsonb->>'transition' = 'chat_source_repointed'`, page.ID); got != n {
		t.Fatalf("re-point audit rows = %d, want %d", got, n)
	}
	t.Logf("delete document message, %d recipients: upload (trash + revoke) = %s, link (re-point) = %s", n, uploadElapsed, linkElapsed)
}

// TestDeleteUploadDocumentMessageKeepsManualAndRestoresRaised pins the manual
// side of an upload delete: a manual share given after the send survives, and
// a manual level a chat grant had raised comes back.
func TestDeleteUploadDocumentMessageKeepsManualAndRestoresRaised(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.thirdMember(t, "chatdoc-delmanual-c@example.com")
	ud := f.thirdMember(t, "chatdoc-delmanual-d@example.com")
	grp := f.group(t, f.ub.ID, f.filler(t).ID)
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, documentMessageInput("del-manual-1"))
	if err != nil {
		t.Fatal(err)
	}
	docID := sent.Document.DocumentID
	// uc holds manual view, then a second card in a room of uc's raises it to edit.
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: uc.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	other := f.group(t, uc.ID, f.filler(t).ID)
	editIn := linkInput(docID, "del-manual-raise")
	editIn.ShareLevel = "edit"
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, other.ID, editIn); err != nil {
		t.Fatal(err)
	}
	if sh, ok := f.liveShareOf(t, uc.ID, docID); !ok || sh.PriorManualLevel.String != "view" {
		t.Fatalf("setup uc share = %+v, want a chat edit remembering view", sh)
	}
	// ud holds a manual share only.
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID, Level: DocumentLevelComment,
	}); err != nil {
		t.Fatal(err)
	}

	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, sent.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
		t.Fatal("ub's chat grant survived the upload delete")
	}
	if sh, ok := f.liveShareOf(t, uc.ID, docID); !ok || sh.Level != "view" || sh.SourceKind.Valid {
		t.Fatalf("uc share = %+v, want the manual view restored", sh)
	}
	if sh, ok := f.liveShareOf(t, ud.ID, docID); !ok || sh.Level != "comment" || sh.SourceKind.Valid {
		t.Fatalf("ud share = %+v, want the manual comment untouched", sh)
	}
	if meta := f.chatDeleteAuditMeta(t, sent.ID); meta["document_shares_revoked"] != float64(3) {
		t.Fatalf("delete audit = %+v, want 3 revoked (ub, uc, the filler)", meta)
	}
}

// TestDeleteUploadDocumentMessageWhenTheDocumentCannotGo is the refusal side
// of S1d: an owned document, one already in the trash and one already purged
// stay as they are, the message is deleted, every chat grant still goes, and
// the audit row says document_archived=false.
func TestDeleteUploadDocumentMessageWhenTheDocumentCannotGo(t *testing.T) {
	cases := map[string]func(t *testing.T, f *chatDocumentFixture, docID string){
		"owned": func(t *testing.T, f *chatDocumentFixture, docID string) {
			if _, err := f.pool.Exec(context.Background(),
				`UPDATE documents SET owner_kind = 'work_product', owner_id = 'wp-del' WHERE id = $1`, docID); err != nil {
				t.Fatal(err)
			}
		},
		"already trashed": func(t *testing.T, f *chatDocumentFixture, docID string) {
			if _, err := f.docs.ArchiveDocument(context.Background(), Human(f.ua.ID), docID, ArchiveDocumentInput{}); err != nil {
				t.Fatal(err)
			}
		},
		"purged": func(t *testing.T, f *chatDocumentFixture, docID string) {
			ctx := context.Background()
			if _, err := f.docs.ArchiveDocument(ctx, Human(f.ua.ID), docID, ArchiveDocumentInput{}); err != nil {
				t.Fatal(err)
			}
			if _, err := f.docs.PurgeDocument(ctx, Human(f.ua.ID), docID); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, prepare := range cases {
		t.Run(name, func(t *testing.T) {
			f := newChatDocumentFixture(t)
			ctx := context.Background()
			room := f.dm(t)
			sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("del-refused-1"))
			if err != nil {
				t.Fatal(err)
			}
			docID := sent.Document.DocumentID
			prepare(t, f, docID)
			before, beforeErr := f.q.GetDocumentByID(ctx, docID)

			if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, sent.ID); err != nil {
				t.Fatalf("delete: %v", err)
			}
			if n := f.countRows(t, `SELECT count(*) FROM chat_messages WHERE id = $1 AND deleted_at IS NOT NULL`, sent.ID); n != 1 {
				t.Fatal("the message was not deleted")
			}
			after, afterErr := f.q.GetDocumentByID(ctx, docID)
			if (beforeErr == nil) != (afterErr == nil) || after.ArchivedAt.Valid != before.ArchivedAt.Valid ||
				!after.ArchivedAt.Time.Equal(before.ArchivedAt.Time) {
				t.Fatalf("document moved: before %v/%v, after %v/%v", before.ArchivedAt, beforeErr, after.ArchivedAt, afterErr)
			}
			if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
				t.Fatal("a chat grant survived the delete")
			}
			if meta := f.chatDeleteAuditMeta(t, sent.ID); meta["document_archived"] != false || meta["document_id"] != docID {
				t.Fatalf("delete audit = %+v, want document_archived=false", meta)
			}
		})
	}
}

// TestDeleteLinkDocumentMessageSkipsDeactivatedMember is SF5: a deactivated
// member's grant from a deleted link card is left alone, as the member-left
// reconcile leaves it, so reactivation finds it in place.
func TestDeleteLinkDocumentMessageSkipsDeactivatedMember(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	grp := f.group(t, f.ub.ID, f.filler(t).ID)
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Tạm ngưng")
	dmMsg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(page.ID, "deact-dm"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, linkInput(page.ID, "deact-grp")); err != nil {
		t.Fatal(err)
	}
	before, ok := f.liveShareOf(t, f.ub.ID, page.ID)
	if !ok || before.SourceMessageID.String != dmMsg.ID {
		t.Fatalf("setup share = %+v, want it sourced by the DM card", before)
	}
	members := NewOrganizationMemberService(f.pool, f.q, f.docs.orgs)
	if _, err := members.Deactivate(ctx, f.ua.ID, f.orgID, f.ub.ID); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, dmMsg.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	after, ok := f.liveShareOf(t, f.ub.ID, page.ID)
	if !ok || after.ID != before.ID {
		t.Fatalf("share after the delete = %+v, want the deactivated member's grant untouched", after)
	}
	if _, err := members.Reactivate(ctx, f.ua.ID, f.orgID, f.ub.ID); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	if got := f.levelOf(t, f.ub.ID, page.ID); got != DocumentLevelComment {
		t.Fatalf("level after reactivation = %q, want comment", got)
	}
}

// TestDeleteLinkDocumentMessageRacingReconcileAndLinkSend is the concurrency
// barrier: a link-card delete, a member-left reconcile and a link send of the
// same document serialise on the document lock, and every order ends where the
// rule says. ub got comment from the DM card, then edit from a group card;
// ub leaves the group.
func TestDeleteLinkDocumentMessageRacingReconcileAndLinkSend(t *testing.T) {
	type setup struct {
		f     *chatDocumentFixture
		room  db.ChatRoom
		dmMsg ChatMessageRow
		docID string
	}
	prepare := func(t *testing.T) setup {
		f := newChatDocumentFixture(t)
		ctx := context.Background()
		room := f.dm(t)
		grp := f.group(t, f.ub.ID, f.filler(t).ID)
		page := f.linkPage(t, f.ua.ID, f.ws.ID, "Đua khóa")
		dmMsg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(page.ID, "race-dm-card"))
		if err != nil {
			t.Fatal(err)
		}
		editIn := linkInput(page.ID, "race-grp-card")
		editIn.ShareLevel = "edit"
		if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, editIn); err != nil {
			t.Fatal(err)
		}
		if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, grp.ID); err != nil {
			t.Fatal(err)
		}
		return setup{f: f, room: room, dmMsg: dmMsg, docID: page.ID}
	}
	pause := func() (func(), chan struct{}, chan struct{}) {
		paused, resume := make(chan struct{}), make(chan struct{})
		var once sync.Once
		return func() {
			once.Do(func() {
				close(paused)
				<-resume
			})
		}, paused, resume
	}
	await := func(t *testing.T, what string, ch <-chan error) {
		t.Helper()
		select {
		case err := <-ch:
			if err != nil {
				t.Fatalf("%s: %v", what, err)
			}
		case <-time.After(15 * time.Second):
			t.Fatalf("%s did not finish", what)
		}
	}
	reached := func(t *testing.T, what string, paused <-chan struct{}) {
		t.Helper()
		select {
		case <-paused:
		case <-time.After(10 * time.Second):
			t.Fatalf("%s never reached the pause", what)
		}
	}

	t.Run("reconcile holds the lock, delete waits", func(t *testing.T) {
		s := prepare(t)
		ctx := context.Background()
		seam, paused, resume := pause()
		chatShareReconcileBeforeCommit = seam
		t.Cleanup(func() { chatShareReconcileBeforeCommit = nil })
		reconciled := make(chan error, 1)
		go func() { reconciled <- s.f.docs.ReconcileChatDocumentSharesForMember(ctx, s.f.orgID, s.f.ub.ID) }()
		reached(t, "the reconcile", paused)
		deleted := make(chan error, 1)
		go func() { deleted <- s.f.svc.DeleteChatMessage(ctx, s.f.ua.ID, s.f.ws.ID, s.room.ID, s.dmMsg.ID) }()
		waitForLockWaiterOn(t, s.f, "LockDocumentByID")
		close(resume)
		await(t, "reconcile", reconciled)
		await(t, "delete", deleted)
		if got := s.f.levelOf(t, s.f.ub.ID, s.docID); got != DocumentLevelNone {
			t.Fatalf("level = %q, want none: the reconcile lowered to the DM card, the delete then revoked", got)
		}
	})

	t.Run("delete holds the lock, reconcile waits", func(t *testing.T) {
		s := prepare(t)
		ctx := context.Background()
		seam, paused, resume := pause()
		chatDocumentDeleteAfterLock = seam
		t.Cleanup(func() { chatDocumentDeleteAfterLock = nil })
		deleted := make(chan error, 1)
		go func() { deleted <- s.f.svc.DeleteChatMessage(ctx, s.f.ua.ID, s.f.ws.ID, s.room.ID, s.dmMsg.ID) }()
		reached(t, "the delete", paused)
		reconciled := make(chan error, 1)
		go func() { reconciled <- s.f.docs.ReconcileChatDocumentSharesForMember(ctx, s.f.orgID, s.f.ub.ID) }()
		waitForLockWaiterOn(t, s.f, "LockDocumentByID")
		close(resume)
		await(t, "delete", deleted)
		await(t, "reconcile", reconciled)
		if got := s.f.levelOf(t, s.f.ub.ID, s.docID); got != DocumentLevelNone {
			t.Fatalf("level = %q, want none: nothing backs the grant after both", got)
		}
	})

	t.Run("delete holds the lock, a link send waits", func(t *testing.T) {
		s := prepare(t)
		ctx := context.Background()
		// The member-left reconcile ran first here: ub holds comment from the DM card.
		if err := s.f.docs.ReconcileChatDocumentSharesForMember(ctx, s.f.orgID, s.f.ub.ID); err != nil {
			t.Fatal(err)
		}
		seam, paused, resume := pause()
		chatDocumentDeleteAfterLock = seam
		t.Cleanup(func() { chatDocumentDeleteAfterLock = nil })
		deleted := make(chan error, 1)
		go func() { deleted <- s.f.svc.DeleteChatMessage(ctx, s.f.ua.ID, s.f.ws.ID, s.room.ID, s.dmMsg.ID) }()
		reached(t, "the delete", paused)
		var resent ChatMessageRow
		sent := make(chan error, 1)
		go func() {
			var err error
			resent, err = s.f.svc.SendDocumentLinkMessage(ctx, s.f.ua.ID, s.f.ws.ID, s.room.ID, linkInput(s.docID, "race-resend"))
			sent <- err
		}()
		waitForLockWaiterOn(t, s.f, "LockDocumentByID")
		close(resume)
		await(t, "delete", deleted)
		await(t, "link send", sent)
		sh, ok := s.f.liveShareOf(t, s.f.ub.ID, s.docID)
		if !ok || sh.Level != string(DocumentLevelComment) || sh.SourceMessageID.String != resent.ID {
			t.Fatalf("share = %+v, want comment from the card sent after the delete", sh)
		}
	})
}
