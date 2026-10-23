package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedLine stores one transcript line of the env's meeting, i seconds after
// its start, and returns its id.
func (e transcriptionEnv) seedLine(t *testing.T, source, text string, i int) string {
	t.Helper()
	id := util.NewID()
	if _, err := e.s.pool.Exec(context.Background(), `INSERT INTO meeting_transcript_segments (id, meeting_id, organization_id, speaker_name, text, spoken_at, source)
		VALUES ($1, $2, $3, 'X', $4, $5, $6)`, id, e.m.ID, e.m.OrganizationID, text, e.m.ActualStartAt.Time.Add(time.Duration(i)*time.Second), source); err != nil {
		t.Fatal(err)
	}
	return id
}

func texts(page TranscriptPage) []string {
	out := make([]string, 0, len(page.Items))
	for _, g := range page.Items {
		out = append(out, g.Text)
	}
	return out
}

func lines(from, to int) []string {
	out := []string{}
	for i := from; i <= to; i++ {
		out = append(out, fmt.Sprintf("line %d", i))
	}
	return out
}

func sameTexts(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// UNI-1995 #9: an ended meeting reads from its start, page after page, and
// a citation opens the page around its line.
func TestTranscriptReadsForwardAndAround(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	ids := make([]string, 30)
	for i := range 30 {
		ids[i] = e.seedLine(t, "CAPTION", fmt.Sprintf("line %d", i), i)
	}
	first, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Asc: true, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := texts(first); !sameTexts(got, lines(0, 9)) || first.NewerCursor == "" || first.OlderCursor != "" {
		t.Fatalf("first page = %v newer %q older %q", got, first.NewerCursor, first.OlderCursor)
	}
	next, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{From: first.NewerCursor, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := texts(next); !sameTexts(got, lines(10, 19)) {
		t.Fatalf("second page = %v", got)
	}
	around, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Around: ids[25], Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := texts(around); !sameTexts(got, lines(20, 29)) || around.OlderCursor == "" || around.NewerCursor != "" {
		t.Fatalf("around page = %v older %q newer %q", got, around.OlderCursor, around.NewerCursor)
	}
	older, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Before: around.OlderCursor, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if got := texts(older); !sameTexts(got, lines(15, 19)) {
		t.Fatalf("before the around page = %v", got)
	}
	// An id the reader cannot see reads the first page: nothing is revealed.
	unknown, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Around: util.NewID(), Limit: 3})
	if err != nil || !sameTexts(texts(unknown), lines(0, 2)) {
		t.Fatalf("unknown around = %v %v", texts(unknown), err)
	}
	if _, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Around: ids[1], From: first.NewerCursor}); err == nil {
		t.Fatal("around and from together were accepted")
	}
}

func transcriptAuditRows(t *testing.T, s *MeetingService, action, resourceID string) int {
	t.Helper()
	return countWhere(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, resourceID)
}

