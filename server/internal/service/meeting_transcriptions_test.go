package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type transcriptionEnv struct {
	s      *MeetingService
	files  *filesfake.Fake
	vendor *provider.FakeFileTranscriber
	host   db.User
	member db.User
	m      db.Meeting
}

// transcriptionFixture: a meeting recorded as held an hour ago, the fake
// files service and the fake vendor wired, the flag on, a plan with minutes.
func transcriptionFixture(t *testing.T) transcriptionEnv {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	fs := filesfake.New(filesfake.Options{})
	s.SetFiles(fs)
	s.SetFlags(mcpFlagsExcept{})
	vendor := &provider.FakeFileTranscriber{}
	s.AI = ai.NewGateway(s.q, nil, nil, nil, ai.Options{Cloud: ai.CloudTools{MeetingTranscriber: vendor}})
	start := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	// The member is invited: an AI-content read is for the people of the meeting (UNI-1995 access).
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Họp chi bộ", StartsAt: start, EndsAt: start.Add(time.Hour), AttendeeUserIDs: []string{ub.ID}})
	if err != nil {
		t.Fatal(err)
	}
	held := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if m, err = s.RecordHeld(ctx, ua.ID, m.ID, held, held.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	setTranscriptionQuota(t, s, m.OrganizationID, 1000)
	return transcriptionEnv{s: s, files: fs, vendor: vendor, host: ua, member: ub, m: m}
}

// mp3 is an ID3-tagged body that counts as `seconds` of 128 kbit/s audio.
func mp3(seconds int, marker string) []byte {
	b := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x00"+marker), 0xff, 0xfb, 0x90, 0x64)
	return append(b, bytes.Repeat([]byte{0}, seconds*16000-len(b))...)
}

func (e transcriptionEnv) upload(t *testing.T, name string, body []byte) string {
	t.Helper()
	return e.uploadFor(t, e.m, e.host.ID, name, body)
}

// uploadFor stages a recording the way the upload session leaves it: the
// file on the fake files service, and the completed meeting_audio session
// that names its uploader and meeting.
func (e transcriptionEnv) uploadFor(t *testing.T, m db.Meeting, userID, name string, body []byte) string {
	t.Helper()
	up, err := e.files.Upload(context.Background(), files.UploadInput{
		Actor: audit.User(userID), Purpose: files.MeetingAudio, IdempotencyKey: util.NewID(),
		Scope:    files.Scope{OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID},
		Filename: name, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatal(err)
	}
	seedMeetingAudioSession(t, e.s.pool, m, userID, string(up.File.ID))
	return string(up.File.ID)
}

// seedMeetingAudioSession writes the completed upload session row a
// meeting_audio file comes with.
func seedMeetingAudioSession(t *testing.T, pool interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, m db.Meeting, userID, fileID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `INSERT INTO file_multipart_uploads (id, organization_id, workspace_id, file_id,
		file_upload_session_id, created_by, created_by_kind, opened_via, storage_upload_id, object_key, filename, size_bytes,
		part_size, total_parts, probe_head_sha256, probe_tail_sha256, status, expires_at, closed_at, meeting_id)
		VALUES ($1, $2, $3, $4, $5, $6, 'human', 'meeting_audio', 's', 'k', 'f', 1, 1, 1, 'h', '', 'completed',
		now() + interval '1 day', now(), $7)`,
		util.NewID(), m.OrganizationID, m.WorkspaceID, fileID, util.NewID(), userID, m.ID); err != nil {
		t.Fatal(err)
	}
}

func codedOf(err error) (string, int) {
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code, ce.Status
	}
	return "", 0
}

