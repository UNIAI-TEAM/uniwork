package service

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FS-path tests for the recording lane (UNI-746). filesfake plays the
// FileService; meetings.FakeProvider captures the write target the egress
// would receive. One recording, one file, one path.

// fakeMP4 is the smallest byte string the sniffer reports as video/mp4: an
// ftyp box signature at offset 4.
func fakeMP4() []byte {
	// A minimal well-formed ftyp box: boxLen 16, major brand mp42, no
	// compatible brands. DetectContentType validates every brand is
	// printable, so padding must stay outside the declared box length.
	body := []byte{0x00, 0x00, 0x00, 0x10, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0x00, 0x00, 0x00, 0x00}
	return append(body, make([]byte, 128)...)
}

// providerOutput reconstructs the ProviderOutput the service reserved for a
// recording row: WriteProviderOutput only needs the file id.
func providerOutput(fileID string) files.ProviderOutput {
	return files.ProviderOutput{FileID: files.FileID(fileID)}
}

// countingPublisher records published events so a test can assert a webhook
// replay does not re-fire recording.ready.
type countingPublisher struct {
	mu     sync.Mutex
	events []Event
}

func (p *countingPublisher) Publish(_ context.Context, _ string, ev Event) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, ev)
}

func (p *countingPublisher) PublishToScope(context.Context, string, string, Event) {}
func (p *countingPublisher) SendToUser(context.Context, string, Event)             {}
func (p *countingPublisher) SendToUsers(context.Context, []string, Event)          {}

func (p *countingPublisher) count(eventType string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, ev := range p.events {
		if ev.Type == eventType {
			n++
		}
	}
	return n
}

func TestMeetingRecordingFileServiceLifecycle(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "FS recording")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Intent before provider start: the row carries file_id, never file_url,
	// and the provider was handed a write target instead of a file prefix.
	if !rec.FileID.Valid || rec.FileID.String == "" {
		t.Fatalf("FS row has no file_id: %+v", rec)
	}
	if rec.FileUrl.Valid {
		t.Fatalf("legacy locator on an FS row: %+v", rec)
	}
	out := fp.LastRecording.OutputTarget
	if out == nil {
		t.Fatal("provider did not receive a write target")
	}
	// Recording purposes mint "<file_id>.mp4": LiveKit appends an extension to
	// extension-less filepaths, so the reserved key carries it (T3 ObjectKeySuffix).
	if !strings.HasSuffix(out.URL, "/"+rec.FileID.String+".mp4") {
		t.Fatalf("write target %q does not name file %q", out.URL, rec.FileID.String)
	}
	if out.Method != "PUT" || out.ExpiresAt.IsZero() {
		t.Fatalf("bad write target: %+v", out)
	}
	if fp.RecordCalls != 1 {
		t.Fatalf("record calls = %d", fp.RecordCalls)
	}

	// The provider writes the object through the target; the webhook then
	// verifies, claims and completes the row.
	if err := fake.WriteProviderOutput(providerOutput(rec.FileID.String), fakeMP4(), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-fs-1",
		RecordingID: rec.EgressID, RecordingURL: "https://must.not/be-stored.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 {
		t.Fatalf("recordings: %+v err=%v", recs, err)
	}
	if recs[0].Status != RecordingComplete || recs[0].FileUrl.Valid {
		t.Fatalf("finished FS row: %+v", recs[0])
	}

	// Playback resolves through FileService: presigned URL for the browser,
	// range-open for the proxy route.
	url, err := s.ResolveMeetingRecordingPlaybackURL(ctx, ua.ID, "", m.ID, rec.ID)
	if err != nil || url.URL == "" || url.ExpiresAt.IsZero() {
		t.Fatalf("resolve: %+v err=%v", url, err)
	}
	size, err := s.MeetingRecordingFileSize(ctx, ua.ID, "", m.ID, rec.ID)
	if err != nil || size != int64(len(fakeMP4())) {
		t.Fatalf("size = %d err=%v", size, err)
	}
	body, err := s.OpenMeetingRecording(ctx, ua.ID, "", m.ID, rec.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(body)
	body.Close()
	if err != nil || string(got) != "ftyp" {
		t.Fatalf("range read = %q err=%v", got, err)
	}
}

