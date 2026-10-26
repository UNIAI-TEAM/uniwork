package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestVoiceCallLogMetadataKeepsVideo(t *testing.T) {
	video := voiceCallLogFromMetadata("voice_call_log", []byte(`{"outcome":"completed","caller_id":"a","video":true}`))
	if video == nil || !video.Video {
		t.Fatalf("video log: %+v", video)
	}
	voice := voiceCallLogFromMetadata("voice_call_log", []byte(`{"outcome":"completed","caller_id":"a"}`))
	if voice == nil || voice.Video {
		t.Fatalf("voice log: %+v", voice)
	}
}

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
	_, err := (&ChatService{}).liveKitRoomForActiveVoiceCall(context.Background(), room, callID)
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
	err = s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, strings.Repeat("a", 1<<20), false)
	requireValidationError(t, err, "1 MiB call_id")
}

func TestAbandonedVoiceCallSessionsAreReclaimed(t *testing.T) {
	s, _, _, _, _, w := chatFixture(t)
	ctx := context.Background()
	// trackVoiceCallInvite persists a row in chat_voice_call_sessions that the
	// in-memory cleanup below cannot reach; a fixed room id made every rerun on the
	// same database collide with the previous run's "new" call (ErrConflict).
	roomID := "room-sweep-" + util.NewID()
	now := time.Now()
	answeredLongAgo := now.Add(-voiceCallAnsweredTTL - time.Minute)
	answeredRecently := now.Add(-time.Minute)
	sessions := map[string]voiceCallSession{
		"stale-invite":    {roomID: roomID, callID: "stale-invite", invitedAt: now.Add(-voiceCallUnansweredTTL - time.Minute)},
		"stale-call":      {roomID: roomID, callID: "stale-call", invitedAt: answeredLongAgo, acceptedAt: &answeredLongAgo},
		"ringing":         {roomID: roomID, callID: "ringing", invitedAt: now.Add(-time.Minute)},
		"long-but-active": {roomID: roomID, callID: "long-but-active", invitedAt: now.Add(-voiceCallUnansweredTTL - time.Minute), acceptedAt: &answeredRecently},
	}
	for callID, sess := range sessions {
		voiceCallSessions.Store(voiceCallSessionKey(roomID, callID), sess)
		t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey(roomID, callID)) })
	}

	// The lazy check drops an expired session on access.
	if _, ok := s.loadVoiceCallSession(ctx, roomID, "stale-call"); ok {
		t.Fatal("a call answered past the TTL is still live")
	}

	// A new invite sweeps the rest.
	lastVoiceCallSweep.Store(0)
	if err := s.trackVoiceCallInvite(ctx, db.ChatRoom{ID: roomID, OrganizationID: w.OrganizationID, Kind: chatRoomKindDM}, "new", "U1", "A", false, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.deleteVoiceCallSession(context.Background(), roomID, "new") })
	for callID, wantLive := range map[string]bool{"stale-invite": false, "stale-call": false, "ringing": true, "long-but-active": true, "new": true} {
		if _, ok := voiceCallSessions.Load(voiceCallSessionKey(roomID, callID)); ok != wantLive {
			t.Errorf("%s: present=%v, want %v", callID, ok, wantLive)
		}
	}
}

// A caller whose socket missed chat.voice.accept reads its own live calls
// (review of UNI-2053 S3, audit C1): only its own, unexpired, oldest first,
// with whether the callee answered.
func TestOutgoingVoiceCallSessionsListTheCallersLiveCalls(t *testing.T) {
	now := time.Now()
	answered := now.Add(-time.Minute)
	sessions := map[string]voiceCallSession{
		"mine-ringing":  {roomID: "room-out", callID: "mine-ringing", callerID: "U-out", invitedAt: now.Add(-time.Second)},
		"mine-answered": {roomID: "room-out", callID: "mine-answered", callerID: "U-out", invitedAt: now.Add(-2 * time.Minute), acceptedAt: &answered},
		"mine-expired":  {roomID: "room-out", callID: "mine-expired", callerID: "U-out", invitedAt: now.Add(-voiceCallUnansweredTTL - time.Minute)},
		"theirs":        {roomID: "room-out", callID: "theirs", callerID: "U-other", invitedAt: now},
	}
	for callID, sess := range sessions {
		voiceCallSessions.Store(voiceCallSessionKey("room-out", callID), sess)
		t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey("room-out", callID)) })
	}
	got := outgoingVoiceCallSessions("U-out", now)
	if len(got) != 2 || got[0].callID != "mine-answered" || got[0].acceptedAt == nil || got[1].callID != "mine-ringing" || got[1].acceptedAt != nil {
		t.Fatalf("outgoing sessions: %+v", got)
	}
	if none := outgoingVoiceCallSessions("U-nobody", now); len(none) != 0 {
		t.Fatalf("someone else's calls listed: %+v", none)
	}
}

func TestVoiceCallSurvivesAServerRestart(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	const callID = "restart-survives"
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, callID, false); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	var accepted pgtype.Timestamptz
	if err := pool.QueryRow(ctx,
		`SELECT accepted_at FROM chat_voice_call_sessions WHERE room_id = $1 AND call_id = $2`, dm.ID, callID,
	).Scan(&accepted); err != nil || !accepted.Valid {
		t.Fatalf("accepted_at in db: err=%v valid=%v", err, accepted.Valid)
	}
	voiceCallSessions.Range(func(k, _ any) bool {
		voiceCallSessions.Delete(k)
		return true
	})
	s2 := NewChatService(pool, q, s.ws, &capturePublisher{})
	if _, err := s2.MintVoiceTokenRoom(ctx, ub.ID, dm.ID, callID); err != nil {
		t.Fatalf("token after restart: %v", err)
	}
	backdateVoiceCallAnswer(t, s2, dm.ID, callID, 42*time.Second)
	if err := s2.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("hangup: %v", err)
	}
	msgs, err := s2.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range msgs {
		if msg.Kind == "voice_call_log" && msg.VoiceCall != nil && msg.VoiceCall.CallID == callID && msg.VoiceCall.Outcome == voiceCallOutcomeCompleted {
			return
		}
	}
	t.Fatal("expected completed voice_call_log after restart hangup")
}