func countWhere(t *testing.T, s *MeetingService, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRecordHeld(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Họp trực tiếp", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	began := time.Now().Add(-3 * time.Hour).Truncate(time.Second)
	if _, err := s.RecordHeld(ctx, ub.ID, m.ID, began, began.Add(time.Hour)); err == nil {
		t.Fatal("a plain member recorded the meeting as held")
	} else if code, _ := codedOf(err); code != "not_meeting_clerk" {
		t.Fatalf("a plain member: %v", err)
	}
	for name, times := range map[string][2]time.Time{
		"end before start":      {began, began.Add(-time.Minute)},
		"end equals start":      {began, began},
		"end in the future":     {began, time.Now().Add(time.Hour)},
		"no times (unreadable)": {{}, {}},
	} {
		if _, err := s.RecordHeld(ctx, ua.ID, m.ID, times[0], times[1]); err == nil {
			t.Fatalf("%s: accepted", name)
		} else if code, status := codedOf(err); code != "invalid_held_times" || status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %v", name, err)
		}
	}
	ended, err := s.RecordHeld(ctx, ua.ID, m.ID, began, began.Add(90*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if ended.Status != MeetingEnded || !ended.ActualStartAt.Time.Equal(began) || !ended.ActualEndAt.Time.Equal(began.Add(90*time.Minute)) {
		t.Fatalf("held meeting = %s %v %v", ended.Status, ended.ActualStartAt.Time, ended.ActualEndAt.Time)
	}
	if _, err := s.q.GetOpenConferenceSession(ctx, m.ID); err == nil {
		t.Fatal("recording a held meeting opened a conference session")
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MEETING_RECORDED_HELD'`, m.ID); n != 1 {
		t.Fatalf("timeline rows = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`, m.ID, audit.ActionMeetingHeldRecorded); n != 1 {
		t.Fatalf("audit rows = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'meeting.ended' AND payload::jsonb->>'meeting_id' = $1`, m.ID); n != 1 {
		t.Fatalf("meeting.ended events = %d", n)
	}
	// Only from SCHEDULED.
	if _, err := s.RecordHeld(ctx, ua.ID, m.ID, began, began.Add(time.Hour)); err == nil {
		t.Fatal("an ended meeting was recorded as held again")
	} else if code, status := codedOf(err); code != "invalid_meeting_state" || status != http.StatusConflict {
		t.Fatalf("second record = %v", err)
	}
}

func TestRequestTranscription(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	s, m := e.s, e.m
	part := e.upload(t, "phan-1.mp3", mp3(180, "a"))
	req := TranscriptionRequest{UploadID: part, Language: "vi", Consent: true}

	if _, err := s.RequestTranscription(ctx, e.member.ID, m.ID, req); err == nil {
		t.Fatal("a plain member queued a transcription")
	} else if code, _ := codedOf(err); code != "not_meeting_clerk" {
		t.Fatalf("member = %v", err)
	}
	if _, err := s.RequestTranscription(ctx, e.host.ID, m.ID, TranscriptionRequest{UploadID: part, Language: "vi"}); err == nil {
		t.Fatal("queued without the recording consent")
	} else if code, status := codedOf(err); code != "recording_consent_required" || status != http.StatusUnprocessableEntity {
		t.Fatalf("no consent = %v", err)
	}
	// Three minutes of audio against two left: refused up front, nothing queued.
	setTranscriptionQuota(t, s, m.OrganizationID, 2)
	if _, err := s.RequestTranscription(ctx, e.host.ID, m.ID, req); err == nil {
		t.Fatal("an estimate over the minutes left was accepted")
	} else if code, status := codedOf(err); code != "quota_exceeded" || status != http.StatusPaymentRequired {
		t.Fatalf("over quota = %v", err)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_transcriptions WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("a refused request left %d rows", n)
	}
	setTranscriptionQuota(t, s, m.OrganizationID, 4)
	first, err := s.RequestTranscription(ctx, e.host.ID, m.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != TranscriptionQueued || first.EstimatedSeconds != 180 || !first.StartsAt.Time.Equal(m.ActualStartAt.Time) || first.ContentType != "audio/mpeg" {
		t.Fatalf("queued = %+v", first)
	}
	var consent string
	if err := s.pool.QueryRow(ctx, `SELECT metadata::jsonb->>'consent_confirmed' FROM audit_events WHERE resource_id = $1 AND action = $2`,
		first.ID, audit.ActionMeetingTranscriptionRequested).Scan(&consent); err != nil || consent != "true" {
		t.Fatalf("requested audit consent = %q %v", consent, err)
	}
	// The open job's three minutes count against the next request.
	second := e.upload(t, "phan-2.mp3", mp3(120, "b"))
	if _, err := s.RequestTranscription(ctx, e.host.ID, m.ID, TranscriptionRequest{UploadID: second, Consent: true}); err == nil {
		t.Fatal("the open job's estimate was not counted")
	}
	setTranscriptionQuota(t, s, m.OrganizationID, 1000)
	// One running transcription per file.
	if _, err := s.RequestTranscription(ctx, e.host.ID, m.ID, req); err == nil {
		t.Fatal("the same file was queued twice")
	} else if code, status := codedOf(err); code != "transcription_in_progress" || status != http.StatusConflict {
		t.Fatalf("second request = %v", err)
	}
	// The next part starts where the first one ends.
	next, err := s.RequestTranscription(ctx, e.host.ID, m.ID, TranscriptionRequest{UploadID: second, Language: "en", Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if !next.StartsAt.Time.Equal(m.ActualStartAt.Time.Add(180 * time.Second)) {
		t.Fatalf("second part starts at %v, want %v", next.StartsAt.Time, m.ActualStartAt.Time.Add(180*time.Second))
	}
	list, err := s.Transcriptions(ctx, e.member.ID, m.ID)
	if err != nil || len(list) != 2 || list[0].ID != next.ID {
		t.Fatalf("list = %d %v", len(list), err)
	}
}

// due makes every open row of the meeting due now.
func due(t *testing.T, s *MeetingService, meetingID string) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(),
		`UPDATE meeting_transcriptions SET next_attempt_at = now() - interval '1 second' WHERE meeting_id = $1`, meetingID); err != nil {
		t.Fatal(err)
	}
}

func transcription(t *testing.T, s *MeetingService, id string) db.MeetingTranscription {
	t.Helper()
	r, err := s.q.GetMeetingTranscription(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestTranscriptionWorkerCompletesAJob(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	s, m := e.s, e.m
	e.vendor.Pending = 1
	e.vendor.Seconds = 125
	tr, err := s.RequestTranscription(ctx, e.host.ID, m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(60, "c")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	before := transcriptionMinutes(t, s, m.OrganizationID)

	// Submit: the vendor reads the file from a presigned URL.
	if err := s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	got := transcription(t, s, tr.ID)
	if got.Status != TranscriptionRunning || got.Attempts != 1 || got.ProviderJobID == "" || got.Provider != "fake" || !got.UsageEventID.Valid || got.LeaseUntil.Valid {
		t.Fatalf("after submit = %+v", got)
	}
	if len(e.vendor.Submits) != 1 || e.vendor.Submits[0].AudioURL == "" || !e.vendor.Submits[0].Diarize {
		t.Fatalf("submits = %+v", e.vendor.Submits)
	}
	if !got.DeadlineAt.Time.After(time.Now().Add(transcriptionMinJob - time.Minute)) {
		t.Fatalf("deadline %v is shorter than two hours", got.DeadlineAt.Time)
	}
	// Not due before its 15 s pause.
	if err := s.runTranscriptions(ctx); err != nil || e.vendor.Polls != 0 {
		t.Fatalf("polled before due: %d %v", e.vendor.Polls, err)
	}
	// A row another node holds is left alone; once its lease ran out, this
	// node takes it over.
	due(t, s, m.ID)
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET lease_until = now() + interval '1 minute' WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.runTranscriptions(ctx); err != nil || e.vendor.Polls != 0 {
		t.Fatalf("worked a leased row: %d %v", e.vendor.Polls, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET lease_until = now() - interval '1 second' WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.runTranscriptions(ctx); err != nil || e.vendor.Polls != 1 {
		t.Fatalf("expired lease not taken over: %d %v", e.vendor.Polls, err)
	}
	if got := transcription(t, s, tr.ID); got.Status != TranscriptionRunning || got.LeaseUntil.Valid {
		t.Fatalf("still running = %+v", got)
	}
	// Done: segments, labels, minutes, audit, event in one go.
	due(t, s, m.ID)
	if err := s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	got = transcription(t, s, tr.ID)
	if got.Status != TranscriptionComplete || got.AudioSeconds.Int32 != 125 || !got.CompletedAt.Valid {
		t.Fatalf("after completion = %+v", got)
	}
	// The vendor's copy is deleted once the transcript is ours (§7.5).
	if len(e.vendor.Deletes) != 1 || e.vendor.Deletes[0] != got.ProviderJobID {
		t.Fatalf("vendor deletes = %v, job %q", e.vendor.Deletes, got.ProviderJobID)
	}
	segs, err := s.q.ListTranscriptSegmentsLatest(ctx, db.ListTranscriptSegmentsLatestParams{
		MeetingID: m.ID, RowLimit: 10, Rich: true, TranscriptionIds: []string{tr.ID},
	})
	if err != nil || len(segs) != 2 {
		t.Fatalf("segments = %d %v", len(segs), err)
	}
	second := segs[0] // newest first
	if second.Source != "TRANSCRIPTION" || second.SpeakerLabel != "upload:"+tr.ID+":B" || second.StartMs.Int32 != 2500 ||
		!second.SpokenAt.Time.Equal(tr.StartsAt.Time.Add(2500*time.Millisecond)) {
		t.Fatalf("segment = %+v", second)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_speaker_labels WHERE meeting_id = $1 AND label_key LIKE 'upload:%'`, m.ID); n != 2 {
		t.Fatalf("upload labels = %d", n)
	}
	if spent := transcriptionMinutes(t, s, m.OrganizationID) - before; spent != 3 {
		t.Fatalf("metered %d minutes for 125 s reported", spent)
	}
	var status string
	if err := s.pool.QueryRow(ctx, `SELECT status FROM ai_usage_events WHERE id = $1 AND capability = 'meeting_transcribe'`, got.UsageEventID.String).Scan(&status); err != nil || status != "succeeded" {
		t.Fatalf("usage row = %q %v", status, err)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`, tr.ID, audit.ActionMeetingTranscriptionCompleted); n != 1 {
		t.Fatalf("completed audit rows = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'transcription.completed' AND payload::jsonb->>'transcription_id' = $1`, tr.ID); n != 1 {
		t.Fatalf("completed events = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'TRANSCRIPTION_COMPLETED'`, m.ID); n != 1 {
		t.Fatalf("timeline rows = %d", n)
	}
}

// Without a reported duration the size estimate is billed.
func TestTranscriptionBillsTheEstimateWithoutAReportedDuration(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(150, "d")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	before := transcriptionMinutes(t, e.s, e.m.OrganizationID)
	for range 2 {
		due(t, e.s, e.m.ID)
		if err := e.s.runTranscriptions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionComplete || got.AudioSeconds.Int32 != 150 {
		t.Fatalf("transcription = %+v", got)
	}
	if spent := transcriptionMinutes(t, e.s, e.m.OrganizationID) - before; spent != 3 {
		t.Fatalf("metered %d minutes for a 150 s estimate", spent)
	}
}

func TestTranscriptionFailsAfterThreeAttempts(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.SubmitErr = errors.New("vendor down")
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, "e")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	for attempt := int32(1); attempt <= transcriptionMaxAttempts; attempt++ {
		due(t, e.s, e.m.ID)
		if err := e.s.runTranscriptions(ctx); err != nil {
			t.Fatal(err)
		}
		got := transcription(t, e.s, tr.ID)
		if got.Attempts != attempt || got.ErrorCode != transcriptionErrProvider {
			t.Fatalf("attempt %d: %+v", attempt, got)
		}
		if attempt < transcriptionMaxAttempts && (got.Status != TranscriptionQueued || !got.NextAttemptAt.Time.After(time.Now().Add(30*time.Second))) {
			t.Fatalf("attempt %d not retried after a pause: %+v", attempt, got)
		}
	}
	got := transcription(t, e.s, tr.ID)
	if got.Status != TranscriptionFailed || !got.CompletedAt.Valid {
		t.Fatalf("after three attempts = %+v", got)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2`, tr.ID, audit.ActionMeetingTranscriptionFailed); n != 1 {
		t.Fatalf("failed audit rows = %d", n)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM outbox_events WHERE topic = 'transcription.failed' AND payload::jsonb->>'transcription_id' = $1`, tr.ID); n != 1 {
		t.Fatalf("failed events = %d", n)
	}
	// A failed file may be queued again.
	e.vendor.SubmitErr = nil
	if _, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: tr.FileID, Consent: true}); err != nil {
		t.Fatalf("requeue after FAILED: %v", err)
	}
}

// Parent spec §7.3: the transcript is the scribe's lines plus, per uploaded
// file, its latest COMPLETE transcription, in spoken order; captions only
// when neither exists. The summary reads the same set.
func TestTranscriptSourceRule(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	s, m := e.s, e.m
	t0 := m.ActualStartAt.Time
	insert := func(source, transcriptionID, text string, at time.Duration) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, `INSERT INTO meeting_transcript_segments (id, meeting_id, organization_id, speaker_name, text, spoken_at, source, transcription_id)
			VALUES ($1, $2, $3, 'X', $4, $5, $6, NULLIF($7, ''))`, util.NewID(), m.ID, m.OrganizationID, text, t0.Add(at), source, transcriptionID); err != nil {
			t.Fatal(err)
		}
	}
	texts := func() []string {
		t.Helper()
		page, err := s.Transcript(ctx, e.member.ID, m.ID, FeedQuery{})
		if err != nil {
			t.Fatal(err)
		}
		out := make([]string, 0, len(page.Items))
		for _, g := range page.Items {
			out = append(out, g.Text)
		}
		return out
	}
	insert("CAPTION", "", "caption", time.Second)
	if got := texts(); len(got) != 1 || got[0] != "caption" {
		t.Fatalf("captions only = %v", got)
	}
	// Two files, the first transcribed twice: only its latest COMPLETE run
	// counts; a run still queued counts for nothing.
	complete := func(fileID string, at time.Duration) string {
		t.Helper()
		id := util.NewID()
		if _, err := s.pool.Exec(ctx, `INSERT INTO meeting_transcriptions (id, organization_id, workspace_id, meeting_id, file_id, content_type, size_bytes,
			estimated_seconds, starts_at, language, status, created_by, created_by_kind, completed_at)
			VALUES ($1, $2, $3, $4, $5, 'audio/mpeg', 1, 1, $6, 'vi', 'COMPLETE', $7, 'human', now() + make_interval(secs => $8))`,
			id, m.OrganizationID, m.WorkspaceID, m.ID, fileID, t0, e.host.ID, at.Seconds()); err != nil {
			t.Fatal(err)
		}
		return id
	}
	old := complete("file-1", 0)
	latest := complete("file-1", time.Second)
	other := complete("file-2", 0)
	insert("TRANSCRIPTION", old, "file 1 old run", 2*time.Second)
	insert("TRANSCRIPTION", latest, "file 1 at 3s", 3*time.Second)
	insert("TRANSCRIPTION", other, "file 2 at 10s", 10*time.Second)
	insert("AGENT", "", "agent at 5s", 5*time.Second)
	// A completed upload replaces the scribe's lines (UNI-1995 #11): one
	// transcript, never both copies of the same speech.
	want := []string{"file 1 at 3s", "file 2 at 10s"}
	got := texts()
	if len(got) != len(want) {
		t.Fatalf("rich transcript = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("rich transcript = %v, want %v", got, want)
		}
	}
	// The summary input is the same set.
	llm := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Xong.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s.AI = ai.NewGateway(s.q, llm, NewAIQuota(s.ent), nil, ai.Options{})
	if _, err := s.Summarize(ctx, e.host.ID, m.ID, "vi"); err != nil {
		t.Fatal(err)
	}
	prompt := llm.Last.Messages[len(llm.Last.Messages)-1].Content
	for _, w := range want {
		if !bytes.Contains([]byte(prompt), []byte(w)) {
			t.Fatalf("summary input lacks %q: %s", w, prompt)
		}
	}
	if bytes.Contains([]byte(prompt), []byte("caption")) || bytes.Contains([]byte(prompt), []byte("old run")) || bytes.Contains([]byte(prompt), []byte("agent at 5s")) {
		t.Fatalf("summary input carries a superseded source: %s", prompt)
	}
}

// Fix round 1 (UNI-2001 review).

// Two workers on one due row: the first holds it through the vendor call,
// the second finds nothing to claim, and the vendor sees one submit.
func TestTranscriptionWorkersRacingSubmitOnce(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(60, "race")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	inside, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	e.vendor.OnSubmit = func(provider.FileTranscribeRequest) {
		once.Do(func() { close(inside) })
		<-release
	}
	done := make(chan error, 1)
	go func() { done <- e.s.runTranscriptions(ctx) }()
	<-inside
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	got := transcription(t, e.s, tr.ID)
	if len(e.vendor.Submits) != 1 || got.Status != TranscriptionRunning || got.Attempts != 1 {
		t.Fatalf("submits = %d, row = %s attempt %d", len(e.vendor.Submits), got.Status, got.Attempts)
	}
}

// A holder that lost its lease while the vendor answered records nothing,
// settles that submit's usage row, and the next holder submits again (the
// vendor has no idempotency key: a second vendor job, the residual risk).
func TestTranscriptionLostLeaseSubmitsAgain(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(60, "lost")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	e.vendor.OnSubmit = func(provider.FileTranscribeRequest) {
		e.vendor.OnSubmit = nil
		if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET lease_until = now() + interval '5 minutes' WHERE id = $1`, tr.ID); err != nil {
			t.Error(err)
		}
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionQueued || got.Attempts != 0 || got.ProviderJobID != "" {
		t.Fatalf("a lost lease recorded the submit: %+v", got)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM ai_usage_events WHERE organization_id = $1 AND capability = 'meeting_transcribe' AND status = 'pending'`, e.m.OrganizationID); n != 0 {
		t.Fatalf("%d usage rows left pending", n)
	}
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET lease_until = NULL WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if len(e.vendor.Submits) != 2 {
		t.Fatalf("submits = %+v", e.vendor.Submits)
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionRunning || got.Attempts != 1 {
		t.Fatalf("after the resubmit = %s %d", got.Status, got.Attempts)
	}
}

// The flag is the legal kill switch (§7.5): with it off, a queued job is not
// sent and keeps its attempts.
func TestTranscriptionKillSwitchHoldsQueuedJobs(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(60, "kill")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	e.s.SetFlags(mcpFlagsExcept{off: transcriptionFlag})
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionQueued || got.Attempts != 0 || len(e.vendor.Submits) != 0 {
		t.Fatalf("sent with the flag off: %s %d submits %d", got.Status, got.Attempts, len(e.vendor.Submits))
	}
	e.s.SetFlags(mcpFlagsExcept{})
	due(t, e.s, e.m.ID)
	if err := e.s.runTranscriptions(ctx); err != nil || len(e.vendor.Submits) != 1 {
		t.Fatalf("flag back on: submits %d %v", len(e.vendor.Submits), err)
	}
}

// Silent audio is COMPLETE with no lines and no minutes.
func TestTranscriptionSilentAudioBillsNothing(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.Silent = true
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(120, "quiet")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	before := transcriptionMinutes(t, e.s, e.m.OrganizationID)
	for range 2 {
		due(t, e.s, e.m.ID)
		if err := e.s.runTranscriptions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	got := transcription(t, e.s, tr.ID)
	if got.Status != TranscriptionComplete || got.AudioSeconds.Int32 != 0 {
		t.Fatalf("silent = %+v", got)
	}
	if spent := transcriptionMinutes(t, e.s, e.m.OrganizationID) - before; spent != 0 {
		t.Fatalf("silent audio metered %d minutes", spent)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM meeting_transcript_segments WHERE transcription_id = $1`, tr.ID); n != 0 {
		t.Fatalf("silent audio left %d segments", n)
	}
}

// The job deadline is judged on the database clock.
func TestTranscriptionDeadlineFailsTheAttempt(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.Pending = 100
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(60, "late")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET deadline_at = now() - interval '1 second', next_attempt_at = now() WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionQueued || got.ErrorCode != transcriptionErrTimeout || e.vendor.Polls != 0 {
		t.Fatalf("past deadline = %s %q polls %d", got.Status, got.ErrorCode, e.vendor.Polls)
	}
}

// Only the uploader queues a recording, and only for the meeting it was
// uploaded for.
func TestTranscriptionUploadIsBoundToItsUploaderAndMeeting(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	part := e.upload(t, "hop.mp3", mp3(60, "bound"))
	if _, err := e.s.pool.Exec(ctx, `UPDATE workspace_members SET role = 'admin' WHERE user_id = $1`, e.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RequestTranscription(ctx, e.member.ID, e.m.ID, TranscriptionRequest{UploadID: part, Consent: true}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another clerk queued the host's recording: %v", err)
	}
	start := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	other, err := e.s.Create(ctx, e.host.ID, e.m.WorkspaceID, CreateMeetingInput{Title: "Họp khác", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	held := time.Now().Add(-time.Hour).Truncate(time.Second)
	if other, err = e.s.RecordHeld(ctx, e.host.ID, other.ID, held, held.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RequestTranscription(ctx, e.host.ID, other.ID, TranscriptionRequest{UploadID: part, Consent: true}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a recording was queued for another meeting: %v", err)
	}
	if _, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: part, Consent: true}); err != nil {
		t.Fatalf("the uploader, its meeting: %v", err)
	}
}

// The estimate reads the recording's own header: a 32 kbit/s MP3 is four
// times longer than the size-only table says, and so is its charge.
func TestTranscriptionEstimateReadsTheHeader(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	body := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x00"), 0xff, 0xfb, 0x10, 0x64)
	body = append(body, bytes.Repeat([]byte{0}, 600*4000-len(body))...)
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "32k.mp3", body), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if tr.EstimatedSeconds != 600 {
		t.Fatalf("estimate = %d, want 600", tr.EstimatedSeconds)
	}
}

// The upload session refuses, with 402, a recording the plan cannot pay
// for, before any byte is sent.
func TestOpenAudioUploadSessionChecksTheMinutesFirst(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	head := mp3(1, "head")
	in := OpenUploadSessionInput{
		Filename: "hop.mp3", SizeBytes: 3600 * 16000, IdempotencyKey: util.NewID(),
		Probe: UploadSessionProbeInput{HeadB64: base64.StdEncoding.EncodeToString(head)},
	}
	setTranscriptionQuota(t, e.s, e.m.OrganizationID, 30)
	if _, err := e.s.OpenAudioUploadSession(ctx, e.host.ID, e.m.ID, in, 0); err == nil {
		t.Fatal("an hour of audio opened against 30 minutes")
	} else if code, status := codedOf(err); code != "quota_exceeded" || status != http.StatusPaymentRequired {
		t.Fatalf("over quota = %v", err)
	}
	// Within the minutes it gets past the check (no session service is wired
	// here, so it stops at 503).
	// The browser read 20 minutes from the file's own metadata: that is
	// what the check counts.
	if _, err := e.s.OpenAudioUploadSession(ctx, e.host.ID, e.m.ID, in, 1200); err == nil {
		t.Fatal("opened without a session service")
	} else if code, _ := codedOf(err); code != "transcription_unavailable" {
		t.Fatalf("a reported 20 minutes against 30 = %v", err)
	}
	setTranscriptionQuota(t, e.s, e.m.OrganizationID, 120)
	if _, err := e.s.OpenAudioUploadSession(ctx, e.host.ID, e.m.ID, in, 0); err == nil {
		t.Fatal("opened without a session service")
	} else if code, _ := codedOf(err); code != "transcription_unavailable" {
		t.Fatalf("within quota = %v", err)
	}
}

// Labels of an uploaded file's superseded runs are neither listed nor
// counted; the latest run's are numbered from one.
func TestSpeakerLabelsHideSupersededUploadRuns(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	var oldLabel string
	run := func(at time.Duration) string {
		t.Helper()
		id := util.NewID()
		if _, err := e.s.pool.Exec(ctx, `INSERT INTO meeting_transcriptions (id, organization_id, workspace_id, meeting_id, file_id, content_type, size_bytes,
			estimated_seconds, starts_at, language, status, created_by, created_by_kind, completed_at)
			VALUES ($1, $2, $3, $4, 'file-1', 'audio/mpeg', 1, 1, now(), 'vi', 'COMPLETE', $5, 'human', now() + make_interval(secs => $6))`,
			id, e.m.OrganizationID, e.m.WorkspaceID, e.m.ID, e.host.ID, at.Seconds()); err != nil {
			t.Fatal(err)
		}
		for _, l := range []string{"1", "2"} {
			lid := util.NewID()
			if _, err := e.s.q.InsertMeetingSpeakerLabel(ctx, db.InsertMeetingSpeakerLabelParams{
				ID: lid, OrganizationID: e.m.OrganizationID, WorkspaceID: e.m.WorkspaceID, MeetingID: e.m.ID,
				LabelKey: "upload:" + id + ":" + l, CreatedBy: "meeting_transcription", CreatedByKind: "system",
			}); err != nil {
				t.Fatal(err)
			}
			if oldLabel == "" {
				oldLabel = lid
			}
		}
		return id
	}
	old := run(0)
	latest := run(time.Second)
	labels, err := e.s.SpeakerLabels(ctx, e.member.ID, e.m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(labels) != 2 {
		t.Fatalf("labels = %d, want the latest run's 2", len(labels))
	}
	for i, l := range labels {
		if !strings.HasPrefix(l.LabelKey, "upload:"+latest+":") || l.Number != int32(i+1) || strings.Contains(l.LabelKey, old) {
			t.Fatalf("label %d = %s number %d", i, l.LabelKey, l.Number)
		}
	}
	// Naming a hidden label is refused before anything is written.
	if _, err := e.s.AssignSpeakerLabel(ctx, e.host.ID, e.m.ID, oldLabel, nil, ptr("Chị Lan")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("assigning a superseded run's label = %v, want not found", err)
	}
	var name string
	if err := e.s.pool.QueryRow(ctx, `SELECT name FROM meeting_speaker_labels WHERE id = $1`, oldLabel).Scan(&name); err != nil || name != "" {
		t.Fatalf("the hidden label changed: %q %v", name, err)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM audit_events WHERE resource_id = $1`, oldLabel); n != 0 {
		t.Fatalf("%d audit rows for a refused assignment", n)
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM outbox_events WHERE topic = 'speaker_label.updated' AND payload::jsonb->>'meeting_id' = $1`, e.m.ID); n != 0 {
		t.Fatalf("%d speaker_label.updated events for a refused assignment", n)
	}
}

// A refusal the vendor will repeat (400/401/403/422 at submit, a transcript
// failed for its audio) ends the job at once; one it could not download
// is tried again.
func TestTranscriptionPermanentRefusalFailsAtOnce(t *testing.T) {
	for _, tc := range []struct {
		name       string
		submit     error
		poll       error
		wantStatus string
	}{
		{"submit 400", &provider.FileJobError{Code: "400", Permanent: true}, nil, TranscriptionFailed},
		{"transcript error", nil, &provider.FileJobError{Code: "error", Permanent: true, Reason: "Transcoding failed"}, TranscriptionFailed},
		{"download error", nil, &provider.FileJobError{Code: "error", Reason: "Download error, unable to download <url>"}, TranscriptionQueued},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := transcriptionFixture(t)
			ctx := context.Background()
			e.vendor.SubmitErr, e.vendor.PollErr = tc.submit, tc.poll
			tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, tc.name)), Consent: true})
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				due(t, e.s, e.m.ID)
				if err := e.s.runTranscriptions(ctx); err != nil {
					t.Fatal(err)
				}
			}
			got := transcription(t, e.s, tr.ID)
			if got.Status != tc.wantStatus || got.Attempts != 1 || got.ErrorCode != transcriptionErrProvider || len(e.vendor.Submits) != 1 {
				t.Fatalf("%s = %s attempts %d %q, %d submits", tc.name, got.Status, got.Attempts, got.ErrorCode, len(e.vendor.Submits))
			}
		})
	}
}

// A rate-limited submit waits the vendor's pause without spending an attempt.
func TestTranscriptionRateLimitedSubmitWaits(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.SubmitErr = &provider.RetryAfterError{After: 90 * time.Second}
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, "429")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	got := transcription(t, e.s, tr.ID)
	if wait := time.Until(got.NextAttemptAt.Time); got.Status != TranscriptionQueued || got.Attempts != 0 || wait < 80*time.Second || wait > 100*time.Second {
		t.Fatalf("rate limited = %s attempts %d, next in %v", got.Status, got.Attempts, wait)
	}
}

// Deleting the vendor's copy is best effort: a failure leaves the job done.
func TestTranscriptionVendorDeleteFailureKeepsTheJob(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.DeleteErr = errors.New("vendor down")
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, "del")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		due(t, e.s, e.m.ID)
		if err := e.s.runTranscriptions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionComplete || len(e.vendor.Deletes) != 1 {
		t.Fatalf("after a failed delete = %s, deletes %v", got.Status, e.vendor.Deletes)
	}
}

// The duration the browser read from the file's metadata replaces the
// size-based estimate, held between the type's ceiling (320 kbit/s audio,
// 20 Mbit/s video) and 12 kbit/s of the file's size.
func TestTranscriptionEstimateTakesTheReportedDuration(t *testing.T) {
	const size = 18 * 60 * 2_000_000 // 18 minutes of 16 Mbit/s phone video
	for _, tc := range []struct {
		reported float64
		want     int32
	}{
		{0, int32(math.Ceil(size / 125000.0))}, // missing: today's estimate
		{1080, 1080},
		{1, size / 2_500_000}, // too short: 20 Mbit/s is the video ceiling
		{1e9, size / 1_500},   // too long: 12 kbit/s is the floor
		{math.NaN(), int32(math.Ceil(size / 125000.0))},
	} {
		if got := estimateSeconds(size, "video/mp4", nil, tc.reported); got != tc.want {
			t.Errorf("reported %v: estimate %d, want %d", tc.reported, got, tc.want)
		}
	}
	// A 2 GiB M4A cannot claim nine minutes to slip under the plan: audio
	// plays at 320 kbit/s at most.
	const m4a = 2 << 30
	if got := estimateSeconds(m4a, "audio/mp4", nil, 540); got < m4a/40_000 {
		t.Fatalf("2 GiB m4a claiming 540 s = %d s, want >= %d", got, m4a/40_000)
	}
	e := transcriptionFixture(t)
	tr, err := e.s.RequestTranscription(context.Background(), e.host.ID, e.m.ID,
		TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(600, "dur")), Consent: true, DurationSeconds: 590.4})
	if err != nil {
		t.Fatal(err)
	}
	if tr.EstimatedSeconds != 591 {
		t.Fatalf("estimate = %d, want the reported 591", tr.EstimatedSeconds)
	}
}

// A job still queued a day after it was requested (a vendor answering 429
// forever, a kill switch never lifted) ends FAILED with timeout, its audit
// row and its transcription.failed event (the requester's notification).
func TestTranscriptionQueuedForADayFails(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	e.vendor.SubmitErr = &provider.RetryAfterError{After: time.Minute}
	tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, "day")), Consent: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionQueued {
		t.Fatalf("rate limited = %s", got.Status)
	}
	if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET created_at = now() - interval '25 hours' WHERE id = $1`, tr.ID); err != nil {
		t.Fatal(err)
	}
	due(t, e.s, e.m.ID)
	if err := e.s.runTranscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	got := transcription(t, e.s, tr.ID)
	if got.Status != TranscriptionFailed || got.ErrorCode != transcriptionErrTimeout || len(e.vendor.Submits) != 1 {
		t.Fatalf("a day in the queue = %s %q, %d submits", got.Status, got.ErrorCode, len(e.vendor.Submits))
	}
	if n := countWhere(t, e.s, `SELECT count(*) FROM outbox_events WHERE topic = 'transcription.failed' AND payload::jsonb->>'transcription_id' = $1`, tr.ID); n != 1 {
		t.Fatalf("transcription.failed events = %d", n)
	}
}

// The vendor's copy of a job the worker gives up on is deleted too: one
// abandoned at its deadline (it may still finish there), and one replaced
// by a new job after a download error. Against AssemblyAI's own contract.
func TestTranscriptionDeletesAbandonedVendorJobs(t *testing.T) {
	for _, tc := range []struct {
		name, poll string
		deadline   bool
	}{
		{"deadline", `{"id":"job-1","status":"processing"}`, true},
		{"download error", `{"id":"job-1","status":"error","error":"Download error, unable to download https://x/a.mp3"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			var deletes []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method {
				case http.MethodPost:
					_, _ = w.Write([]byte(`{"id":"job-1","status":"queued"}`))
				case http.MethodGet:
					_, _ = w.Write([]byte(tc.poll))
				case http.MethodDelete:
					mu.Lock()
					deletes = append(deletes, r.URL.Path)
					mu.Unlock()
					_, _ = w.Write([]byte(`{"id":"job-1","status":"completed"}`))
				}
			}))
			defer srv.Close()
			e := transcriptionFixture(t)
			e.s.AI = ai.NewGateway(e.s.q, nil, nil, nil, ai.Options{Cloud: ai.CloudTools{MeetingTranscriber: provider.NewAssemblyAIFileTranscriber(srv.URL, "k")}})
			ctx := context.Background()
			tr, err := e.s.RequestTranscription(ctx, e.host.ID, e.m.ID, TranscriptionRequest{UploadID: e.upload(t, "hop.mp3", mp3(30, tc.name)), Consent: true})
			if err != nil {
				t.Fatal(err)
			}
			if err := e.s.runTranscriptions(ctx); err != nil {
				t.Fatal(err)
			}
			if tc.deadline {
				if _, err := e.s.pool.Exec(ctx, `UPDATE meeting_transcriptions SET deadline_at = now() - interval '1 second' WHERE id = $1`, tr.ID); err != nil {
					t.Fatal(err)
				}
			}
			due(t, e.s, e.m.ID)
			if err := e.s.runTranscriptions(ctx); err != nil {
				t.Fatal(err)
			}
			if got := transcription(t, e.s, tr.ID); got.Status != TranscriptionQueued || got.Attempts != 1 {
				t.Fatalf("after giving up = %s attempts %d", got.Status, got.Attempts)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(deletes) != 1 || deletes[0] != "/v2/transcript/job-1" {
				t.Fatalf("vendor deletes = %v", deletes)
			}
		})
	}
}

// A file whose re-run failed still shows its earlier COMPLETE run, so the
// next file still starts after it.
func TestTranscriptionFileStartCountsAFileWhoseReRunFailed(t *testing.T) {
	e := transcriptionFixture(t)
	ctx := context.Background()
	s, m := e.s, e.m
	run := func(fileID, status string, seconds, age int) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, `INSERT INTO meeting_transcriptions (id, organization_id, workspace_id, meeting_id, file_id, content_type, size_bytes,
			estimated_seconds, audio_seconds, starts_at, language, status, created_by, created_by_kind, created_at)
			VALUES ($1, $2, $3, $4, $5, 'audio/mpeg', 1, $6, $6, $7, 'vi', $8, $9, 'human', now() - make_interval(secs => $10))`,
			util.NewID(), m.OrganizationID, m.WorkspaceID, m.ID, fileID, seconds, m.ActualStartAt, status, e.host.ID, age); err != nil {
			t.Fatal(err)
		}
	}
	run("file-a", TranscriptionComplete, 3600, 20)
	run("file-a", TranscriptionFailed, 3600, 10)
	run("file-gone", TranscriptionFailed, 900, 5)
	start, err := s.q.MeetingTranscriptionFileStart(ctx, db.MeetingTranscriptionFileStartParams{MeetingID: m.ID, FileID: "file-b"})
	if err != nil {
		t.Fatal(err)
	}
	if start.PreviousStart.Valid || start.EarlierSeconds != 3600 {
		t.Fatalf("start = %+v, want no previous start and 3600 s earlier", start)
	}
}