func TestMeetingRecordingFileServiceReplayAndLateEvents(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Replay")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := fake.WriteProviderOutput(providerOutput(rec.FileID.String), fakeMP4(), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	ev := ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-replay-1",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket/rec.mp4",
	}
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingComplete {
		t.Fatalf("finish: %+v err=%v", recs, err)
	}

	// A replay under a different provider event id is a no-op: the row is
	// terminal and the file is already claimed.
	replay := ev
	replay.ProviderEventID = "ev-replay-2"
	if err := s.HandleProviderEvent(ctx, replay); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || recs[0].Status != RecordingComplete || recs[0].FileUrl.Valid {
		t.Fatalf("after replay: %+v err=%v", recs, err)
	}

	// A failed egress fails the row and never claims the file, and a late
	// success does not resurrect it.
	m2, err := s.CreateInstant(ctx, ua.ID, w.ID, "Late events")
	if err != nil {
		t.Fatal(err)
	}
	rec2, err := s.StartRecording(ctx, ua.ID, m2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-failed",
		RecordingID: rec2.EgressID, RecordingFailed: true,
	}); err != nil {
		t.Fatal(err)
	}
	recs2, err := s.Recordings(ctx, ua.ID, "", m2.ID)
	if err != nil || len(recs2) != 1 || recs2[0].Status != RecordingFailed || recs2[0].FileUrl.Valid {
		t.Fatalf("failed row: %+v err=%v", recs2, err)
	}
	if _, err := fake.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID},
		FileID: files.FileID(rec2.FileID.String),
	}); err == nil {
		t.Fatal("pending provider output is openable")
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-late-success",
		RecordingID: rec2.EgressID, RecordingURL: "https://bucket/late.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs2, err = s.Recordings(ctx, ua.ID, "", m2.ID)
	if err != nil || recs2[0].Status != RecordingFailed || recs2[0].FileUrl.Valid {
		t.Fatalf("late success resurrected the recording: %+v", recs2)
	}
}

func TestMeetingRecordingFileServiceStorageDownRetries(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Storage down")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := fake.WriteProviderOutput(providerOutput(rec.FileID.String), fakeMP4(), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	fake.SetStorageDown(true)
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-down",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket/down.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	// storage_unavailable is retryable: the row stays PROCESSING, nothing is
	// claimed, and the webhook URL never lands.
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingProcessing || recs[0].FileUrl.Valid {
		t.Fatalf("during outage: %+v err=%v", recs, err)
	}
	fake.SetStorageDown(false)
	// LiveKit webhook retries reuse the same provider event id — the dedup
	// guard must let recording_ended re-enter the idempotent finish path.
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-down",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket/down.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || recs[0].Status != RecordingComplete {
		t.Fatalf("after retry: %+v err=%v", recs, err)
	}
	if url, err := s.ResolveMeetingRecordingPlaybackURL(ctx, ua.ID, "", m.ID, rec.ID); err != nil || url.URL == "" {
		t.Fatalf("resolve after retry: %+v err=%v", url, err)
	}
}

func TestMeetingRecordingFSRowUnwiredFinishIsNonTerminal(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Unwired finish")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := fake.WriteProviderOutput(providerOutput(rec.FileID.String), fakeMP4(), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	// An FS-backed row must never take the legacy finish path, even when the
	// seam is unwired at webhook time: the row stays non-terminal, loud, with
	// no file_url.
	s.SetFiles(nil)
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-unwired",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket/unwired.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingProcessing || recs[0].FileUrl.Valid {
		t.Fatalf("unwired finish must stay non-terminal: %+v err=%v", recs, err)
	}
	// Re-wiring lets the same event redelivery land it.
	s.SetFiles(fake)
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-unwired",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket/unwired.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || recs[0].Status != RecordingComplete {
		t.Fatalf("re-wired retry should complete: %+v err=%v", recs, err)
	}
}

