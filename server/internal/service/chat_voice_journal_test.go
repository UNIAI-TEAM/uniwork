package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/go-redis/redismock/v9"
)

// The call-session journal (chat_voice_journal.go) on a stand-in Redis: every change of a session is written with
// the time the session has left, a session this process lost (a restart) is read back from it, the end of a call
// removes it, and a process starting up takes back the live calls only. Redis failing leaves the call in process.
func useVoiceJournal(t *testing.T, now time.Time) redismock.ClientMock {
	t.Helper()
	db, mock := redismock.NewClientMock()
	voiceJournal.Store(db)
	voiceJournalNow = func() time.Time { return now }
	t.Cleanup(func() {
		voiceJournal.Store(nil)
		voiceJournalNow = time.Now
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
	})
	return mock
}

func journalRaw(t *testing.T, sess voiceCallSession) []byte {
	t.Helper()
	raw, err := json.Marshal(voiceCallRecordOf(sess))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestVoiceCallJournalWritesEachChangeAndReadsBackWhatThisProcessLost(t *testing.T) {
	now := time.Now()
	mock := useVoiceJournal(t, now)
	key := voiceCallSessionKey("room-journal", "call-journal")
	t.Cleanup(func() { voiceCallSessions.Delete(key) })
	sess := voiceCallSession{
		roomID: "room-journal", callID: "call-journal", callerID: "u-a", callerName: "An", callKind: "group",
		invitedAt: now.Add(-10 * time.Second), participantIDs: []string{"u-a"}, inviteeIDs: []string{"u-b"}, declinedIDs: []string{"u-c"},
	}
	raw := journalRaw(t, sess)
	mock.ExpectSet(redisVoiceCallPrefix+key, raw, voiceCallUnansweredTTL-10*time.Second).SetVal("OK")
	storeVoiceCallSession(key, sess)

	// A restart: the process forgot the call, the journal did not.
	voiceCallSessions.Delete(key)
	mock.ExpectGet(redisVoiceCallPrefix + key).SetVal(string(raw))
	got, ok := loadVoiceCallSession(key)
	if !ok || got.callerID != "u-a" || got.callKind != "group" || len(got.inviteeIDs) != 1 || got.declinedIDs[0] != "u-c" {
		t.Fatalf("read back %+v (%v), want the journaled session", got, ok)
	}
	if _, held := voiceCallSessions.Load(key); !held {
		t.Fatal("a session read back from the journal is held in process from then on")
	}

	mock.ExpectDel(redisVoiceCallPrefix + key).SetVal(1)
	deleteVoiceCallSession(key)

	mock.ExpectGet(redisVoiceCallPrefix + voiceCallSessionKey("room-journal", "gone")).RedisNil()
	if _, ok := loadVoiceCallSession(voiceCallSessionKey("room-journal", "gone")); ok {
		t.Fatal("a call neither here nor in the journal is gone")
	}
}

func TestVoiceCallJournalKeepsTheCallWhenRedisFailsAndDropsAnExpiredOne(t *testing.T) {
	now := time.Now()
	mock := useVoiceJournal(t, now)
	key := voiceCallSessionKey("room-journal-2", "call")
	t.Cleanup(func() { voiceCallSessions.Delete(key) })
	answered := now.Add(-time.Hour)
	sess := voiceCallSession{roomID: "room-journal-2", callID: "call", callerID: "u-a", invitedAt: now.Add(-2 * time.Hour), acceptedAt: &answered}
	mock.ExpectSet(redisVoiceCallPrefix+key, journalRaw(t, sess), voiceCallAnsweredTTL-time.Hour).SetErr(errors.New("redis down"))
	storeVoiceCallSession(key, sess)
	if _, held := voiceCallSessions.Load(key); !held {
		t.Fatal("Redis failing must not lose the call in process")
	}

	stale := voiceCallSession{roomID: "room-journal-2", callID: "call", invitedAt: now.Add(-2 * voiceCallUnansweredTTL)}
	mock.ExpectDel(redisVoiceCallPrefix + key).SetVal(0)
	storeVoiceCallSession(key, stale)

	// A journal entry that does not read is no session.
	mock.ExpectGet(redisVoiceCallPrefix + "bad").SetVal("{")
	if _, ok := journalLoad("bad"); ok {
		t.Fatal("an unreadable journal entry is no session")
	}
	mock.ExpectGet(redisVoiceCallPrefix + "down").SetErr(errors.New("timeout"))
	if _, ok := journalLoad("down"); ok {
		t.Fatal("Redis not answering is no session")
	}
}

func TestRestoreVoiceCallsTakesBackTheLiveCallsOnly(t *testing.T) {
	s := &ChatService{}
	if n, err := s.RestoreVoiceCalls(context.Background()); n != 0 || err != nil {
		t.Fatalf("without a journal: %d, %v", n, err)
	}
	now := time.Now()
	mock := useVoiceJournal(t, now)
	live := voiceCallSession{roomID: "room-restore", callID: "live", callerID: "u-a", invitedAt: now.Add(-30 * time.Second)}
	held := voiceCallSession{roomID: "room-restore", callID: "held", callerID: "u-new", invitedAt: now}
	old := voiceCallSession{roomID: "room-restore", callID: "old", callerID: "u-a", invitedAt: now.Add(-2 * voiceCallUnansweredTTL)}
	keys := []string{
		redisVoiceCallPrefix + voiceCallSessionKey("room-restore", "live"),
		redisVoiceCallPrefix + voiceCallSessionKey("room-restore", "held"),
		redisVoiceCallPrefix + voiceCallSessionKey("room-restore", "old"),
		redisVoiceCallPrefix + voiceCallSessionKey("room-restore", "expired-meanwhile"),
		redisVoiceCallPrefix + voiceCallSessionKey("room-restore", "garbage"),
	}
	for _, k := range []string{"live", "held", "old"} {
		t.Cleanup(func() { voiceCallSessions.Delete(voiceCallSessionKey("room-restore", k)) })
	}
	// This process already holds a newer session under one key: it wins.
	voiceCallSessions.Store(voiceCallSessionKey("room-restore", "held"), held)
	mock.ExpectScan(0, redisVoiceCallPrefix+"*", voiceJournalScanBatch).SetVal(keys[:3], 7)
	mock.ExpectGet(keys[0]).SetVal(string(journalRaw(t, live)))
	mock.ExpectGet(keys[1]).SetVal(string(journalRaw(t, voiceCallSession{roomID: "room-restore", callID: "held", callerID: "u-old", invitedAt: now})))
	mock.ExpectGet(keys[2]).SetVal(string(journalRaw(t, old)))
	mock.ExpectScan(7, redisVoiceCallPrefix+"*", voiceJournalScanBatch).SetVal(keys[3:], 0)
	mock.ExpectGet(keys[3]).RedisNil()
	mock.ExpectGet(keys[4]).SetVal("not json")

	n, err := s.RestoreVoiceCalls(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("restored %d (%v), want the one live call", n, err)
	}
	if got, ok := voiceCallSessions.Load(voiceCallSessionKey("room-restore", "live")); !ok || got.(voiceCallSession).callerID != "u-a" {
		t.Fatal("the live call is held again")
	}
	if got, _ := voiceCallSessions.Load(voiceCallSessionKey("room-restore", "held")); got.(voiceCallSession).callerID != "u-new" {
		t.Fatal("a session this process holds is not overwritten by the journal")
	}
	if _, ok := voiceCallSessions.Load(voiceCallSessionKey("room-restore", "old")); ok {
		t.Fatal("an expired call is not taken back")
	}

	mock.ExpectScan(0, redisVoiceCallPrefix+"*", voiceJournalScanBatch).SetErr(errors.New("down"))
	if _, err := s.RestoreVoiceCalls(context.Background()); err == nil {
		t.Fatal("a scan that fails is reported")
	}
	mock.ExpectScan(0, redisVoiceCallPrefix+"*", voiceJournalScanBatch).SetVal(keys[:1], 0)
	mock.ExpectGet(keys[0]).SetErr(errors.New("down"))
	if _, err := s.RestoreVoiceCalls(context.Background()); err == nil {
		t.Fatal("a read that fails is reported")
	}
}
