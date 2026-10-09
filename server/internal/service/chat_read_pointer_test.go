package service

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestChatLastReadNeverMovesBackwards(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	for i := 0; i < 2; i++ {
		if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: fmt.Sprintf("m%d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	newest := latest[len(latest)-1]
	// A late writer carrying an older timestamp must not rewind the pointer.
	if err := q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: roomID, UserID: ua.ID, LastReadAt: pgtype.Timestamptz{Time: latest[0].CreatedAt, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	mem, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: roomID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !mem.LastReadAt.Time.Equal(newest.CreatedAt) {
		t.Fatalf("last_read_at=%v, want %v", mem.LastReadAt.Time, newest.CreatedAt)
	}
}
