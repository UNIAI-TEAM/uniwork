package service

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestChatDocumentCardRefresherTopics pins the topic list: every topic is a
// catalogued document.* event and the list is exactly the seven that change a
// card. The lane is chosen where the consumer is registered
// (cmd/server/main.go): the realtime lane, which the one-read handler meets, so
// these topics are not slowed down.
func TestChatDocumentCardRefresherTopics(t *testing.T) {
	want := []string{
		"document.archived", "document.restored", "document.share_revoked", "document.shared",
		"document.updated", "document.version_created", "document.workspace_access_changed",
	}
	got := NewChatDocumentCardRefresher(nil, nil).Topics()
	sort.Strings(got)
	if len(got) != len(want) {
		t.Fatalf("topics = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("topics = %v, want %v", got, want)
		}
		if _, ok := outbox.Lookup(want[i]); !ok {
			t.Fatalf("%s is not in the event catalogue", want[i])
		}
	}
}

// cardMessage inserts a document card for documentID straight into a room, the
// way an old or foreign card sits there.
func (f *chatDocumentFixture) cardMessage(t *testing.T, orgID, wsID, roomID, senderID, documentID string) db.ChatMessage {
	t.Helper()
	meta, err := json.Marshal(map[string]string{"document_id": documentID})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := f.q.CreateChatDocumentMessage(context.Background(), db.CreateChatDocumentMessageParams{
		ID: util.NewID(), RoomID: roomID, WorkspaceID: wsID, SenderID: senderID, SenderKind: "human",
		Body: "", Metadata: meta, OrganizationID: orgID,
	})
	if err != nil {
		t.Fatalf("insert card: %v", err)
	}
	return msg
}

// latestOutboxRow returns the newest outbox row of topic for documentID, the
// one the notify lane would hand to the consumer.
func (f *chatDocumentFixture) latestOutboxRow(t *testing.T, topic, documentID string) outbox.Row {
	t.Helper()
	var row outbox.Row
	err := f.pool.QueryRow(context.Background(),
		`SELECT id, topic, payload, organization_id FROM outbox_events
		 WHERE topic = $1 AND payload::jsonb->>'document_id' = $2
		 ORDER BY created_at DESC, id DESC LIMIT 1`, topic, documentID).
		Scan(&row.ID, &row.Topic, &row.Payload, &row.OrganizationID)
	if err != nil {
		t.Fatalf("read %s outbox row of %s: %v", topic, documentID, err)
	}
	return row
}

// updatedMessageIDs lists the message ids of the chat.message.updated frames.
func updatedMessageIDs(events []Event) []string {
	var ids []string
	for _, ev := range events {
		if ev.Type == "chat.message.updated" {
			ids = append(ids, ev.Payload["message_id"])
		}
	}
	sort.Strings(ids)
	return ids
}

