package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Buoc 0 regression pins for the recording lane (UNI-746). They describe what
// develop does today on the legacy path - LiveKit Egress behind
// meetings.ConferenceProvider, webhooks through the inbox, playback gated by
// workspace membership or an ACTIVE guest participant row. The FileService
// migration may edit these assertions deliberately; it must not delete the
// cases.

// faultRecordingProvider fails recording commands on demand; the shared
// meetings.FakeProvider only counts calls.
type faultRecordingProvider struct {
	meetings.FakeProvider
	startErr error
	stopErr  error
}

func (p *faultRecordingProvider) StartRecording(ctx context.Context, req meetings.StartRecordingRequest) (meetings.RecordingRef, error) {
	if p.startErr != nil {
		return meetings.RecordingRef{}, p.startErr
	}
	return p.FakeProvider.StartRecording(ctx, req)
}

func (p *faultRecordingProvider) StopRecording(ctx context.Context, req meetings.StopRecordingRequest) error {
	if p.stopErr != nil {
		return p.stopErr
	}
	return p.FakeProvider.StopRecording(ctx, req)
}

func recordingEventPayload(t *testing.T, ev ProviderNeutralEvent) []byte {
	t.Helper()
	payload, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

// completedRecording drives start -> stop -> provider webhook so a playback
// test can reach the COMPLETE branch without LiveKit.
func completedRecording(t *testing.T, s *MeetingService, hostID, meetingID, fileURL string) db.MeetingRecording {
	t.Helper()
	ctx := context.Background()
	rec, err := s.StartRecording(ctx, hostID, meetingID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, hostID, meetingID); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-" + rec.ID,
		RecordingID: rec.EgressID, RecordingURL: fileURL,
	}); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, hostID, "", meetingID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingComplete {
		t.Fatalf("completed recording: %+v err=%v", recs, err)
	}
	return recs[0]
}

func countRows(t *testing.T, s *MeetingService, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMeetingRecordingStartStopLegacyBehavior(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Legacy recording")
	if err != nil {
		t.Fatal(err)
	}

	// Without a recording-capable provider (no S3 bucket) the server refuses
	// up front and never calls the provider.
	var ce CodedError
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Status != 503 || ce.Code != "recording_not_configured" {
		t.Fatalf("capability off: %v", err)
	}
	if fp.RecordCalls != 0 {
		t.Fatalf("provider started without capability: %d", fp.RecordCalls)
	}

	fp.RecordingEnabled = true
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Status != RecordingActive || rec.StartedBy != ua.ID || rec.MeetingID != m.ID || rec.FileUrl.Valid {
		t.Fatalf("started row: %+v", rec)
	}
	if want := "fake-egress-" + meetings.RoomNameForMeeting(m.ID); rec.EgressID != want {
		t.Fatalf("egress id = %q, want %q", rec.EgressID, want)
	}
	if fp.RecordCalls != 1 {
		t.Fatalf("record calls = %d", fp.RecordCalls)
	}

	// One ACTIVE recording per meeting: the second start is a conflict and
	// does not open a second egress.
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); !codedIs(err, "recording_active") {
		t.Fatalf("second start: %v", err)
	}
	if fp.RecordCalls != 1 {
		t.Fatalf("double start reached the provider: %d", fp.RecordCalls)
	}

	// Only the host (or a workspace admin) drives the recording.
	addMember(t, s, w.ID, ub.ID)
	if _, err := s.StartRecording(ctx, ub.ID, m.ID); !codedIs(err, "not_meeting_host") {
		t.Fatalf("member start: %v", err)
	}
	if _, err := s.StopRecording(ctx, ub.ID, m.ID); !codedIs(err, "not_meeting_host") {
		t.Fatalf("member stop: %v", err)
	}
	if fp.StopRecordCalls != 0 {
		t.Fatalf("non-host stop reached the provider: %d", fp.StopRecordCalls)
	}

	// Stop is PROCESSING until the provider webhook carries the file URL.
	stopped, err := s.StopRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != RecordingProcessing || !stopped.EndedAt.Valid || stopped.FileUrl.Valid {
		t.Fatalf("stopped row: %+v", stopped)
	}
	if fp.StopRecordCalls != 1 {
		t.Fatalf("stop calls = %d", fp.StopRecordCalls)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); !codedIs(err, "recording_not_active") {
		t.Fatalf("stop without active: %v", err)
	}

	// Recording requires a live meeting.
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	scheduled, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Scheduled", StartsAt: start, EndsAt: start.Add(30 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartRecording(ctx, ua.ID, scheduled.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("start on a scheduled meeting: %v", err)
	}

	// Both commands leave an audit row naming the actor.
	acts, err := s.Activity(ctx, ua.ID, m.ID, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	actors := map[string]string{}
	for _, a := range acts {
		actors[a.EventType] = a.ActorID
	}
	if actors["RECORDING_STARTED"] != ua.ID || actors["RECORDING_STOPPED"] != ua.ID {
		t.Fatalf("audit rows: %+v", actors)
	}
}