func changedEvents(t *testing.T, s *MeetingService, meetingID string) int {
	t.Helper()
	return countWhere(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'transcript.changed' AND payload::jsonb->>'meeting_id' = $1`, meetingID)
}

// seedSummary stores a summary made from the transcript as it is now.
func (e transcriptionEnv) seedSummary(t *testing.T) string {
	t.Helper()
	id := util.NewID()
	if _, err := e.s.pool.Exec(context.Background(), `INSERT INTO meeting_summaries (id, meeting_id, summary, created_by, organization_id)
		VALUES ($1, $2, 'Đã chốt.', $3, $4)`, id, e.m.ID, e.host.ID, e.m.OrganizationID); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e transcriptionEnv) summaryChanged(t *testing.T) bool {
	t.Helper()
	sum, err := e.s.Summary(context.Background(), e.host.ID, e.m.ID)
	if err != nil || sum == nil {
		t.Fatalf("summary = %v %v", sum, err)
	}
	return sum.TranscriptChangedAt.Valid
}

// UNI-1995 #5: a clerk corrects a line; the first wording is kept, the line
// says it was edited, the summary is marked stale, and it is audited.
func TestEditTranscriptSegment(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	id := e.seedLine(t, "CAPTION", "anh Hung", 1)
	e.seedSummary(t)
	if _, err := e.s.EditTranscriptSegment(ctx, e.member.ID, e.m.ID, id, "anh Hùng"); err == nil {
		t.Fatal("a member edited a line")
	} else if code, _ := codedOf(err); code != "not_meeting_clerk" {
		t.Fatalf("member edit = %v", err)
	}
	if _, err := e.s.EditTranscriptSegment(ctx, e.host.ID, e.m.ID, id, "   "); !isValidationErr(err) {
		t.Fatalf("blank edit = %v", err)
	}
	if _, err := e.s.EditTranscriptSegment(ctx, e.host.ID, e.m.ID, util.NewID(), "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown segment = %v", err)
	}
	seg, err := e.s.EditTranscriptSegment(ctx, e.host.ID, e.m.ID, id, "anh Hùng")
	if err != nil {
		t.Fatal(err)
	}
	if seg.Text != "anh Hùng" || seg.OriginalText.String != "anh Hung" || !seg.EditedAt.Valid || seg.EditedBy.String != e.host.ID {
		t.Fatalf("edited = %+v", seg)
	}
	seg, err = e.s.EditTranscriptSegment(ctx, e.host.ID, e.m.ID, id, "anh Hùng (PM)")
	if err != nil || seg.OriginalText.String != "anh Hung" {
		t.Fatalf("second edit = %+v %v", seg, err)
	}
	if n := transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptSegmentEdited, id); n != 2 {
		t.Fatalf("edit audit rows = %d", n)
	}
	// The audit row says that the text changed, never what it said.
	var changes string
	if err := e.s.pool.QueryRow(ctx, `SELECT changes::text FROM audit_events WHERE action = $1 AND resource_id = $2 LIMIT 1`,
		audit.ActionMeetingTranscriptSegmentEdited, id).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if containsAny(changes, "Hung", "Hùng") {
		t.Fatalf("audit row carries the transcript text: %s", changes)
	}
	if n := changedEvents(t, e.s, e.m.ID); n != 2 {
		t.Fatalf("transcript.changed events = %d", n)
	}
	if !e.summaryChanged(t) {
		t.Fatal("summary not marked stale")
	}
}

func isValidationErr(err error) bool {
	var ve ValidationError
	return errors.As(err, &ve)
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
	}
	return false
}

// UNI-1995 #5: a line, a stretch, the whole transcript.
func TestDeleteTranscriptLinesRangeAndAll(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	ids := make([]string, 10)
	for i := range 10 {
		ids[i] = e.seedLine(t, "CAPTION", fmt.Sprintf("line %d", i), i)
	}
	if err := e.s.DeleteTranscriptSegment(ctx, e.member.ID, e.m.ID, ids[0]); err == nil {
		t.Fatal("a member deleted a line")
	}
	if err := e.s.DeleteTranscriptSegment(ctx, e.host.ID, e.m.ID, ids[0]); err != nil {
		t.Fatal(err)
	}
	if err := e.s.DeleteTranscriptSegment(ctx, e.host.ID, e.m.ID, ids[0]); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete = %v", err)
	}
	// Sub-second lines around the stretch's end: the bounds are the two
	// lines themselves, not their times rounded to a second.
	t0 := e.m.ActualStartAt.Time
	inside, after := util.NewID(), util.NewID()
	for id, at := range map[string]time.Duration{inside: 4500 * time.Millisecond, after: 5500 * time.Millisecond} {
		if _, err := e.s.pool.Exec(ctx, `INSERT INTO meeting_transcript_segments (id, meeting_id, organization_id, speaker_name, text, spoken_at, source)
			VALUES ($1, $2, $3, 'X', $1, $4, 'CAPTION')`, id, e.m.ID, e.m.OrganizationID, t0.Add(at)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcript_segments SET spoken_at = spoken_at + interval '400 milliseconds' WHERE id = $1`, ids[5]); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.DeleteTranscriptRange(ctx, e.host.ID, e.m.ID, ids[5], ids[3]); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reversed range = %v", err)
	}
	if _, err := e.s.DeleteTranscriptRange(ctx, e.host.ID, e.m.ID, ids[3], util.NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("range ending on an unknown line = %v", err)
	}
	if _, err := e.s.DeleteTranscriptRange(ctx, e.member.ID, e.m.ID, ids[3], ids[5]); err == nil {
		t.Fatal("a member deleted a range")
	}
	n, err := e.s.DeleteTranscriptRange(ctx, e.host.ID, e.m.ID, ids[3], ids[5])
	if err != nil || n != 4 {
		t.Fatalf("range deleted %d %v", n, err)
	}
	if left := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE id = $1`, after); left != 1 {
		t.Fatal("the line after the stretch went too")
	}
	if _, err := e.s.pool.Exec(ctx, `DELETE FROM meeting_transcript_segments WHERE id = $1`, after); err != nil {
		t.Fatal(err)
	}
	// One line is a stretch of one.
	if n, err := e.s.DeleteTranscriptRange(ctx, e.host.ID, e.m.ID, ids[2], ids[2]); err != nil || n != 1 {
		t.Fatalf("one-line range deleted %d %v", n, err)
	}
	page, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Asc: true})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := texts(page), []string{"line 1", "line 6", "line 7", "line 8", "line 9"}; !sameTexts(got, want) {
		t.Fatalf("after range delete = %v", got)
	}
	n, err = e.s.DeleteTranscript(ctx, e.host.ID, e.m.ID)
	if err != nil || n != 5 {
		t.Fatalf("whole transcript deleted %d %v", n, err)
	}
	if left := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE meeting_id = $1`, e.m.ID); left != 0 {
		t.Fatalf("lines left = %d", left)
	}
	if transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptSegmentDeleted, ids[0]) != 1 ||
		transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptRangeDeleted, e.m.ID) != 2 ||
		transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptDeleted, e.m.ID) != 1 {
		t.Fatal("a delete was not audited")
	}
	if n := changedEvents(t, e.s, e.m.ID); n != 4 {
		t.Fatalf("transcript.changed events = %d", n)
	}
}

