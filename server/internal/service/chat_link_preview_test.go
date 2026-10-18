package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/linkpreview"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type stubPreviewFetcher struct {
	calls   []string
	preview linkpreview.Preview
	err     error
}

func (f *stubPreviewFetcher) Fetch(_ context.Context, raw string) (linkpreview.Preview, error) {
	f.calls = append(f.calls, raw)
	return f.preview, f.err
}

func TestFirstPreviewURL(t *testing.T) {
	for body, want := range map[string]string{
		"Bài blog đã lên: https://uniwork.vn/blog/ra-mat-q4.": "https://uniwork.vn/blog/ra-mat-q4",
		"hai link http://a.vn/x?y=1) và https://b.vn":         "http://a.vn/x?y=1",
		"[@Lan](mention://user/01J) xem https://a.vn/p#top":   "https://a.vn/p#top",
		"![gif](https://media.tenor.com/abc.gif)":             "",
		"không có link, chỉ mention://all/all":                "",
		"ftp://a.vn/file": "",
	} {
		if got := firstPreviewURL(body); got != want {
			t.Errorf("firstPreviewURL(%q) = %q, want %q", body, got, want)
		}
	}
	if key, _ := previewURLKey("HTTPS://UniWork.VN/Blog#top"); key != "https://uniwork.vn/Blog" {
		t.Errorf("previewURLKey = %q", key)
	}
}