func TestMeetingRecordingProviderFailuresLegacyBehavior(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := &faultRecordingProvider{
		FakeProvider: meetings.FakeProvider{RecordingEnabled: true},
		startErr:     errors.New("egress unavailable"),
	}
	s.provider = fp
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Provider failure")
	if err != nil {
		t.Fatal(err)
	}

	var ce CodedError
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Status != 502 || ce.Code != "recording_failed" {
		t.Fatalf("start failure: %v", err)
	}
	// A failed start leaves no row, so the host can retry.
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 0 {
		t.Fatalf("rows after failed start: %+v err=%v", recs, err)
	}

	fp.startErr = nil
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	// A failed stop keeps the row ACTIVE - the provider never confirmed it, so
	// the recording is not abandoned silently.
	fp.stopErr = errors.New("egress stop unavailable")
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Status != 502 || ce.Code != "recording_failed" {
		t.Fatalf("stop failure: %v", err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingActive {
		t.Fatalf("rows after failed stop: %+v err=%v", recs, err)
	}
}

func TestMeetingRecordingWebhookCompletionLegacyBehavior(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Webhook completion")
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

	const fileURL = "https://bucket.example/meetings/rec.mp4"
	ev := ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-inbox-1",
		RecordingID: rec.EgressID, RecordingURL: fileURL,
	}
	payload := recordingEventPayload(t, ev)
	queued, err := s.EnqueueProviderWebhook(ctx, "livekit", ev.ProviderEventID, ev.Type, payload)
	if err != nil || !queued {
		t.Fatalf("enqueue: queued=%v err=%v", queued, err)
	}
	// The inbox unique key drops the same provider event id on the second POST
	// of a webhook.
	queued, err = s.EnqueueProviderWebhook(ctx, "livekit", ev.ProviderEventID, ev.Type, payload)
	if err != nil || queued {
		t.Fatalf("duplicate enqueue: queued=%v err=%v", queued, err)
	}
	if got := countRows(t, s, "SELECT count(*) FROM webhook_inbox WHERE provider_event_id = $1", ev.ProviderEventID); got != 1 {
		t.Fatalf("inbox rows = %d, want 1", got)
	}

	if err := s.ProcessWebhookInbox(ctx, 10); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil || len(recs) != 1 {
		t.Fatalf("recordings: %+v err=%v", recs, err)
	}
	if recs[0].Status != RecordingComplete || recs[0].FileUrl.String != fileURL || !recs[0].EndedAt.Valid {
		t.Fatalf("completion: %+v", recs[0])
	}
	if got := countRows(t, s, "SELECT count(*) FROM webhook_inbox WHERE status = 'PENDING'"); got != 0 {
		t.Fatalf("pending inbox rows = %d", got)
	}

	// A replay with a different URL must not overwrite the stored file, and the
	// provider event id is recorded exactly once.
	replay := ev
	replay.RecordingURL = "https://bucket.example/meetings/rec-replay.mp4"
	if err := s.HandleProviderEvent(ctx, replay); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recs[0].FileUrl.String != fileURL {
		t.Fatalf("replay overwrote file url: %+v", recs[0])
	}
	if got := countRows(t, s, "SELECT count(*) FROM meeting_provider_events WHERE provider_event_id = $1", ev.ProviderEventID); got != 1 {
		t.Fatalf("provider event rows = %d, want 1", got)
	}
}

func TestMeetingRecordingWebhookOutOfOrderLegacyBehavior(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	// (a) egress_ended arriving before the stop command still completes the row:
	// the webhook is the only writer of the file URL.
	early, err := s.CreateInstant(ctx, ua.ID, w.ID, "Early webhook")
	if err != nil {
		t.Fatal(err)
	}
	earlyRec, err := s.StartRecording(ctx, ua.ID, early.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-early",
		RecordingID: earlyRec.EgressID, RecordingURL: "https://bucket.example/early.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err := s.Recordings(ctx, ua.ID, "", early.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingComplete {
		t.Fatalf("early webhook: %+v err=%v", recs, err)
	}
	// Nothing ACTIVE is left, so the later stop command conflicts instead of
	// stopping an egress that already finished.
	if _, err := s.StopRecording(ctx, ua.ID, early.ID); !codedIs(err, "recording_not_active") {
		t.Fatalf("stop after early completion: %v", err)
	}

	// (b) A late success after a failed egress never resurrects the recording.
	late, err := s.CreateInstant(ctx, ua.ID, w.ID, "Late success")
	if err != nil {
		t.Fatal(err)
	}
	lateRec, err := s.StartRecording(ctx, ua.ID, late.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, late.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-failed",
		RecordingID: lateRec.EgressID, RecordingFailed: true,
	}); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", late.ID)
	if err != nil || len(recs) != 1 || recs[0].Status != RecordingFailed || recs[0].FileUrl.Valid {
		t.Fatalf("failed egress: %+v err=%v", recs, err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-late-success",
		RecordingID: lateRec.EgressID, RecordingURL: "https://bucket.example/late.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, err = s.Recordings(ctx, ua.ID, "", late.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recs[0].Status != RecordingFailed || recs[0].FileUrl.Valid {
		t.Fatalf("late success resurrected the recording: %+v", recs[0])
	}

	// (c) An egress this server never started is ignored without an error and
	// without creating a row.
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-unknown",
		RecordingID: "egress-from-another-instance", RecordingURL: "https://bucket.example/unknown.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	if got := countRows(t, s, "SELECT count(*) FROM meeting_recordings WHERE egress_id = 'egress-from-another-instance'"); got != 0 {
		t.Fatalf("unknown egress rows = %d", got)
	}
}

