package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Call sessions live in this process (chat_voice.go › voiceCallSessions), so a
// deploy or a restart used to forget every call ringing or under way: the
// phones' pending list came back empty, a ring push still queued was dropped as
// "no longer ringing", and the caller's hangup of a group call was refused
// (review "server-ring-state-in-memory"). With Redis, every change of a session
// is also written to a journal there (one key per call, expiring when the
// session would), the next process reads the journal back at start
// (RestoreVoiceCalls), and a session this process does not hold is looked up
// there before it is called gone (read-through). Redis stays optional: without
// it, or while it is unreachable, sessions are in-process as before, and every
// journal call gives up after voiceJournalTimeout instead of holding a call up.
//
// The in-process map is still the one this node acts on, so two replicas each
// mutating the same call can still disagree; the deploy runs one replica
// (deploy/app/uniwork/values.yaml › be.replicaCount), and the journal makes a
// rolling restart safe, not concurrent writers.

// redisVoiceCallPrefix namespaces the journal: uw:voicecall:{roomID}|{callID}.
const redisVoiceCallPrefix = "uw:voicecall:"

// voiceJournalTimeout bounds one journal call, as the rate limiters bound theirs.
const voiceJournalTimeout = 100 * time.Millisecond

// voiceJournalScanBatch is how many keys one SCAN step asks for at restore.
const voiceJournalScanBatch = 200

var voiceJournal atomic.Pointer[redis.Client]

// voiceJournalNow is the journal's clock (a test pins it to read an entry's TTL).
var voiceJournalNow = time.Now

// SetVoiceCallJournal keeps a journal of call sessions in Redis; nil keeps
// them in process only. The journal is process-wide, like the sessions.
func (s *ChatService) SetVoiceCallJournal(rdb *redis.Client) { voiceJournal.Store(rdb) }

// voiceCallRecord is a session as the journal stores it.
type voiceCallRecord struct {
	RoomID         string     `json:"room_id"`
	CallID         string     `json:"call_id"`
	CallerID       string     `json:"caller_id"`
	CallerName     string     `json:"caller_name"`
	CallKind       string     `json:"call_kind"`
	RoomName       string     `json:"room_name"`
	Video          bool       `json:"video"`
	InvitedAt      time.Time  `json:"invited_at"`
	AcceptedAt     *time.Time `json:"accepted_at,omitempty"`
	ParticipantIDs []string   `json:"participant_ids"`
	InviteeIDs     []string   `json:"invitee_ids"`
	DeclinedIDs    []string   `json:"declined_ids,omitempty"`
}

func voiceCallRecordOf(sess voiceCallSession) voiceCallRecord {
	return voiceCallRecord{
		RoomID: sess.roomID, CallID: sess.callID, CallerID: sess.callerID, CallerName: sess.callerName,
		CallKind: sess.callKind, RoomName: sess.roomName, Video: sess.video, InvitedAt: sess.invitedAt,
		AcceptedAt: sess.acceptedAt, ParticipantIDs: sess.participantIDs, InviteeIDs: sess.inviteeIDs,
		DeclinedIDs: sess.declinedIDs,
	}
}

func (r voiceCallRecord) session() voiceCallSession {
	return voiceCallSession{
		roomID: r.RoomID, callID: r.CallID, callerID: r.CallerID, callerName: r.CallerName,
		callKind: r.CallKind, roomName: r.RoomName, video: r.Video, invitedAt: r.InvitedAt,
		acceptedAt: r.AcceptedAt, participantIDs: r.ParticipantIDs, inviteeIDs: r.InviteeIDs,
		declinedIDs: r.DeclinedIDs,
	}
}

// journalTTL is how much longer the session lives (sess.expired); <= 0 once it has expired.
func journalTTL(sess voiceCallSession, now time.Time) time.Duration {
	if sess.acceptedAt != nil {
		return voiceCallAnsweredTTL - now.Sub(*sess.acceptedAt)
	}
	return voiceCallUnansweredTTL - now.Sub(sess.invitedAt)
}