// TestChatDocumentCardRefresherRefreshesEveryLiveCard is the D3-B proof: a
// version commit on a document with cards in two rooms of two workspaces
// publishes chat.message.updated for both messages, and nothing for a deleted
// card or for another organization's card that names the same document id.
func TestChatDocumentCardRefresherRefreshesEveryLiveCard(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	room := f.dm(t)

	in := documentMessageInput("refresh-doc-1")
	in.ShareLevel = "edit"
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("send document: %v", err)
	}
	docID := sent.Document.DocumentID

	// A second card of the same document, in a group of another workspace.
	wsBView, err := f.svc.ws.CreateInOrg(ctx, f.ua.ID, f.orgID, "Refresh WS B", "refresh-ws-b")
	if err != nil {
		t.Fatalf("create ws B: %v", err)
	}
	wsB := wsBView.Workspace
	ue := registerVerified(t, f.q, as, "chatdoc-refresh-e@example.com", "E")
	addOrgMember(t, f.q, f.orgID, ue.ID)
	addWorkspaceMember(t, f.q, wsB.ID, f.ub.ID)
	addWorkspaceMember(t, f.q, wsB.ID, ue.ID)
	groupB, err := f.svc.CreateGroup(ctx, f.ua.ID, wsB.ID, CreateGroupInput{Name: "refresh-b", MemberUserIDs: []string{f.ub.ID, ue.ID}})
	if err != nil {
		t.Fatalf("create group in ws B: %v", err)
	}
	cardB := f.cardMessage(t, f.orgID, wsB.ID, groupB.ID, f.ua.ID, docID)

	// A deleted card of the same document in the first room.
	deleted := f.cardMessage(t, f.orgID, f.ws.ID, room.ID, f.ua.ID, docID)
	if _, err := f.pool.Exec(ctx, `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, deleted.ID); err != nil {
		t.Fatal(err)
	}

	// Another organization's card naming the same document id.
	orgs := NewOrganizationService(f.pool, f.q)
	uc := registerVerified(t, f.q, as, "chatdoc-refresh-c@example.com", "C")
	ud := registerVerified(t, f.q, as, "chatdoc-refresh-d@example.com", "D")
	org2, err := orgs.Create(ctx, uc.ID, "Org Two", "org-refresh-two")
	if err != nil {
		t.Fatal(err)
	}
	ws2View, err := f.svc.ws.CreateInOrg(ctx, uc.ID, org2.ID, "Refresh WS 2", "refresh-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	uf := registerVerified(t, f.q, as, "chatdoc-refresh-f@example.com", "F")
	for _, u := range []db.User{ud, uf} {
		addOrgMember(t, f.q, org2.ID, u.ID)
		addWorkspaceMember(t, f.q, ws2View.Workspace.ID, u.ID)
	}
	group2, err := f.svc.CreateGroup(ctx, uc.ID, ws2View.Workspace.ID, CreateGroupInput{Name: "refresh-2", MemberUserIDs: []string{ud.ID, uf.ID}})
	if err != nil {
		t.Fatalf("create group in org 2: %v", err)
	}
	foreign := f.cardMessage(t, org2.ID, ws2View.Workspace.ID, group2.ID, uc.ID, docID)

	// The existence check S3 uses is scoped to the organization the same way:
	// a card in org 2 does not answer for org 1 or for an unrelated org, and
	// org 1's own cards answer for org 1.
	for _, tc := range []struct {
		org  string
		want bool
	}{{f.orgID, true}, {org2.ID, true}, {util.NewID(), false}} {
		got, err := f.q.OrganizationHasLiveChatDocumentCard(ctx, db.OrganizationHasLiveChatDocumentCardParams{
			OrganizationID: tc.org, DocumentID: docID,
		})
		if err != nil || got != tc.want {
			t.Fatalf("OrganizationHasLiveChatDocumentCard(%s) = %v, %v, want %v", tc.org, got, err, tc.want)
		}
	}

	// A real version commit writes the document.version_created row.
	up2, err := f.docs.UploadDocumentFile(ctx, Human(f.ua.ID), docID, DocumentUploadInput{
		Filename: "ke-hoach.md", Body: bytes.NewReader([]byte("# Kế hoạch v2\n")), IdempotencyKey: "refresh-up-v2",
	})
	if err != nil {
		t.Fatalf("upload v2: %v", err)
	}
	if _, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, CommitFileVersionInput{
		UploadID: up2.UploadID, BaseRevision: 1, IdempotencyKey: "refresh-commit-v2",
	}); err != nil {
		t.Fatalf("commit v2: %v", err)
	}
	row := f.latestOutboxRow(t, "document.version_created", docID)

	f.pub.events = nil
	c := NewChatDocumentCardRefresher(f.q, f.svc)
	if err := c.Handle(ctx, row); err != nil {
		t.Fatalf("handle: %v", err)
	}
	want := []string{sent.ID, cardB.ID}
	sort.Strings(want)
	got := updatedMessageIDs(f.pub.events)
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("chat.message.updated for %v, want %v (deleted %s and foreign %s must stay silent)",
			got, want, deleted.ID, foreign.ID)
	}
	for _, ev := range f.pub.events {
		if ev.Type != "chat.message.updated" {
			continue
		}
		if len(ev.Payload) != 2 || ev.Payload["room_id"] == "" || ev.Payload["message_id"] == "" {
			t.Fatalf("payload = %v, want exactly room_id and message_id", ev.Payload)
		}
	}

	// A replay publishes the same two frames and nothing else: the signal is
	// ephemeral and idempotent.
	f.pub.events = nil
	if err := c.Handle(ctx, row); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if again := updatedMessageIDs(f.pub.events); len(again) != 2 {
		t.Fatalf("replay published %v, want the same two cards", again)
	}

	// Deleting the foreign card empties org 2 for the existence check.
	if _, err := f.pool.Exec(ctx, `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, foreign.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := f.q.OrganizationHasLiveChatDocumentCard(ctx, db.OrganizationHasLiveChatDocumentCardParams{
		OrganizationID: org2.ID, DocumentID: docID,
	}); err != nil || got {
		t.Fatalf("org 2 after its card is deleted = %v, %v, want false", got, err)
	}
}

// TestChatDocumentCardRefresherIgnoresRowsWithoutACard covers the quiet paths:
// a document nobody shared into chat, and a row missing its document id.
func TestChatDocumentCardRefresherIgnoresRowsWithoutACard(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	c := NewChatDocumentCardRefresher(f.q, f.svc)

	f.pub.events = nil
	for _, row := range []outbox.Row{
		{ID: "r1", Topic: "document.updated", Payload: `{"document_id":"` + util.NewID() + `"}`, OrganizationID: pgtype.Text{String: f.orgID, Valid: true}},
		{ID: "r2", Topic: "document.updated", Payload: `{}`, OrganizationID: pgtype.Text{String: f.orgID, Valid: true}},
		{ID: "r3", Topic: "document.updated", Payload: `{"document_id":"x"}`},
	} {
		if err := c.Handle(ctx, row); err != nil {
			t.Fatalf("handle %s: %v", row.ID, err)
		}
	}
	if len(f.pub.events) != 0 {
		t.Fatalf("published %+v, want nothing", f.pub.events)
	}
	if err := c.Handle(ctx, outbox.Row{ID: "bad", Payload: "{"}); err == nil {
		t.Fatal("a malformed payload must fail so the outbox retries it")
	}
}