func TestMeetingRecordingPlaybackAuthorizationLegacyBehavior(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Playback auth")
	if err != nil {
		t.Fatal(err)
	}
	rec := completedRecording(t, s, ua.ID, m.ID, "https://bucket.example/meetings/playback.mp4")

	// The host may play it back.
	if got, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, rec.ID); err != nil || got.ID != rec.ID {
		t.Fatalf("host playback: %+v err=%v", got, err)
	}
	// A user who is not in the workspace is refused, member or not.
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ub.ID, "", m.ID, rec.ID); err != ErrForbidden {
		t.Fatalf("non-member playback: %v", err)
	}
	if _, err := s.Recordings(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("non-member list: %v", err)
	}
	// Legacy gate is workspace membership, not attendance: a member who never
	// joined the room can still watch.
	addMember(t, s, w.ID, ub.ID)
	if got, err := s.GetMeetingRecordingForPlayback(ctx, ub.ID, "", m.ID, rec.ID); err != nil || got.ID != rec.ID {
		t.Fatalf("member playback: %+v err=%v", got, err)
	}

	// Guests need an ACTIVE participant row in this meeting.
	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, "", guestID, m.ID, rec.ID); err != ErrForbidden {
		t.Fatalf("guest without participant row: %v", err)
	}
	participantID := util.NewID()
	if _, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: participantID, MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest",
		Role: RoleAttendee, SourceType: GrantInviteLink, SourceID: strText("link"), AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	if got, err := s.GetMeetingRecordingForPlayback(ctx, "", guestID, m.ID, rec.ID); err != nil || got.ID != rec.ID {
		t.Fatalf("guest playback: %+v err=%v", got, err)
	}

	// Without any principal the read is refused.
	if _, err := s.GetMeetingRecordingForPlayback(ctx, "", "", m.ID, rec.ID); err != ErrForbidden {
		t.Fatalf("missing principal: %v", err)
	}

	// A recording id from another meeting never resolves through this one, and
	// the same guest session in another meeting is refused.
	other, err := s.CreateInstant(ctx, ua.ID, w.ID, "Other meeting")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", other.ID, rec.ID); err != ErrNotFound {
		t.Fatalf("cross-meeting recording id: %v", err)
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, "", guestID, other.ID, rec.ID); err != ErrForbidden {
		t.Fatalf("guest cross-meeting playback: %v", err)
	}

	// An ACTIVE recording is not playable yet.
	active, err := s.StartRecording(ctx, ua.ID, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", other.ID, active.ID); !codedIs(err, "recording_not_ready") {
		t.Fatalf("active recording playback: %v", err)
	}
	// An empty recording id is a validation error, not a 404.
	var ve ValidationError
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, "  "); !errors.As(err, &ve) {
		t.Fatalf("empty recording id: %v", err)
	}
}