func cacheVoiceCallSessionInProcess(key string, sess voiceCallSession) {
	voiceCallSessions.Store(key, sess)
}

// writeVoiceCallSessionLocal keeps the session in this process and in the journal.
func writeVoiceCallSessionLocal(key string, sess voiceCallSession) {
	cacheVoiceCallSessionInProcess(key, sess)
	rdb := voiceJournal.Load()
	if rdb == nil {
		return
	}
	ttl := journalTTL(sess, voiceJournalNow())
	if ttl <= 0 {
		journalDelete(rdb, key)
		return
	}
	raw, err := json.Marshal(voiceCallRecordOf(sess))
	if err != nil {
		slog.Warn("chat: voice call journal not encoded", "error", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), voiceJournalTimeout)
	defer cancel()
	if err := rdb.Set(ctx, redisVoiceCallPrefix+key, raw, ttl).Err(); err != nil {
		slog.Warn("chat: voice call journal not written", "error", err)
	}
}

// deleteVoiceCallSessionLocal forgets the session here and in the journal.
func deleteVoiceCallSessionLocal(key string) {
	voiceCallSessions.Delete(key)
	if rdb := voiceJournal.Load(); rdb != nil {
		journalDelete(rdb, key)
	}
}

func journalDelete(rdb *redis.Client, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), voiceJournalTimeout)
	defer cancel()
	if err := rdb.Del(ctx, redisVoiceCallPrefix+key).Err(); err != nil {
		slog.Warn("chat: voice call journal entry not removed", "error", err)
	}
}

// journalLoad reads a session this process does not hold from the journal;
// false without a journal, without the key, or when Redis does not answer.
func journalLoad(key string) (voiceCallSession, bool) {
	rdb := voiceJournal.Load()
	if rdb == nil {
		return voiceCallSession{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), voiceJournalTimeout)
	defer cancel()
	raw, err := rdb.Get(ctx, redisVoiceCallPrefix+key).Bytes()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			slog.Warn("chat: voice call journal not read", "error", err)
		}
		return voiceCallSession{}, false
	}
	var rec voiceCallRecord
	if err := json.Unmarshal(raw, &rec); err != nil || rec.CallID == "" {
		return voiceCallSession{}, false
	}
	return rec.session(), true
}

// RestoreVoiceCalls reads back, once at start, the calls a previous process
// left in the journal and still alive, so a restart keeps ringing phones'
// pending list and lets the caller end the call. A session this process
// already holds wins. Returns how many it took back.
func (s *ChatService) RestoreVoiceCalls(ctx context.Context) (int, error) {
	rdb := voiceJournal.Load()
	if rdb == nil {
		return 0, nil
	}
	now := voiceJournalNow()
	restored := 0
	var cursor uint64
	for {
		keys, next, err := rdb.Scan(ctx, cursor, redisVoiceCallPrefix+"*", voiceJournalScanBatch).Result()
		if err != nil {
			return restored, err
		}
		for _, full := range keys {
			raw, err := rdb.Get(ctx, full).Bytes()
			if errors.Is(err, redis.Nil) {
				continue // expired between the scan and the read
			}
			if err != nil {
				return restored, err
			}
			var rec voiceCallRecord
			if json.Unmarshal(raw, &rec) != nil || rec.CallID == "" {
				continue
			}
			sess := rec.session()
			if sess.expired(now) {
				continue
			}
			key := strings.TrimPrefix(full, redisVoiceCallPrefix)
			voiceCallSessionsMu.Lock()
			if _, held := voiceCallSessions.Load(key); !held {
				voiceCallSessions.Store(key, sess)
				restored++
			}
			voiceCallSessionsMu.Unlock()
		}
		cursor = next
		if cursor == 0 {
			return restored, nil
		}
	}
}