func TestMeetingRecordingFSFailedEgressDuplicateDoesNotRepublish(t *testing.T) {
	// Mirror meetingFixture but inject a counting publisher.
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "a@example.com", "A")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-alpha")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	w := v.Workspace
	pub := &countingPublisher{}
	s := NewMeetingService(pool, q, ws, pub, &meetings.FakeProvider{}, MeetingRuntime{TokenTTL: 2 * time.Minute, HMACKey: []byte("t")})

	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Failed egress replay")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	fail := ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-fail",
		RecordingID: rec.EgressID, RecordingFailed: true,
	}
	if err := s.HandleProviderEvent(ctx, fail); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingFailed {
		t.Fatalf("first failure should land FAILED: %+v err=%v", recs, err)
	}
	if got := pub.count("recording.ready"); got != 1 {
		t.Fatalf("expected 1 recording.ready after first failure, got %d", got)
	}
	// Webhook retry reuses the same provider event id: dedup re-enters the
	// finish path, but the terminal row must not re-fire the event.
	for i := 0; i < 2; i++ {
		if err := s.HandleProviderEvent(ctx, fail); err != nil {
			t.Fatal(err)
		}
	}
	if got := pub.count("recording.ready"); got != 1 {
		t.Fatalf("duplicate failed egress re-published recording.ready: got %d", got)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || recs[0].Status != RecordingFailed {
		t.Fatalf("row must stay FAILED: %+v err=%v", recs, err)
	}
}

func TestMeetingRecordingLegacyPathUnchangedWithoutFiles(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Legacy")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	// No FileService: the provider gets the legacy file prefix, no write
	// target, and the row stays on file_url.
	if rec.FileID.Valid {
		t.Fatalf("legacy row got a file_id: %+v", rec)
	}
	if fp.LastRecording.OutputTarget != nil {
		t.Fatalf("legacy path got a write target: %+v", fp.LastRecording.OutputTarget)
	}
	if !strings.HasPrefix(fp.LastRecording.FilePrefix, "meetings/") {
		t.Fatalf("file prefix = %q", fp.LastRecording.FilePrefix)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-legacy",
		RecordingID: rec.EgressID, RecordingURL: "https://bucket.example/meetings/legacy.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 {
		t.Fatalf("recordings: %+v err=%v", recs, err)
	}
	if recs[0].Status != RecordingComplete || recs[0].FileUrl.String != "https://bucket.example/meetings/legacy.mp4" {
		t.Fatalf("legacy completion: %+v", recs[0])
	}
}

func TestChatVoiceRecordingFileServiceLifecycle(t *testing.T) {
	s, fp, _, ua, ub, w := chatVoiceRecordingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetVoiceRecordingFiles(fake)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "fs-call-1"
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, callID)

	rec, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if !rec.FileID.Valid || rec.FileID.String == "" {
		t.Fatalf("FS row has no file_id: %+v", rec)
	}
	if rec.FileUrl.Valid {
		t.Fatalf("legacy locator on an FS row: %+v", rec)
	}
	out := fp.LastRecording.OutputTarget
	if out == nil || !strings.HasSuffix(out.URL, "/"+rec.FileID.String+".mp4") {
		t.Fatalf("write target: %+v", out)
	}
	if fp.RecordCalls != 1 {
		t.Fatalf("record calls = %d", fp.RecordCalls)
	}

	// A second participant joining the same call does not reserve a second
	// file or open a second egress.
	again, err := s.StartVoiceRecording(ctx, ub.ID, w.ID, dm.ID, callID)
	if err != nil || again.ID != rec.ID {
		t.Fatalf("idempotent start: %+v err=%v", again, err)
	}
	if fp.RecordCalls != 1 {
		t.Fatalf("second start reached the provider: %d", fp.RecordCalls)
	}

	if err := fake.WriteProviderOutput(providerOutput(rec.FileID.String), fakeMP4(), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-chat-fs",
		RecordingID: rec.EgressID, RecordingURL: "https://must.not/be-stored.mp4",
	})
	rows, err := s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows: %+v err=%v", rows, err)
	}
	if rows[0].Status != RecordingComplete || rows[0].FileUrl.Valid {
		t.Fatalf("finished chat FS row: %+v", rows[0])
	}

	url, err := s.ResolveVoiceRecordingPlaybackURL(ctx, ua.ID, w.ID, dm.ID, rec.ID)
	if err != nil || url.URL == "" {
		t.Fatalf("resolve: %+v err=%v", url, err)
	}
	size, err := s.VoiceRecordingFileSize(ctx, ua.ID, w.ID, dm.ID, rec.ID)
	if err != nil || size != int64(len(fakeMP4())) {
		t.Fatalf("size = %d err=%v", size, err)
	}
	body, err := s.OpenVoiceRecording(ctx, ua.ID, w.ID, dm.ID, rec.ID, 0, int64(len(fakeMP4())))
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(body)
	body.Close()
	if err != nil || len(got) != len(fakeMP4()) {
		t.Fatalf("open read %d bytes err=%v", len(got), err)
	}

	// A replayed webhook is a no-op.
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-chat-fs-replay",
		RecordingID: rec.EgressID,
	})
	rows, err = s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || rows[0].Status != RecordingComplete {
		t.Fatalf("after replay: %+v err=%v", rows, err)
	}
}

