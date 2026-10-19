package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// backdateVoiceCallAnswer moves a live call's answer time back by d, so the
// server-measured duration covers d without the test sleeping.
func backdateVoiceCallAnswer(t *testing.T, roomID, callID string, d time.Duration) {
	t.Helper()
	key := voiceCallSessionKey(roomID, callID)
	raw, ok := voiceCallSessions.Load(key)
	if !ok {
		t.Fatalf("no live call %s", key)
	}
	sess := raw.(voiceCallSession)
	if sess.acceptedAt == nil {
		t.Fatalf("call %s was never answered", key)
	}
	at := sess.acceptedAt.Add(-d)
	sess.acceptedAt = &at
	voiceCallSessions.Store(key, sess)
}

// queuedVoiceSummaries counts the summary jobs queued for a room.
func queuedVoiceSummaries(t *testing.T, pool *pgxpool.Pool, roomID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM outbox_events WHERE topic = 'chat.voice.call.completed' AND payload::jsonb->>'room_id' = $1`, roomID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// talk runs one answered call of length d from caller to callee.
func talk(t *testing.T, s *ChatService, caller, callee db.User, w db.Workspace, roomID, callID string, d time.Duration) {
	t.Helper()
	acceptDMVoiceCall(t, s, caller, callee, w, roomID, callID)
	backdateVoiceCallAnswer(t, roomID, callID, d)
	if err := s.SignalVoiceHangup(context.Background(), caller.ID, w.ID, roomID, callID); err != nil {
		t.Fatalf("hangup: %v", err)
	}
}

func aiChatFixture(t *testing.T) (*ChatService, *db.Queries, db.User, db.User, db.Workspace, *pgxpool.Pool) {
	t.Helper()
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	s.SetAIGateway(ai.NewGateway(q, &provider.Fake{Reply: ai.FakeReply}, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))
	return s, q, ua, ub, w, pool
}

// A group call nobody else joins is not answered: the caller accepting their
// own call neither starts the clock nor queues an LLM summary (H17).
func TestGroupVoiceCallNeedsASecondParticipant(t *testing.T) {
	s, q, ua, ub, w, pool := aiChatFixture(t)
	ctx := context.Background()
	uc := registerReminderPeer(t, pool, q, "voice-solo-c@example.com", "C", w.OrganizationID, w.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Solo", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, group.ID, "solo-1", false); err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceAccept(ctx, ua.ID, w.ID, group.ID, "solo-1"); err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, group.ID, "solo-1"); err != nil {
		t.Fatal(err)
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, group.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range msgs {
		if msg.VoiceCall != nil && (msg.VoiceCall.Outcome != voiceCallOutcomeUnanswered || msg.VoiceCall.DurationSeconds != 0) {
			t.Fatalf("solo group call logged as %+v, want unanswered", msg.VoiceCall)
		}
	}
	if n := queuedVoiceSummaries(t, pool, group.ID); n != 0 {
		t.Fatalf("summaries queued for a solo call = %d, want 0", n)
	}
}

// Summaries are capped per caller and per room each hour, so one member
// cannot drain the organization's AI quota with fake calls (H17).
func TestVoiceCallSummaryCaps(t *testing.T) {
	s, _, ua, ub, w, pool := aiChatFixture(t)
	dm, err := s.ResolveDM(context.Background(), ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := range voiceSummaryCallerCapPerHour + 1 {
		talk(t, s, ua, ub, w, dm.ID, "cap-a-"+string(rune('a'+i)), 45*time.Second)
	}
	if n := queuedVoiceSummaries(t, pool, dm.ID); n != voiceSummaryCallerCapPerHour {
		t.Fatalf("caller cap: queued %d, want %d", n, voiceSummaryCallerCapPerHour)
	}
	for i := range voiceSummaryRoomCapPerHour {
		talk(t, s, ub, ua, w, dm.ID, "cap-b-"+string(rune('a'+i)), 45*time.Second)
	}
	// ub stays under the caller cap, so the room cap is what stops the rest.
	if n := queuedVoiceSummaries(t, pool, dm.ID); n != voiceSummaryRoomCapPerHour {
		t.Fatalf("room cap: queued %d, want %d", n, voiceSummaryRoomCapPerHour)
	}
}

func TestVoiceCallSummaryPostsMessage(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	// chat_call_summary@1 answers highlights as plain strings; they are stored
	// as strings even though catch-up highlights now carry a source.
	fake := &provider.Fake{Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		resp := ai.FakeReply(req)
		resp.Text = strings.Replace(resp.Text, `"highlights":[]`, `"highlights":["Chốt demo thứ Sáu"]`, 1)
		return resp
	}}
	s.SetAIGateway(ai.NewGateway(q, fake, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "summary-call-1", false); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "summary-call-1"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	backdateVoiceCallAnswer(t, dm.ID, "summary-call-1", 45*time.Second)
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "summary-call-1"); err != nil {
		t.Fatalf("hangup: %v", err)
	}

	consumer := NewChatVoiceSummaryConsumer(s)
	d := outbox.New(pool, q, outbox.Options{})
	d.Register(consumer)
	if err := d.Process(ctx, 50); err != nil {
		t.Fatalf("process outbox: %v", err)
	}

	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}

	var logID string
	var summary *VoiceCallSummaryInfo
	for _, msg := range msgs {
		if msg.Kind == "voice_call_log" {
			logID = msg.ID
			continue
		}
		if msg.VoiceCallSummary != nil {
			summary = msg.VoiceCallSummary
		}
	}
	if logID == "" {
		t.Fatal("call log missing")
	}
	if summary == nil {
		t.Fatal("summary message missing")
	}
	if summary.CallLogMessageID != logID {
		t.Fatalf("call log link: got %s want %s", summary.CallLogMessageID, logID)
	}
	if strings.TrimSpace(summary.Summary) == "" {
		t.Fatalf("summary text empty: %+v", summary)
	}
	if len(summary.ActionItems) == 0 {
		t.Fatalf("expected action items: %+v", summary)
	}
	if len(summary.Highlights) != 1 || summary.Highlights[0] != "Chốt demo thứ Sáu" {
		t.Fatalf("highlights: %q", summary.Highlights)
	}

	logMsg, err := q.GetChatMessageByID(ctx, logID)
	if err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(logMsg.Metadata, &meta); err != nil {
		t.Fatal(err)
	}
	if meta["summary_message_id"] == nil || meta["summary_message_id"] == "" {
		t.Fatalf("call log not patched: %+v", meta)
	}
}

func TestEditingASummaryKeepsTheSummary(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	fake := &provider.Fake{Reply: ai.FakeReply}
	s.SetAIGateway(ai.NewGateway(q, fake, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "edit-summary-call", false); err != nil {
		t.Fatal(err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "edit-summary-call"); err != nil {
		t.Fatal(err)
	}
	backdateVoiceCallAnswer(t, dm.ID, "edit-summary-call", 45*time.Second)
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "edit-summary-call"); err != nil {
		t.Fatal(err)
	}
	d := outbox.New(pool, q, outbox.Options{})
	d.Register(NewChatVoiceSummaryConsumer(s))
	if err := d.Process(ctx, 50); err != nil {
		t.Fatal(err)
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	var summaryID, senderID string
	for _, msg := range msgs {
		if msg.VoiceCallSummary != nil {
			summaryID = msg.ID
			senderID = msg.SenderID
		}
	}
	if summaryID == "" {
		t.Fatal("summary message missing")
	}
	edited, err := s.EditChatMessage(ctx, senderID, w.ID, dm.ID, summaryID, "Tóm tắt (đã sửa chính tả)")
	if err != nil {
		t.Fatal(err)
	}
	if edited.VoiceCallSummary == nil || strings.TrimSpace(edited.VoiceCallSummary.Summary) == "" {
		t.Fatalf("summary card lost: %+v", edited.VoiceCallSummary)
	}
	if len(edited.VoiceCallSummary.ActionItems) == 0 {
		t.Fatalf("action items lost: %+v", edited.VoiceCallSummary)
	}
}

func TestVoiceCallSummarySkipsWhenAIDisabled(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "summary-call-2", false); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "summary-call-2"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	backdateVoiceCallAnswer(t, dm.ID, "summary-call-2", 45*time.Second)
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "summary-call-2"); err != nil {
		t.Fatalf("hangup: %v", err)
	}

	d := outbox.New(pool, q, outbox.Options{})
	d.Register(NewChatVoiceSummaryConsumer(s))
	if err := d.Process(ctx, 50); err != nil {
		t.Fatalf("process outbox: %v", err)
	}

	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range msgs {
		if msg.VoiceCallSummary != nil {
			t.Fatalf("unexpected summary without AI: %+v", msg)
		}
	}
}

// failingQueryRow fails the one query whose text contains match.
type failingQueryRow struct {
	db.DBTX
	match string
}

func (f failingQueryRow) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, f.match) {
		return errRow{}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

type errRow struct{}

func (errRow) Scan(...any) error { return errors.New("injected query failure") }

// The hangup has already taken the session out of the map when it reads the
// summary caps, so a cap it cannot read skips the summary and keeps the call
// log rather than failing the hangup (UNI-1090).
func TestVoiceHangupKeepsTheCallLogWhenTheSummaryCapFails(t *testing.T) {
	s, _, ua, ub, w, pool := aiChatFixture(t)
	ctx := context.Background()
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	s.q = db.New(failingQueryRow{DBTX: pool, match: "-- name: CountQueuedVoiceCallSummaries "})
	talk(t, s, ua, ub, w, dm.ID, "cap-unreadable", 45*time.Second)
	if n := queuedVoiceSummaries(t, pool, dm.ID); n != 0 {
		t.Fatalf("queued %d summaries with unreadable caps, want 0", n)
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	logs := 0
	for _, m := range msgs {
		if m.Kind == "voice_call_log" {
			logs++
		}
	}
	if logs != 1 {
		t.Fatalf("call logs = %d, want 1", logs)
	}
}

// failVoiceSummaryJobsFor makes the outbox refuse the summary job of one room,
// the way a database failing mid-hangup would, until the test ends.
func failVoiceSummaryJobsFor(t *testing.T, pool *pgxpool.Pool, roomID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE OR REPLACE FUNCTION test_fail_voice_summary_job() RETURNS trigger
		LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.topic = 'chat.voice.call.completed' AND NEW.payload::jsonb->>'room_id' = '`+roomID+`' THEN
				RAISE EXCEPTION 'injected outbox failure';
			END IF;
			RETURN NEW;
		END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `CREATE TRIGGER test_fail_voice_summary_job BEFORE INSERT ON outbox_events
		FOR EACH ROW EXECUTE FUNCTION test_fail_voice_summary_job()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DROP TRIGGER IF EXISTS test_fail_voice_summary_job ON outbox_events`)
		_, _ = pool.Exec(ctx, `DROP FUNCTION IF EXISTS test_fail_voice_summary_job()`)
	})
}

func voiceCallLogCount(t *testing.T, pool *pgxpool.Pool, roomID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_messages WHERE room_id = $1 AND kind = 'voice_call_log'`, roomID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// The call log, its audit row and its summary job commit together, so a
// failed job never leaves a log that says "summarising" forever; the other
// side still hears the hangup (UNI-1703).
func TestVoiceCallLogAndSummaryJobCommitTogether(t *testing.T) {
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	s.SetAIGateway(ai.NewGateway(q, &provider.Fake{Reply: ai.FakeReply}, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	failVoiceSummaryJobsFor(t, pool, dm.ID)
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, "tx-fail")
	backdateVoiceCallAnswer(t, dm.ID, "tx-fail", 45*time.Second)
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, "tx-fail"); err == nil {
		t.Fatal("hangup succeeded although the summary job could not be queued")
	}
	if n := voiceCallLogCount(t, pool, dm.ID); n != 0 {
		t.Fatalf("call logs = %d, want 0 when the summary job failed", n)
	}
	var audited int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'chat.voice_call.logged'`, w.OrganizationID,
	).Scan(&audited); err != nil {
		t.Fatal(err)
	}
	if audited != 0 {
		t.Fatalf("audit rows = %d, want 0", audited)
	}
	if len(pub.sentTo("chat.voice.hangup")) == 0 {
		t.Fatal("chat.voice.hangup not published after a failed call log")
	}
}

// A logged call writes one audit row for the log, sharing its correlation id
// with the summary job it queued (ADR 0009, UNI-1703).
func TestVoiceCallLogWritesAuditAndJobTogether(t *testing.T) {
	s, _, ua, ub, w, pool := aiChatFixture(t)
	ctx := context.Background()
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	talk(t, s, ua, ub, w, dm.ID, "tx-ok", 45*time.Second)
	var logID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM chat_messages WHERE room_id = $1 AND kind = 'voice_call_log'`, dm.ID,
	).Scan(&logID); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx,
		`SELECT resource_id, correlation_id FROM audit_events WHERE organization_id = $1 AND action = 'chat.voice_call.logged'`, w.OrganizationID)
	if err != nil {
		t.Fatal(err)
	}
	var resources, correlations []string
	for rows.Next() {
		var res, corr string
		if err := rows.Scan(&res, &corr); err != nil {
			t.Fatal(err)
		}
		resources = append(resources, res)
		correlations = append(correlations, corr)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(resources) != 1 || resources[0] != logID {
		t.Fatalf("audit rows for the log = %v, want [%s]", resources, logID)
	}
	var jobCorrelation string
	if err := pool.QueryRow(ctx,
		`SELECT coalesce(correlation_id, '') FROM outbox_events WHERE topic = 'chat.voice.call.completed' AND payload::jsonb->>'room_id' = $1`, dm.ID,
	).Scan(&jobCorrelation); err != nil {
		t.Fatal(err)
	}
	if jobCorrelation != correlations[0] {
		t.Fatalf("job correlation %q != audit correlation %q", jobCorrelation, correlations[0])
	}
}

