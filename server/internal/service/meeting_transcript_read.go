package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// transcriptAroundLead is how many lines before a cited one an around= page
// starts with, so the reader sees what led up to it.
const transcriptAroundLead = 20

// transcriptForward is the page after (at, id), oldest first (UNI-1995 #9):
// an ended meeting reads from its start. A zero cursor is the first page.
func (s *MeetingService) transcriptForward(ctx context.Context, meetingID string, rich bool, ids []string, at time.Time, id string, limit int) (FeedPage[db.MeetingTranscriptSegment], error) {
	rows, err := s.q.ListTranscriptSegmentsAfter(ctx, db.ListTranscriptSegmentsAfterParams{
		MeetingID: meetingID, AfterAt: pgtype.Timestamptz{Time: at, Valid: true}, AfterID: id,
		RowLimit: int32(limit + 1), Rich: rich, TranscriptionIds: ids,
	})
	if err != nil {
		return FeedPage[db.MeetingTranscriptSegment]{}, err
	}
	var p FeedPage[db.MeetingTranscriptSegment]
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		p.NewerCursor = encodeFeedCursor(last.SpokenAt.Time, last.ID)
	}
	p.Items = rows
	return p, nil
}

// transcriptAround is the page that holds segmentID: a few lines before it,
// the line, then forward; OlderCursor and NewerCursor read on either side. A
// line the reader cannot see (another meeting, deleted, a superseded source)
// reads the first page instead, so the answer says nothing about it.
func (s *MeetingService) transcriptAround(ctx context.Context, meetingID string, rich bool, ids []string, segmentID string, limit int) (FeedPage[db.MeetingTranscriptSegment], error) {
	seg, err := s.q.GetVisibleTranscriptSegment(ctx, db.GetVisibleTranscriptSegmentParams{
		MeetingID: meetingID, ID: segmentID, Rich: rich, TranscriptionIds: ids,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.transcriptForward(ctx, meetingID, rich, ids, time.Time{}, "", limit)
	}
	if err != nil {
		return FeedPage[db.MeetingTranscriptSegment]{}, err
	}
	lead := min(transcriptAroundLead, limit/2)
	older, err := s.q.ListTranscriptSegmentsBefore(ctx, db.ListTranscriptSegmentsBeforeParams{
		MeetingID: meetingID, BeforeAt: seg.SpokenAt, BeforeID: seg.ID, RowLimit: int32(lead + 1),
		Rich: rich, TranscriptionIds: ids,
	})
	if err != nil {
		return FeedPage[db.MeetingTranscriptSegment]{}, err
	}
	before := pageFromNewest(older, lead, transcriptFeedKeys, false)
	after, err := s.transcriptForward(ctx, meetingID, rich, ids, seg.SpokenAt.Time, seg.ID, max(limit-len(before.Items)-1, 1))
	if err != nil {
		return FeedPage[db.MeetingTranscriptSegment]{}, err
	}
	items := append(append(before.Items, seg), after.Items...)
	return FeedPage[db.MeetingTranscriptSegment]{Items: items, OlderCursor: before.OlderCursor, NewerCursor: after.NewerCursor}, nil
}