func TestChatVoiceRecordingFileServiceFailedEgress(t *testing.T) {
	s, _, _, ua, ub, w := chatVoiceRecordingFixture(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetVoiceRecordingFiles(fake)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "fs-call-fail"
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, callID)
	rec, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type:            "conference.recording_ended",
		RecordingID:     rec.EgressID,
		RecordingFailed: true,
	})
	rows, err := s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || len(rows) != 1 || rows[0].Status != RecordingFailed || rows[0].FileUrl.Valid {
		t.Fatalf("failed FS row: %+v err=%v", rows, err)
	}
	if _, err := s.GetVoiceRecordingForPlayback(ctx, ua.ID, w.ID, dm.ID, rec.ID); !codedIs(err, "recording_not_ready") {
		t.Fatalf("failed recording playback: %v", err)
	}
	// A late success does not resurrect it.
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", RecordingID: rec.EgressID,
		RecordingURL: "https://bucket/late.mp4",
	})
	rows, err = s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || rows[0].Status != RecordingFailed {
		t.Fatalf("late success resurrected: %+v", rows)
	}
}

// recordingFixturePair builds a MeetingService and a ChatService on one test
// pool: testutil.DB holds a session advisory lock for the whole test, so two
// fixtures in one test would deadlock on the lock.
func recordingFixturePair(t *testing.T) (*MeetingService, *ChatService, *db.Queries, db.User, db.User, db.Workspace) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "rec-a@example.com", "A")
	ub := registerVerified(t, q, as, "rec-b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-rec")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Rec WS", "rec-ws")
	w := v.Workspace
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	rt := MeetingRuntime{TokenTTL: 2 * time.Minute, HMACKey: []byte("t")}
	return NewMeetingService(pool, q, ws, NopPublisher{}, &meetings.FakeProvider{}, rt),
		NewChatService(pool, q, ws, &capturePublisher{}), q, ua, ub, w
}

func TestRecordingReferenceProviders(t *testing.T) {
	s, cs, q, ua2, ub2, w2 := recordingFixturePair(t)
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua2.ID, w2.ID, "Holds")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua2.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	held, err := s.FileReferenceProvider().HeldBy(ctx, s.q, []files.FileID{files.FileID(rec.FileID.String), "no-such-file"})
	if err != nil {
		t.Fatal(err)
	}
	if held[files.FileID(rec.FileID.String)] != files.HoldActive || len(held) != 1 {
		t.Fatalf("held = %+v", held)
	}
	if name := s.FileReferenceProvider().Name(); name != "meetings.recordings" {
		t.Fatalf("provider name = %q", name)
	}
	if p := s.FileReferenceProvider().Purposes(); len(p) != 1 || p[0] != files.MeetingRecording {
		t.Fatalf("purposes = %+v", p)
	}

	// The chat provider holds call recordings under its own name.
	cs.SetVoiceRecordingFiles(filesfake.New(filesfake.Options{}))
	cs.SetConference(&meetings.FakeProvider{RecordingEnabled: true})
	dm, err := cs.ResolveDM(ctx, ua2.ID, w2.ID, ub2.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "holds-call"
	acceptDMVoiceCall(t, cs, ua2, ub2, w2, dm.ID, callID)
	crec, err := cs.StartVoiceRecording(ctx, ua2.ID, w2.ID, dm.ID, callID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	cheld, err := cs.VoiceRecordingFileReferenceProvider().HeldBy(ctx, q, []files.FileID{files.FileID(crec.FileID.String)})
	if err != nil {
		t.Fatal(err)
	}
	if cheld[files.FileID(crec.FileID.String)] != files.HoldActive {
		t.Fatalf("chat held = %+v", cheld)
	}
	if name := cs.VoiceRecordingFileReferenceProvider().Name(); name != "chat.voice_recordings" {
		t.Fatalf("provider name = %q", name)
	}
}
