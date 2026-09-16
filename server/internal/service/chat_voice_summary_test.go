package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/outbox"
)

func TestVoiceCallSummaryPostsMessage(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	fake := &provider.Fake{Reply: ai.FakeReply}
	s.SetAIGateway(ai.NewGateway(q, fake, NewAIQuota(NewEntitlementService(pool, q)), nil, ai.Options{}))

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "summary-call-1"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "summary-call-1"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	duration := 45
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "summary-call-1", &duration); err != nil {
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

func TestVoiceCallSummarySkipsWhenAIDisabled(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "summary-call-2"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "summary-call-2"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	duration := 45
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "summary-call-2", &duration); err != nil {
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