// voiceSummaryJob returns the room's queued summary job payload, filled the
// way the consumer fills it, and the call log it summarises.
func voiceSummaryJob(t *testing.T, pool *pgxpool.Pool, w db.Workspace, roomID string) (map[string]string, db.ChatMessage) {
	t.Helper()
	ctx := context.Background()
	var raw string
	if err := pool.QueryRow(ctx,
		`SELECT payload FROM outbox_events WHERE topic = 'chat.voice.call.completed' AND payload::jsonb->>'room_id' = $1`, roomID,
	).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	payload := map[string]string{}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	payload["organization_id"], payload["workspace_id"] = w.OrganizationID, w.ID
	logMsg, err := db.New(pool).GetChatMessageByID(ctx, payload["call_log_message_id"])
	if err != nil {
		t.Fatal(err)
	}
	return payload, logMsg
}

func voiceSummaryCount(t *testing.T, pool *pgxpool.Pool, roomID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_messages WHERE room_id = $1 AND metadata ? 'voice_call_summary'`, roomID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A call log deleted before its summary job runs ends the job at once: no LLM
// call, no summary, no retry (UNI-1702).
func TestVoiceCallSummarySkipsADeletedCallLog(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	fake := &provider.Fake{Reply: ai.FakeReply}
	s.SetAIGateway(ai.NewGateway(q, fake, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	talk(t, s, ua, ub, w, dm.ID, "deleted-log", 45*time.Second)
	_, logMsg := voiceSummaryJob(t, pool, w, dm.ID)
	if err := s.DeleteChatMessage(ctx, logMsg.SenderID, w.ID, dm.ID, logMsg.ID); err != nil {
		t.Fatalf("delete call log: %v", err)
	}

	d := outbox.New(pool, q, outbox.Options{})
	d.Register(NewChatVoiceSummaryConsumer(s))
	if err := d.Process(ctx, 50); err != nil {
		t.Fatalf("process outbox: %v", err)
	}
	if fake.Calls != 0 {
		t.Fatalf("LLM calls = %d, want 0 for a deleted call log", fake.Calls)
	}
	if n := voiceSummaryCount(t, pool, dm.ID); n != 0 {
		t.Fatalf("summaries = %d, want 0", n)
	}
	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM outbox_events WHERE topic = 'chat.voice.call.completed' AND payload::jsonb->>'room_id' = $1`, dm.ID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "DONE" {
		t.Fatalf("summary job status = %s, want DONE", status)
	}
}

// A redelivered summary job posts nothing more: one call, one summary
// (UNI-1702).
func TestVoiceCallSummaryPostsOnceWhenRedelivered(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	fake := &provider.Fake{Reply: ai.FakeReply}
	s.SetAIGateway(ai.NewGateway(q, fake, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	talk(t, s, ua, ub, w, dm.ID, "redelivered", 45*time.Second)
	payload, _ := voiceSummaryJob(t, pool, w, dm.ID)
	for range 2 {
		if err := s.HandleVoiceCallCompleted(ctx, payload); err != nil {
			t.Fatalf("handle: %v", err)
		}
	}
	if n := voiceSummaryCount(t, pool, dm.ID); n != 1 {
		t.Fatalf("summaries = %d, want 1", n)
	}
	if fake.Calls != 1 {
		t.Fatalf("LLM calls = %d, want 1", fake.Calls)
	}
}
