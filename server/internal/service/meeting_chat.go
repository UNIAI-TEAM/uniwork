package service

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// In-room feeds (chat, transcript) are read a page at a time (G7, G18).
const (
	feedDefaultLimit = 200
	feedMaxLimit     = 500
	// feedDeltaOverlap re-reads this much before an after-cursor, so a row
	// whose transaction committed after a later one, or that was stamped by a
	// replica with a slightly slower clock, is not skipped. Clients merge by id.
	feedDeltaOverlap = 5 * time.Second
)

// FeedQuery selects one page of an in-room feed. No cursor = the newest page;
// Before = the page older than that cursor; After = what arrived since it.
type FeedQuery struct {
	Before, After string
	Limit         int
}

func (q FeedQuery) limit() int {
	switch {
	case q.Limit <= 0:
		return feedDefaultLimit
	case q.Limit > feedMaxLimit:
		return feedMaxLimit
	}
	return q.Limit
}

// FeedPage is one page in reading order (oldest first).
type FeedPage[T any] struct {
	Items []T
	// OlderCursor reads the page before Items; "" when nothing is older or
	// when the page is a delta.
	OlderCursor string
	// AfterCursor reads what arrives later; it is the request's own cursor
	// when a delta found nothing.
	AfterCursor string
	// HasMoreAfter: a delta filled its page, so rows may lie past it. The
	// client drops its copy and reads the newest page again.
	HasMoreAfter bool
}

// encodeFeedCursor is opaque to clients: the row's key time in Unix
// microseconds (Postgres precision) and its id.
func encodeFeedCursor(at time.Time, id string) string {
	return strconv.FormatInt(at.UnixMicro(), 10) + "." + id
}

// feedCursorMin and feedCursorMax bound a cursor's time to what a stored row
// can carry (an RFC 3339 year), so a forged one is a 400, not a query error.
var (
	feedCursorMin = time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC).UnixMicro()
	feedCursorMax = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC).UnixMicro()
)

func decodeFeedCursor(c string) (time.Time, string, error) {
	micros, id, ok := strings.Cut(c, ".")
	n, err := strconv.ParseInt(micros, 10, 64)
	if !ok || err != nil || n < feedCursorMin || n >= feedCursorMax || id == "" || strings.Contains(id, ".") {
		return time.Time{}, "", Invalid("cursor không hợp lệ")
	}
	return time.UnixMicro(n).UTC(), id, nil
}

func (q FeedQuery) validate() error {
	if q.Limit < 0 {
		return Invalid("limit không hợp lệ")
	}
	if q.Before != "" && q.After != "" {
		return Invalid("chỉ dùng một trong before hoặc after")
	}
	for _, c := range []string{q.Before, q.After} {
		if c == "" {
			continue
		}
		if _, _, err := decodeFeedCursor(c); err != nil {
			return err
		}
	}
	return nil
}

// feedKeys says how a feed orders its rows: key is the page order (what the
// reader sees), delta the arrival order the after-cursor follows.
type feedKeys[T any] struct {
	id         func(T) string
	key, delta func(T) time.Time
}

// pageFromNewest turns a newest-first read of limit+1 rows into a page.
func pageFromNewest[T any](rows []T, limit int, k feedKeys[T], withAfter bool) FeedPage[T] {
	var p FeedPage[T]
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		p.OlderCursor = encodeFeedCursor(k.key(last), k.id(last))
	}
	p.Items = make([]T, len(rows))
	for i, r := range rows {
		p.Items[len(rows)-1-i] = r
	}
	if withAfter {
		var newest T
		var at time.Time
		for _, r := range rows {
			if t := k.delta(r); at.IsZero() || t.After(at) {
				newest, at = r, t
			}
		}
		if !at.IsZero() {
			p.AfterCursor = encodeFeedCursor(at, k.id(newest))
		}
	}
	return p
}

// pageFromDelta turns an oldest-first read of limit+1 rows since a cursor
// into a page; prev is kept as the cursor when nothing arrived.
func pageFromDelta[T any](rows []T, limit int, k feedKeys[T], prev string) FeedPage[T] {
	p := FeedPage[T]{AfterCursor: prev}
	if len(rows) > limit {
		rows, p.HasMoreAfter = rows[:limit], true
	}
	p.Items = rows
	if len(rows) > 0 {
		last := rows[len(rows)-1]
		p.AfterCursor = encodeFeedCursor(k.delta(last), k.id(last))
	}
	return p
}

