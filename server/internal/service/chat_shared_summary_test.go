package service

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// The summary counts what the client's shared-media sorter would find on the
// whole main timeline: deleted messages, thread replies and stickers do not
// count, every URL in a text body is one link, and the newest photos come
// back with signed URLs.
func TestRoomSharedSummaryCountsEachKind(t *testing.T) {
	s, _, _, ua, ub, w := chatFixture(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	send := func(body string) ChatMessageRow {
		t.Helper()
		row, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	sendFile := func(name string, body []byte) ChatMessageRow {
		t.Helper()
		row, err := s.SendFileMessage(ctx, ua.ID, w.ID, room.RoomID, SendFileMessageInput{
			Filename: name, Body: bytes.NewReader(body),
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}

	gone := sendFile("xoa.png", pngBody(t, 3, 3))
	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, room.RoomID, gone.ID); err != nil {
		t.Fatal(err)
	}
	photo := sendFile("banner.png", pngBody(t, 2, 2))
	sendFile("ke-hoach.pdf", tinyFSFileBytes)
	if _, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, room.RoomID, SendVoiceMessageInput{
		DurationMS: 4_000, Body: bytes.NewReader(tinyFSVoiceBytes),
	}); err != nil {
		t.Fatal(err)
	}
	root := send("Xem https://uniwork.vn/q4, và HTTP://docs.uniwork.vn/lich.")
	send("không có liên kết")
	send("![gif:vỗ tay](https://media.tenor.com/abc/clap.gif)")
	send("![sticker:ăn mừng](https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png)")
	picked := send("![mèo](https://media.tenor.com/abc/cat.png)")
	if _, err := s.SendThreadReply(ctx, ua.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "https://thread.vn"}); err != nil {
		t.Fatal(err)
	}

	got, err := s.RoomSharedSummary(ctx, ua.ID, w.ID, room.RoomID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Photos != 2 || got.GIFs != 1 || got.Videos != 0 || got.Files != 1 || got.Links != 2 || got.Voices != 1 {
		t.Fatalf("counts = %+v, want photo 2, gif 1, file 1, link 2, voice 1", got)
	}
	if len(got.RecentPhotos) != 2 {
		t.Fatalf("recent photos = %+v, want 2", got.RecentPhotos)
	}
	newest, older := got.RecentPhotos[0], got.RecentPhotos[1]
	if newest.MessageID != picked.ID || newest.FileID != "" || newest.URL != "https://media.tenor.com/abc/cat.png" || newest.Title != "mèo" {
		t.Fatalf("newest = %+v, want the picker image with its public URL", newest)
	}
	if older.MessageID != photo.ID || older.FileID != photo.File.FileID || older.URL == "" || older.Title != "banner.png" {
		t.Fatalf("older = %+v, want the attachment signed for the viewer", older)
	}

	if _, err := s.RoomSharedSummary(ctx, ub.ID, w.ID, room.RoomID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member: err=%v, want ErrForbidden or ErrNotFound", err)
	}
}

func TestRoomSharedSummaryOfAnEmptyRoom(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.RoomSharedSummary(ctx, ua.ID, w.ID, room.RoomID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Photos+got.GIFs+got.Videos+got.Files+got.Links+got.Voices != 0 || got.RecentPhotos == nil || len(got.RecentPhotos) != 0 {
		t.Fatalf("empty room = %+v", got)
	}
}