// audioReleaseSpy records the files a command lets go.
type audioReleaseSpy struct {
	files.Service
	released []files.FileID
}

func (r *audioReleaseSpy) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	r.released = append(r.released, ids...)
	return r.Service.ReleaseInTx(ctx, q, ids)
}

// completeUpload queues and lands one uploaded recording.
func (e transcriptionEnv) completeUpload(t *testing.T, name string) db.MeetingTranscription {
	t.Helper()
	ctx := context.Background()
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, name, mp3(60, name)), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		due(t, e.s, e.m.ID)
		if err := e.s.runTranscriptions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionComplete {
		t.Fatalf("transcription = %+v", got)
	}
	return transcription(t, e.s, tr.ID)
}

// UNI-1995 #5: deleting an uploaded transcription takes its lines and lets
// go of its recording; a job still running is refused.
func TestDeleteTranscriptionReleasesItsAudio(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	spy := &audioReleaseSpy{Service: e.files}
	e.s.SetFiles(spy)
	tr := e.completeUpload(t, "hop.mp3")
	queued, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "b.mp3", mp3(60, "b")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.DeleteTranscription(ctx, e.host.ID, e.m.ID, queued.ID); !isInvalidMeetingState(err) {
		t.Fatalf("queued delete = %v", err)
	}
	if err := e.s.DeleteTranscription(ctx, e.member.ID, e.m.ID, tr.ID); err == nil {
		t.Fatal("a member deleted a transcription")
	}
	if err := e.s.DeleteTranscription(ctx, e.host.ID, e.m.ID, tr.ID); err != nil {
		t.Fatal(err)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE transcription_id = $1`, tr.ID); n != 0 {
		t.Fatalf("lines left = %d", n)
	}
	if len(spy.released) != 1 || spy.released[0] != files.FileID(tr.FileID) {
		t.Fatalf("released = %v", spy.released)
	}
	held, err := MeetingTranscriptionProvider{}.HeldBy(ctx, e.s.q, []files.FileID{files.FileID(tr.FileID)})
	if err != nil || len(held) != 0 {
		t.Fatalf("file still held: %v %v", held, err)
	}
	if transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptionDeleted, tr.ID) != 1 || changedEvents(t, e.s, e.m.ID) != 1 {
		t.Fatal("delete not audited or announced")
	}
	if err := e.s.DeleteTranscription(ctx, e.host.ID, e.m.ID, tr.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete = %v", err)
	}
}

// UNI-1995 #11: a completed upload replaces the scribe's lines and the
// captions; the transcript is one copy, and the summary says it changed.
func TestUploadReplacesTheLiveTranscript(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.seedLine(t, "AGENT", "agent line", 1)
	e.seedLine(t, "CAPTION", "caption line", 2)
	e.seedSummary(t)
	tr := e.completeUpload(t, "hop.mp3")
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE meeting_id = $1 AND source <> 'TRANSCRIPTION'`, e.m.ID); n != 0 {
		t.Fatalf("live lines kept = %d", n)
	}
	page, err := e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Asc: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range page.Items {
		if !g.TranscriptionID.Valid || g.TranscriptionID.String != tr.ID {
			t.Fatalf("transcript line from another source: %+v", g)
		}
	}
	if len(page.Items) == 0 {
		t.Fatal("no transcript")
	}
	// A scribe line that lands after the upload (the agent's 10-minute
	// tail) is stored but never read beside it.
	e.seedLine(t, "AGENT", "late agent line", 3)
	page, err = e.s.Transcript(ctx, e.member.ID, e.m.ID, FeedQuery{Asc: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range page.Items {
		if g.Source == "AGENT" {
			t.Fatalf("an agent line reads beside the upload: %+v", g)
		}
	}
	if !e.summaryChanged(t) {
		t.Fatal("summary not marked stale by the replacement")
	}
}

// UNI-1995 #5: the organization's window, set by an owner/admin and audited.
func TestSetTranscriptRetention(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	days := int32(90)
	if _, err := e.s.SetMeetingTranscriptRetention(ctx, Human(e.member.ID), e.m.OrganizationID, &days); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("member set = %v", err)
	}
	bad := int32(45)
	if _, err := e.s.SetMeetingTranscriptRetention(ctx, Human(e.host.ID), e.m.OrganizationID, &bad); !isValidationErr(err) {
		t.Fatalf("45 days = %v", err)
	}
	set, err := e.s.SetMeetingTranscriptRetention(ctx, Human(e.host.ID), e.m.OrganizationID, &days)
	if err != nil || set.TranscriptRetentionDays.Int32 != 90 || !set.AutoSummaryEnabled {
		t.Fatalf("set = %+v %v", set, err)
	}
	if set, err = e.s.SetMeetingTranscriptRetention(ctx, Human(e.host.ID), e.m.OrganizationID, nil); err != nil || set.TranscriptRetentionDays.Valid {
		t.Fatalf("keep = %+v %v", set, err)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM audit_events WHERE action = $1 AND changes::text LIKE '%transcript_retention_days%'`, audit.ActionMeetingSettingsChanged); n != 2 {
		t.Fatalf("settings audit rows = %d", n)
	}
}

// UNI-1995 #5: the sweep removes lines and uploaded audio past the window;
// summaries stay; other organizations and newer lines are untouched.
func TestTranscriptRetentionSweep(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	spy := &audioReleaseSpy{Service: e.files}
	e.s.SetFiles(spy)
	tr := e.completeUpload(t, "hop.mp3")
	old := e.seedLine(t, "CAPTION", "old", 1)
	fresh := e.seedLine(t, "CAPTION", "fresh", 2)
	e.seedSummary(t)
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcript_segments SET created_at = now() - interval '40 days' WHERE id = $1 OR transcription_id = $2`, old, tr.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET created_at = now() - interval '40 days' WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	// Without a window nothing goes.
	if err := e.s.SweepTranscriptRetention(ctx); err != nil {
		t.Fatal(err)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE meeting_id = $1`, e.m.ID); n < 3 {
		t.Fatalf("lines swept without a window: %d", n)
	}
	days := int32(30)
	if _, err := e.s.SetMeetingTranscriptRetention(ctx, Human(e.host.ID), e.m.OrganizationID, &days); err != nil {
		t.Fatal(err)
	}
	if err := e.s.SweepTranscriptRetention(ctx); err != nil {
		t.Fatal(err)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE id = $1`, old); n != 0 {
		t.Fatal("old line kept")
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE id = $1`, fresh); n != 1 {
		t.Fatal("fresh line swept")
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcriptions WHERE id = $1`, tr.ID); n != 0 {
		t.Fatal("old upload kept")
	}
	if len(spy.released) != 1 || spy.released[0] != files.FileID(tr.FileID) {
		t.Fatalf("released = %v", spy.released)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_summaries WHERE meeting_id = $1`, e.m.ID); n != 1 {
		t.Fatal("summary swept")
	}
	if transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptExpired, e.m.ID) != 1 || transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptionDeleted, tr.ID) != 1 {
		t.Fatal("sweep not audited")
	}
	// A second pass finds nothing more to do.
	if err := e.s.SweepTranscriptRetention(ctx); err != nil {
		t.Fatal(err)
	}
	if transcriptAuditRows(t, e.s, audit.ActionMeetingTranscriptExpired, e.m.ID) != 1 {
		t.Fatal("second pass audited again")
	}
}
