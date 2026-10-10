package service

import (
	"context"
	"strings"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestNormalizeVoiceCallID(t *testing.T) {
	for _, ok := range []string{"550e8400-e29b-41d4-a716-446655440000", "01J8X4ROOM0N1P2Q3R4S5T6U7V8", " call-1 ", strings.Repeat("a", maxVoiceCallIDLen)} {
		if _, err := normalizeVoiceCallID(ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "  ", strings.Repeat("a", maxVoiceCallIDLen+1), "a|b", "a b", "a/b", "cuộc-gọi"} {
		_, err := normalizeVoiceCallID(bad)
		requireValidationError(t, err, bad)
	}
}

// A call_id over 239 bytes used to slice past the LiveKit room name and
// panic; it is now refused before any session lookup.
func TestLiveKitRoomForLongCallIDIsRefused(t *testing.T) {
	room := db.ChatRoom{ID: "room-long-call", LivekitRoomName: "uniwork-chat-room-long-call"}
	callID := strings.Repeat("a", 300)
	voiceCallSessions.Store(voiceCallSessionKey(room.ID, callID), voiceCallSession{invitedAt: time.Now()})
	t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey(room.ID, callID)) })
	_, err := liveKitRoomForActiveVoiceCall(room, callID)
	requireValidationError(t, err, "long call_id")
}

func TestSignalVoiceInviteRefusesALongCallID(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	err = s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, strings.Repeat("a", 1<<20))
	requireValidationError(t, err, "1 MiB call_id")
}

func TestAbandonedVoiceCallSessionsAreReclaimed(t *testing.T) {
	now := time.Now()
	answeredLongAgo := now.Add(-voiceCallAnsweredTTL - time.Minute)
	answeredRecently := now.Add(-time.Minute)
	sessions := map[string]voiceCallSession{
		"stale-invite":    {invitedAt: now.Add(-voiceCallUnansweredTTL - time.Minute)},
		"stale-call":      {invitedAt: answeredLongAgo, acceptedAt: &answeredLongAgo},
		"ringing":         {invitedAt: now.Add(-time.Minute)},
		"long-but-active": {invitedAt: now.Add(-voiceCallUnansweredTTL - time.Minute), acceptedAt: &answeredRecently},
	}
	for callID, sess := range sessions {
		voiceCallSessions.Store(voiceCallSessionKey("room-sweep", callID), sess)
		t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey("room-sweep", callID)) })
	}

	// The lazy check drops an expired session on access.
	if _, ok := loadVoiceCallSession(voiceCallSessionKey("room-sweep", "stale-call")); ok {
		t.Fatal("a call answered past the TTL is still live")
	}

	// A new invite sweeps the rest.
	lastVoiceCallSweep.Store(0)
	(&ChatService{}).trackVoiceCallInvite(db.ChatRoom{ID: "room-sweep", Kind: chatRoomKindDM}, "new", "U1", "A")
	t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey("room-sweep", "new")) })
	for callID, wantLive := range map[string]bool{"stale-invite": false, "stale-call": false, "ringing": true, "long-but-active": true, "new": true} {
		if _, ok := voiceCallSessions.Load(voiceCallSessionKey("room-sweep", callID)); ok != wantLive {
			t.Errorf("%s: present=%v, want %v", callID, ok, wantLive)
		}
	}
}
