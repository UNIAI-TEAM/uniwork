package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestChatHistoryPagingKeepsSameInstantMessages(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	const total = 25
	for i := 0; i < total; i++ {
		if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: fmt.Sprintf("m%d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	// A burst of uploads lands in the same second; make the worst case exact ties.
	if _, err := s.pool.Exec(ctx,
		`UPDATE chat_messages SET created_at = '2026-01-01T10:00:00.123456Z' WHERE room_id = $1`, roomID); err != nil {
		t.Fatal(err)
	}

	seen := map[string]bool{}
	in := ListChatMessagesInput{Limit: 7}
	for page := 0; page < total; page++ {
		rows, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, in)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) == 0 {
			break
		}
		for _, r := range rows {
			if seen[r.ID] {
				t.Fatalf("message %s returned twice", r.ID)
			}
			seen[r.ID] = true
		}
		oldest := rows[0]
		in = ListChatMessagesInput{Limit: 7, Cursor: oldest.Cursor()}
	}
	if len(seen) != total {
		t.Fatalf("paged %d of %d messages", len(seen), total)
	}

	// Forward from the oldest page's first row: the same messages, oldest first.
	first, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, ListChatMessagesInput{Limit: total})
	if err != nil || len(first) != total {
		t.Fatalf("all rows: %d %v", len(first), err)
	}
	after := ListChatMessagesInput{Limit: 7, After: first[0].Cursor()}
	forward := []string{first[0].ID}
	for len(forward) < total {
		rows, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, after)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) == 0 {
			break
		}
		for _, r := range rows {
			forward = append(forward, r.ID)
		}
		after.After = rows[len(rows)-1].Cursor()
	}
	for i, r := range first {
		if i >= len(forward) || forward[i] != r.ID {
			t.Fatalf("forward paging diverged at %d: %v", i, forward)
		}
	}
	if _, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, ListChatMessagesInput{
		After: first[0].Cursor(), Cursor: first[0].Cursor(),
	}); !errors.As(err, new(ValidationError)) {
		t.Fatalf("after with cursor: %v", err)
	}
}
