package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestSignalVoiceAndTyping(t *testing.T) {
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	deliverChatEvents(t, pool, q, s, pub)

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing: %v", err)
	}
	if countEvents(pub.events, "chat.room.created") != 2 || pub.events[len(pub.events)-1].Type != "chat.typing" {
		t.Fatalf("typing publish: %+v", pub.events)
	}

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-1", false); err != nil {
		t.Fatalf("voice invite: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.invite" {
		t.Fatalf("voice invite publish: %+v", pub.events)
	}

	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("voice accept: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.accept" {
		t.Fatalf("voice accept publish: %+v", pub.events)
	}

	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("voice hangup: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.hangup" {
		t.Fatalf("voice hangup publish: %+v", pub.events)
	}
}

// The actor's other tabs ring too, so an answer or a decline in one tab must
// reach the rest of them, not only the peer and the open room.
func TestVoiceSignalReachesTheActorsOtherTabs(t *testing.T) {
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	deliverChatEvents(t, pool, q, s, pub)

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-tabs", false); err != nil {
		t.Fatalf("voice invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-tabs"); err != nil {
		t.Fatalf("voice accept: %v", err)
	}
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "call-tabs"); err != nil {
		t.Fatalf("voice hangup: %v", err)
	}

	for _, typ := range []string{"chat.voice.accept", "chat.voice.hangup"} {
		got := pub.sentTo(typ)
		for _, want := range []string{"user:" + ua.ID, "user:" + ub.ID} {
			if !slices.Contains(got, want) {
				t.Errorf("%s went to %v, want %s among them", typ, got, want)
			}
		}
	}
}

func TestSignalTypingThrottled(t *testing.T) {
	s, pub, q, ua, ub, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	chatTypingLastPublished.Range(func(k, _ any) bool {
		chatTypingLastPublished.Delete(k)
		return true
	})
	pub.events = nil

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing: %v", err)
	}
	if len(pub.events) != 1 || pub.events[0].Type != "chat.typing" {
		t.Fatalf("first typing publish: %+v", pub.events)
	}

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing again: %v", err)
	}
	if len(pub.events) != 1 {
		t.Fatalf("second typing within gap should not publish: %+v", pub.events)
	}

	time.Sleep(chatTypingMinGap + 50*time.Millisecond)
	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing after gap: %v", err)
	}
	if len(pub.events) != 2 || pub.events[1].Type != "chat.typing" {
		t.Fatalf("typing after gap publish: %+v", pub.events)
	}
}

func TestListPendingVoiceInviteWhileOffline(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "offline-call-1", false); err != nil {
		t.Fatalf("invite: %v", err)
	}

	pending, err := s.ListPendingVoiceInvites(ctx, ub.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].CallID != "offline-call-1" || pending[0].CallerID != ua.ID {
		t.Fatalf("pending for callee: %+v", pending)
	}
	callerPending, err := s.ListPendingVoiceInvites(ctx, ua.ID, w.ID)
	if err != nil || len(callerPending) != 0 {
		t.Fatalf("caller should not see own invite: err=%v pending=%+v", err, callerPending)
	}

	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "offline-call-1"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	pending, err = s.ListPendingVoiceInvites(ctx, ub.ID, w.ID)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending after accept: err=%v len=%d", err, len(pending))
	}
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, "offline-call-1"); err != nil {
		t.Fatalf("hangup: %v", err)
	}

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "offline-call-2", false); err != nil {
		t.Fatalf("invite 2: %v", err)
	}
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, "offline-call-2"); err != nil {
		t.Fatalf("hangup 2: %v", err)
	}
	pending, err = s.ListPendingVoiceInvites(ctx, ub.ID, w.ID)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending after caller hangup: err=%v len=%d", err, len(pending))
	}
}

// A call_id travels to every room member in chat.voice.invite, so a second
// invite with it must not take the call over from its caller.
func TestSignalVoiceInviteRefusesATakenCallID(t *testing.T) {
	s, _, q, ua, ub, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc, err := q.CreateUser(ctx, db.CreateUserParams{ID: util.NewID(), Email: "taken-call-c@example.com", DisplayName: "C", Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Call", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, group.ID, "call-x", false); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, uc.ID, w.ID, group.ID, "call-x"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ub.ID, w.ID, group.ID, "call-x", false); !errors.Is(err, ErrConflict) {
		t.Fatalf("re-invite with a live call_id: got %v, want ErrConflict", err)
	}
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, group.ID, "call-x"); err != nil {
		t.Fatalf("the caller's hangup: %v", err)
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, group.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	logs := 0
	for _, msg := range msgs {
		if msg.Kind != "voice_call_log" || msg.VoiceCall == nil {
			continue
		}
		logs++
		if msg.VoiceCall.CallerID != ua.ID || msg.VoiceCall.Outcome != voiceCallOutcomeCompleted {
			t.Fatalf("call log: %+v", msg.VoiceCall)
		}
	}
	if logs != 1 {
		t.Fatalf("call logs = %d, want 1", logs)
	}
}

// Both sides of a DM hanging up at once end the call once: the session read
// by the slower hangup must not be written back after the faster one took it.
func TestConcurrentVoiceHangupsWriteOneCallLog(t *testing.T) {
	base, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s := NewChatService(pool, q, base.ws, NopPublisher{})
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	const calls = 50
	for i := range calls {
		callID := fmt.Sprintf("race-%d", i)
		if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, callID, false); err != nil {
			t.Fatalf("invite %s: %v", callID, err)
		}
		if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, callID); err != nil {
			t.Fatalf("accept %s: %v", callID, err)
		}
		var wg sync.WaitGroup
		for _, u := range []string{ua.ID, ub.ID} {
			wg.Go(func() {
				if err := s.SignalVoiceHangup(ctx, u, w.ID, dm.ID, callID); err != nil {
					t.Errorf("hangup %s by %s: %v", callID, u, err)
				}
			})
		}
		wg.Wait()
	}

	rows, err := pool.Query(ctx, `SELECT metadata->>'call_id', count(*) FROM chat_messages
		WHERE room_id = $1 AND kind = 'voice_call_log' GROUP BY 1`, dm.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var callID string
		var n int
		if err := rows.Scan(&callID, &n); err != nil {
			t.Fatal(err)
		}
		seen++
		if n != 1 {
			t.Errorf("%s: %d call logs, want 1", callID, n)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if seen != calls {
		t.Fatalf("calls with a log = %d, want %d", seen, calls)
	}
}
