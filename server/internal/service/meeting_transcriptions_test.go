package service

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

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
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Họp chi bộ", StartsAt: start, EndsAt: start.Add(time.Hour)})
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
	up, err := e.files.Upload(context.Background(), files.UploadInput{
		Actor: audit.User(e.host.ID), Purpose: files.MeetingAudio, IdempotencyKey: util.NewID(),
		Scope:    files.Scope{OrganizationID: e.m.OrganizationID, WorkspaceID: e.m.WorkspaceID},
		Filename: name, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(up.File.ID)
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
	} else if code, _ := codedOf(err); code != "not_meeting_host" {
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
	if len(e.vendor.Submits) != 1 || e.vendor.Submits[0].AudioURL == "" || e.vendor.Submits[0].MIME != "audio/mpeg" || !e.vendor.Submits[0].Diarize {
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
	segs, err := s.q.ListTranscriptSegmentsLatest(ctx, db.ListTranscriptSegmentsLatestParams{
		MeetingID: m.ID, RowLimit: 10, Rich: true, TranscriptionIds: []string{tr.ID},
	})
	if err != nil || len(segs) != 2 {
		t.Fatalf("segments = %d %v", len(segs), err)
	}
	second := segs[0] // newest first
	if second.Source != "TRANSCRIPTION" || second.SpeakerLabel != "upload:"+tr.ID+":2" || second.StartMs.Int32 != 2500 ||
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
	want := []string{"file 1 at 3s", "agent at 5s", "file 2 at 10s"}
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
	if bytes.Contains([]byte(prompt), []byte("caption")) || bytes.Contains([]byte(prompt), []byte("old run")) {
		t.Fatalf("summary input carries a superseded source: %s", prompt)
	}
}
