package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// publishFixture is a meeting in progress with ua hosting and ub admitted.
func publishFixture(t *testing.T) (s *MeetingService, hostID, meetingID, participantID string) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Mute")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("join: %+v %v", dec, err)
	}
	return s, ua.ID, m.ID, dec.Participant.ID
}

func TestSetParticipantPublish(t *testing.T) {
	s, hostID, meetingID, pid := publishFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)

	if err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, "", false); err != nil {
		t.Fatal(err)
	}
	// LiveKit replaces the whole permission set: locking the mic must keep the
	// participant listening, on the data channel, and on camera.
	revoked := meetings.MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true, MicrophoneLocked: true}
	if fp.UpdateCalls != 1 || fp.LastUpdate.Permissions != revoked {
		t.Fatalf("expected revoke publish, got %+v", fp.LastUpdate)
	}

	if err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, MediaSourceMicrophone, true); err != nil {
		t.Fatal(err)
	}
	granted := meetings.MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	if fp.UpdateCalls != 2 || fp.LastUpdate.Permissions != granted {
		t.Fatalf("expected grant publish, got %+v", fp.LastUpdate)
	}

	hostDec, err := s.Join(ctx, AdmissionContext{MeetingID: meetingID, UserID: hostID})
	if err != nil || hostDec.Decision != DecisionAdmit {
		t.Fatalf("host join: %+v %v", hostDec, err)
	}
	hostErr := s.SetParticipantPublish(ctx, hostID, meetingID, hostDec.Participant.ID, "", false)
	if hostErr == nil {
		t.Fatal("expected cannot mute host")
	}
	var ce CodedError
	if !errors.As(hostErr, &ce) || ce.Code != "cannot_mute_host" {
		t.Fatalf("expected cannot_mute_host, got %v", hostErr)
	}
}

// Locks are kept only on the provider, so locking the share reads the mic lock
// back and keeps it, and unlocking one source leaves the other locked.
func TestSetParticipantPublishScreenSharePreservesMicLock(t *testing.T) {
	s, hostID, meetingID, pid := publishFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	base := meetings.MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true}
	steps := []struct {
		source  string
		enabled bool
		mic     bool
		share   bool
	}{
		{MediaSourceScreenShare, false, false, true},
		{MediaSourceMicrophone, false, true, true},
		{MediaSourceScreenShare, true, true, false},
		{MediaSourceScreenShare, false, true, true},
		{MediaSourceMicrophone, true, false, true},
		{MediaSourceScreenShare, true, false, false},
	}
	for i, st := range steps {
		if err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, st.source, st.enabled); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		want := base
		want.MicrophoneLocked, want.ScreenShareLocked = st.mic, st.share
		if fp.LastUpdate.Permissions != want {
			t.Fatalf("step %d (%s enabled=%v): permissions %+v, want %+v", i, st.source, st.enabled, fp.LastUpdate.Permissions, want)
		}
	}
	if fp.GetPermissionsCalls != len(steps) {
		t.Fatalf("read the current locks %d times, want %d", fp.GetPermissionsCalls, len(steps))
	}

	acts, err := s.Activity(ctx, hostID, meetingID, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, a := range acts {
		if a.ToState.String == pid {
			counts[a.EventType]++
		}
	}
	if counts["PARTICIPANT_SCREEN_SHARE_REVOKED"] != 2 || counts["PARTICIPANT_SCREEN_SHARE_GRANTED"] != 2 ||
		counts["PARTICIPANT_PUBLISH_REVOKED"] != 1 || counts["PARTICIPANT_PUBLISH_GRANTED"] != 1 {
		t.Fatalf("audit rows = %v", counts)
	}
}

func TestSetParticipantPublishScreenShareRefusals(t *testing.T) {
	s, hostID, meetingID, pid := publishFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)

	var ve ValidationError
	if err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, "camera", false); !errors.As(err, &ve) {
		t.Fatalf("unknown source: %v", err)
	}

	hostDec, err := s.Join(ctx, AdmissionContext{MeetingID: meetingID, UserID: hostID})
	if err != nil || hostDec.Decision != DecisionAdmit {
		t.Fatalf("host join: %+v %v", hostDec, err)
	}
	if err := s.SetParticipantPublish(ctx, hostID, meetingID, hostDec.Participant.ID, MediaSourceScreenShare, false); !codedIs(err, "cannot_lock_host_share") {
		t.Fatalf("expected cannot_lock_host_share, got %v", err)
	}
	// Only the host and workspace admins lock someone's share.
	member, err := s.q.GetMeetingParticipant(ctx, pid)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetParticipantPublish(ctx, member.UserID.String, meetingID, pid, MediaSourceScreenShare, false); !codedIs(err, "not_meeting_host") {
		t.Fatalf("expected not_meeting_host, got %v", err)
	}

	// The current locks cannot be read: nothing is written, or the write
	// would drop the other source's lock.
	before := fp.UpdateCalls
	fp.GetPermissionsErr = errors.New("livekit down")
	if err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, MediaSourceMicrophone, false); !codedIs(err, "provider_unavailable") {
		t.Fatalf("expected provider_unavailable, got %v", err)
	}
	if fp.UpdateCalls != before {
		t.Fatalf("permissions written without the current locks")
	}
}

// Each change reads the provider's locks and writes the whole set back, so
// two moderators at once must take turns: the host locking the mic and an
// admin locking the share at the same moment leave both locks on.
func TestSetParticipantPublishConcurrentLocksBothStick(t *testing.T) {
	s, hostID, meetingID, pid := publishFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	// Without the turn-taking both reads land inside this window, before
	// either write.
	fp.GetPermissionsDelay = 150 * time.Millisecond

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, source := range []string{MediaSourceMicrophone, MediaSourceScreenShare} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = s.SetParticipantPublish(ctx, hostID, meetingID, pid, source, false)
		}()
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil {
		t.Fatalf("errs = %v", errs)
	}
	got := fp.Permissions[fp.LastUpdate.RoomName+"/"+fp.LastUpdate.Identity]
	if !got.MicrophoneLocked || !got.ScreenShareLocked {
		t.Fatalf("a concurrent change lifted a lock: %+v", got)
	}
}

// The advisory lock pins a pool connection while LiveKit is asked, so a slow
// or down LiveKit gets one short budget for the read and the write together,
// not a full RPC deadline each: a moderator clicking during an outage cannot
// drain the pool other meeting endpoints share.
func TestSetParticipantPublishBoundsProviderWhileLocked(t *testing.T) {
	s, hostID, meetingID, pid := publishFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	prev := participantMediaLockBudget
	participantMediaLockBudget = 50 * time.Millisecond
	t.Cleanup(func() { participantMediaLockBudget = prev })
	fp.GetPermissionsDelay = 5 * time.Second

	before := fp.UpdateCalls
	start := time.Now()
	err := s.SetParticipantPublish(ctx, hostID, meetingID, pid, MediaSourceScreenShare, false)
	if !codedIs(err, "provider_unavailable") {
		t.Fatalf("expected provider_unavailable, got %v", err)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Fatalf("held the lock for %v waiting on the provider", took)
	}
	if fp.UpdateCalls != before {
		t.Fatalf("permissions written after the budget ran out")
	}
}