var chatFeedKeys = feedKeys[db.MeetingChatMessage]{
	id:    func(m db.MeetingChatMessage) string { return m.ID },
	key:   func(m db.MeetingChatMessage) time.Time { return m.SentAt.Time },
	delta: func(m db.MeetingChatMessage) time.Time { return m.SentAt.Time },
}

func normalizeChatMessage(text string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", Invalid("nội dung không được để trống")
	}
	if len(text) > 4000 {
		text = text[:4000]
	}
	return text, nil
}

func (s *MeetingService) AppendChatMessage(ctx context.Context, userID, guestID, meetingID, message string) (db.MeetingChatMessage, error) {
	m, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID)
	if err != nil {
		return db.MeetingChatMessage{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingChatMessage{}, errInvalidState()
	}
	message, err = normalizeChatMessage(message)
	if err != nil {
		return db.MeetingChatMessage{}, err
	}

	senderName := ""
	pid := pgtype.Text{}
	senderIdentity := ""
	if userID != "" {
		if p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)}); err == nil {
			pid = strText(p.ID)
			senderIdentity = meetings.IdentityForParticipant(p.ID)
			senderName = p.DisplayNameSnapshot
		}
		if senderName == "" {
			if u, err := s.q.GetUserByID(ctx, userID); err == nil {
				senderName = u.DisplayName
			}
		}
	} else if guestID != "" {
		if p, err := s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{MeetingID: meetingID, GuestID: strText(guestID)}); err == nil {
			pid = strText(p.ID)
			senderIdentity = meetings.IdentityForParticipant(p.ID)
			senderName = p.DisplayNameSnapshot
		}
	}
	if senderIdentity == "" {
		return db.MeetingChatMessage{}, Invalid("chưa tham gia phòng họp")
	}

	sentAt := time.Now().UTC()
	msg, err := s.q.InsertMeetingChatMessage(ctx, db.InsertMeetingChatMessageParams{
		ID:             util.NewID(),
		MeetingID:      meetingID,
		OrganizationID: m.OrganizationID,
		ParticipantID:  pid,
		SenderIdentity: senderIdentity,
		SenderName:     senderName,
		Message:        message,
		SentAt:         pgtype.Timestamptz{Time: sentAt, Valid: true},
	})
	if err != nil {
		return db.MeetingChatMessage{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "chat.message", Payload: map[string]string{"meeting_id": meetingID}})
	return msg, nil
}

// ChatMessages is the newest page of the room's chat, oldest first.
func (s *MeetingService) ChatMessages(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingChatMessage, error) {
	page, err := s.ChatFeed(ctx, userID, guestID, meetingID, FeedQuery{})
	return page.Items, err
}

// ChatFeed reads one page of the room's chat. sent_at is the server's clock,
// so it orders both the pages and the deltas.
func (s *MeetingService) ChatFeed(ctx context.Context, userID, guestID, meetingID string, q FeedQuery) (FeedPage[db.MeetingChatMessage], error) {
	if err := q.validate(); err != nil {
		return FeedPage[db.MeetingChatMessage]{}, err
	}
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return FeedPage[db.MeetingChatMessage]{}, err
	}
	limit := q.limit()
	switch {
	case q.After != "":
		at, _, _ := decodeFeedCursor(q.After)
		rows, err := s.q.ListMeetingChatMessagesSince(ctx, db.ListMeetingChatMessagesSinceParams{
			MeetingID: meetingID, Since: pgtype.Timestamptz{Time: at.Add(-feedDeltaOverlap), Valid: true}, RowLimit: int32(limit + 1),
		})
		if err != nil {
			return FeedPage[db.MeetingChatMessage]{}, err
		}
		return pageFromDelta(rows, limit, chatFeedKeys, q.After), nil
	case q.Before != "":
		at, id, _ := decodeFeedCursor(q.Before)
		rows, err := s.q.ListMeetingChatMessagesBefore(ctx, db.ListMeetingChatMessagesBeforeParams{
			MeetingID: meetingID, BeforeAt: pgtype.Timestamptz{Time: at, Valid: true}, BeforeID: id, RowLimit: int32(limit + 1),
		})
		if err != nil {
			return FeedPage[db.MeetingChatMessage]{}, err
		}
		return pageFromNewest(rows, limit, chatFeedKeys, false), nil
	}
	rows, err := s.q.ListMeetingChatMessagesLatest(ctx, db.ListMeetingChatMessagesLatestParams{MeetingID: meetingID, Limit: int32(limit + 1)})
	if err != nil {
		return FeedPage[db.MeetingChatMessage]{}, err
	}
	return pageFromNewest(rows, limit, chatFeedKeys, true), nil
}