// linkPreviewRequests returns the queued chat.link_preview.requested rows, oldest first.
func linkPreviewRequests(t *testing.T, pool *pgxpool.Pool) []outbox.Row {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT id, payload FROM outbox_events WHERE topic = $1 ORDER BY created_at, id`, topicChatLinkPreviewRequested)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []outbox.Row
	for rows.Next() {
		var r outbox.Row
		if err := rows.Scan(&r.ID, &r.Payload); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func TestChatLinkPreviewIsFetchedOncePerURLAndShownToTheRoom(t *testing.T) {
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	send := func(body string) ChatMessageRow {
		t.Helper()
		m, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	first := send("Bài blog: https://uniwork.vn/blog/ra-mat-q4#gioi-thieu")
	send("không có liên kết")
	second := send("đọc lại https://UNIWORK.VN/blog/ra-mat-q4 nhé")
	reqs := linkPreviewRequests(t, pool)
	if len(reqs) != 2 {
		t.Fatalf("queued %d requests, want one per message with a link", len(reqs))
	}

	fetch := &stubPreviewFetcher{preview: linkpreview.Preview{
		Title: "UniWork Q4", Description: "Làm việc cùng AI", SiteName: "uniwork.vn",
		Image: &linkpreview.Image{Bytes: workspaceIconPNG, ContentType: "image/png"},
	}}
	c := NewChatLinkPreviewConsumer(s, fetch)
	for _, r := range append(reqs, reqs[0]) { // the last one is a redelivery
		if err := c.Handle(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	if !slices.Equal(fetch.calls, []string{"https://uniwork.vn/blog/ra-mat-q4"}) {
		t.Fatalf("fetched %v, want the URL once without its fragment", fetch.calls)
	}
	if got := pub.sentTo("chat.message.preview_ready"); len(got) != 2 || got[0] != "workspace:"+w.ID {
		t.Fatalf("preview_ready went to %v, want the default channel's workspace once per message", got)
	}

	previews, err := s.ListRoomLinkPreviews(ctx, ua.ID, w.ID, room.RoomID, []string{first.ID, second.ID, first.ID, " ", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(previews) != 2 {
		t.Fatalf("previews = %+v", previews)
	}
	for _, p := range previews {
		if p.Title != "UniWork Q4" || p.SiteName != "uniwork.vn" || !strings.HasPrefix(p.ImageURL, "fake://presign/") {
			t.Fatalf("preview = %+v", p)
		}
	}

	stored, err := q.GetChatLinkPreviewByURL(ctx, db.GetChatLinkPreviewByURLParams{
		OrganizationID: w.OrganizationID, UrlHash: mustHash("https://uniwork.vn/blog/ra-mat-q4"),
	})
	if err != nil || stored.Status != chatLinkPreviewOK || !stored.ImageFileID.Valid {
		t.Fatalf("stored = %+v err=%v", stored, err)
	}
	held, err := ChatLinkPreviewImageProvider{}.HeldBy(ctx, q, []files.FileID{files.FileID(stored.ImageFileID.String), "other"})
	if err != nil || len(held) != 1 {
		t.Fatalf("held = %v err=%v, want the stored picture", held, err)
	}

	// Someone who cannot read the room learns nothing, and a batch is capped.
	if _, err := s.ListRoomLinkPreviews(ctx, ub.ID, w.ID, room.RoomID, []string{first.ID}); err == nil {
		t.Fatal("a non-member read the room's previews")
	}
	tooMany := make([]string, maxRoomLinkPreviewIDs+1)
	for i := range tooMany {
		tooMany[i] = strings.Repeat("x", i+1)
	}
	if _, err := s.ListRoomLinkPreviews(ctx, ua.ID, w.ID, room.RoomID, tooMany); err == nil {
		t.Fatal("an oversized batch was answered")
	}
}

func TestChatLinkPreviewKeepsARefusalAndRetriesAFailureAfterAnHour(t *testing.T) {
	s, pub, _, ua, _, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	handleNew := func(c *ChatLinkPreviewConsumer, body string) ChatMessageRow {
		t.Helper()
		m, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		reqs := linkPreviewRequests(t, pool)
		if err := c.Handle(ctx, reqs[len(reqs)-1]); err != nil {
			t.Fatal(err)
		}
		return m
	}

	blocked := &stubPreviewFetcher{err: linkpreview.ErrBlocked}
	cb := NewChatLinkPreviewConsumer(s, blocked)
	handleNew(cb, "http://169.254.169.254/latest/meta-data/")
	handleNew(cb, "lại http://169.254.169.254/latest/meta-data/")
	if len(blocked.calls) != 1 {
		t.Fatalf("a refused URL was tried %d times", len(blocked.calls))
	}

	failing := &stubPreviewFetcher{err: errors.Join(linkpreview.ErrFailed, errors.New("timeout"))}
	cf := NewChatLinkPreviewConsumer(s, failing)
	early := handleNew(cf, "https://slow.example.vn/")
	handleNew(cf, "https://slow.example.vn/ lần nữa")
	if len(failing.calls) != 1 {
		t.Fatalf("a failure was retried within the hour (%d fetches)", len(failing.calls))
	}
	if n := countEvents(pub.events, "chat.message.preview_ready"); n != 0 {
		t.Fatalf("%d preview_ready events for cards that do not exist", n)
	}

	if _, err := pool.Exec(ctx, `UPDATE chat_link_previews SET fetched_at = now() - interval '2 hours' WHERE status = 'failed'`); err != nil {
		t.Fatal(err)
	}
	ok := &stubPreviewFetcher{preview: linkpreview.Preview{Title: "Đã lên", SiteName: "slow.example.vn"}}
	handleNew(NewChatLinkPreviewConsumer(s, ok), "https://slow.example.vn/#lan-ba")
	if len(ok.calls) != 1 {
		t.Fatalf("the stale failure was not retried")
	}
	// The earlier message shares the URL's card, so it shows now too.
	previews, err := s.ListRoomLinkPreviews(ctx, ua.ID, w.ID, room.RoomID, []string{early.ID})
	if err != nil || len(previews) != 1 || previews[0].Title != "Đã lên" || previews[0].ImageURL != "" {
		t.Fatalf("previews = %+v err=%v", previews, err)
	}
}

func mustHash(raw string) string {
	_, h := previewURLKey(raw)
	return h
}
