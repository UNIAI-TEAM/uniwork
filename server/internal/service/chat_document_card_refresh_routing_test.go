package service

import (
	"bytes"
	"context"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// rowFor builds the outbox row the consumer would claim for documentID.
func (f *chatDocumentFixture) rowFor(documentID string) outbox.Row {
	return outbox.Row{
		ID: "row-" + documentID, Topic: "document.updated",
		Payload:        `{"document_id":"` + documentID + `"}`,
		OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
	}
}

// TestChatDocumentCardRefresherRoutesLikeAMessageChange pins that the one-read
// consumer sends each room kind the frames publishChatMessageChange would: the
// default channel's to its workspace, another channel's to chat:{room} alone,
// and a DM's or group's to chat:{room} plus one chat.room.activity batch to its
// members. A document with two cards in one room still gives that room one
// activity batch.
func TestChatDocumentCardRefresherRoutesLikeAMessageChange(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ue := registerVerified(t, f.q, as, "chatdoc-route-e@example.com", "E")
	addOrgMember(t, f.q, f.orgID, ue.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, ue.ID)

	dm := f.dm(t)
	groupSum, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "route-group", MemberUserIDs: []string{f.ub.ID, ue.ID}})
	if err != nil {
		t.Fatal(err)
	}
	channelSum, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{Name: "route-channel", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.EnsureWorkspaceRoom(ctx, f.ua.ID, f.ws.ID); err != nil {
		t.Fatal(err)
	}
	rooms := map[string]string{
		"dm": dm.ID, "group": groupSum.ID, "channel": channelSum.ID,
		"default": mustDefaultRoomID(t, f.q, f.ws.ID),
	}
	c := NewChatDocumentCardRefresher(f.q, f.svc)
	for name, roomID := range rooms {
		room, err := f.q.GetChatRoomByID(ctx, roomID)
		if err != nil {
			t.Fatal(err)
		}
		docID := "route-doc-" + name
		card := f.cardMessage(t, f.orgID, f.ws.ID, roomID, f.ua.ID, docID)

		f.pub.sent, f.pub.batches = nil, nil
		f.svc.publishChatMessageUpdated(ctx, room, card.ID)
		wantSent, wantBatches := f.pub.sent, f.pub.batches
		f.pub.sent, f.pub.batches = nil, nil
		if err := c.Handle(ctx, f.rowFor(docID)); err != nil {
			t.Fatalf("%s: handle: %v", name, err)
		}
		if len(wantSent) == 0 || !reflect.DeepEqual(f.pub.sent, wantSent) || !reflect.DeepEqual(f.pub.batches, wantBatches) {
			t.Fatalf("%s: refresher sent %v / %v, a message change sends %v / %v",
				name, f.pub.sent, f.pub.batches, wantSent, wantBatches)
		}
	}

	// Two cards of one document in the DM: two refresh frames, one activity batch.
	f.cardMessage(t, f.orgID, f.ws.ID, dm.ID, f.ua.ID, "route-doc-twice")
	f.cardMessage(t, f.orgID, f.ws.ID, dm.ID, f.ub.ID, "route-doc-twice")
	f.pub.sent, f.pub.batches = nil, nil
	if err := c.Handle(ctx, f.rowFor("route-doc-twice")); err != nil {
		t.Fatal(err)
	}
	if n := len(f.pub.sentTo("chat.message.updated")); n != 2 {
		t.Fatalf("refresh frames = %d, want 2", n)
	}
	if !reflect.DeepEqual(f.pub.batches, []string{"chat.room.activity"}) {
		t.Fatalf("activity batches = %v, want exactly one", f.pub.batches)
	}
}

// TestChatDocumentCardRefresherSkipsACardWhoseRoomIsAnotherOrganization proves
// the room guard is the query's own join: a card of this organization that
// points at a room of another one never produces a frame.
func TestChatDocumentCardRefresherSkipsACardWhoseRoomIsAnotherOrganization(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	roomID := util.NewID()
	if _, err := f.q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID: roomID, Kind: "channel", WorkspaceID: pgtype.Text{String: f.ws.ID, Valid: true},
		OrganizationID: util.NewID(), Name: "Elsewhere", LivekitRoomName: "lk-" + roomID,
		CreatedBy: f.ua.ID, CreatedByKind: "human", Visibility: "public",
	}); err != nil {
		t.Fatal(err)
	}
	f.cardMessage(t, f.orgID, f.ws.ID, roomID, f.ua.ID, "guard-doc")

	f.pub.events = nil
	if err := NewChatDocumentCardRefresher(f.q, f.svc).Handle(ctx, f.rowFor("guard-doc")); err != nil {
		t.Fatal(err)
	}
	if len(f.pub.events) != 0 {
		t.Fatalf("published %+v for a room of another organization, want nothing", f.pub.events)
	}
}

// TestChatDocumentCardRefresherTruncatesAtTheCap seeds one card more than the
// cap: the newest 500 are refreshed, the oldest is dropped, the drop is logged
// with its count (ids and numbers only), and the room's activity batch is sent
// once, not once per card.
func TestChatDocumentCardRefresherTruncatesAtTheCap(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	var oldest string
	for i := 0; i <= chatDocumentCardRefreshCap; i++ {
		id := f.cardMessage(t, f.orgID, f.ws.ID, room.ID, f.ua.ID, "cap-doc").ID
		if i == 0 {
			oldest = id
		}
	}

	var logs bytes.Buffer
	c := NewChatDocumentCardRefresher(f.q, f.svc)
	c.log = slog.New(slog.NewTextHandler(&logs, nil))
	f.pub.events, f.pub.batches = nil, nil
	if err := c.Handle(ctx, f.rowFor("cap-doc")); err != nil {
		t.Fatal(err)
	}
	got := updatedMessageIDs(f.pub.events)
	if len(got) != chatDocumentCardRefreshCap {
		t.Fatalf("refreshed %d cards, want the cap %d", len(got), chatDocumentCardRefreshCap)
	}
	for _, id := range got {
		if id == oldest {
			t.Fatalf("the oldest card %s was refreshed; the newest cards go first", oldest)
		}
	}
	line := logs.String()
	for _, want := range []string{"chat document card refresh truncated", "dropped=1", "cap=500", "document_id=cap-doc"} {
		if !strings.Contains(line, want) {
			t.Fatalf("overflow log %q lacks %q", line, want)
		}
	}
	if !reflect.DeepEqual(f.pub.batches, []string{"chat.room.activity"}) {
		t.Fatalf("activity batches = %v, want one for the room", f.pub.batches)
	}

	// Exactly at the cap nothing is dropped, so nothing is logged.
	if _, err := f.pool.Exec(ctx, `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, oldest); err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	if err := c.Handle(ctx, f.rowFor("cap-doc")); err != nil {
		t.Fatal(err)
	}
	if logs.Len() != 0 {
		t.Fatalf("a refresh within the cap logged %q", logs.String())
	}
}
