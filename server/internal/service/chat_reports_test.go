package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestReportChatMessageAndPerson(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	msg, err := s.SendRoomMessage(ctx, ub.ID, w.ID, dm.ID, SendChatMessageInput{Body: "rude words"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	byMessage, err := s.ReportChat(ctx, ua.ID, w.ID, ReportChatInput{MessageID: msg.ID, Reason: "harassment", Details: "  kept private  "})
	if err != nil || byMessage.ID == "" || byMessage.Status != "open" {
		t.Fatalf("report message: %+v %v", byMessage, err)
	}
	var target, room, details string
	if err := s.pool.QueryRow(ctx, `SELECT target_user_id, room_id, details FROM chat_reports WHERE id = $1 AND organization_id = $2`,
		byMessage.ID, w.OrganizationID).Scan(&target, &room, &details); err != nil {
		t.Fatal(err)
	}
	if target != ub.ID || room != dm.ID || details != "kept private" {
		t.Fatalf("stored report: target=%s room=%s details=%q", target, room, details)
	}
	// The reporter's words stay in the row: the audit metadata carries ids and the reason only.
	var meta string
	if err := s.pool.QueryRow(ctx, `SELECT metadata::text FROM audit_events WHERE action = 'chat.report.created' AND resource_id = $1`, byMessage.ID).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(meta, "kept private") || !strings.Contains(meta, "harassment") || !strings.Contains(meta, msg.ID) {
		t.Fatalf("audit metadata: %s", meta)
	}

	byPerson, err := s.ReportChat(ctx, ua.ID, w.ID, ReportChatInput{UserID: strings.ToLower(ub.ID), Reason: "spam"})
	if err != nil || byPerson.ID == "" {
		t.Fatalf("report person: %+v %v", byPerson, err)
	}
}

func TestReportChatRefusesWhatItCannotFile(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	own, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "mine"})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		in      ReportChatInput
		invalid bool
	}{
		{"unknown reason", ReportChatInput{UserID: ub.ID, Reason: "boring"}, true},
		{"no target", ReportChatInput{Reason: "spam"}, true},
		{"two targets", ReportChatInput{UserID: ub.ID, MessageID: own.ID, Reason: "spam"}, true},
		{"details too long", ReportChatInput{UserID: ub.ID, Reason: "other", Details: strings.Repeat("x", chatReportDetailsMax+1)}, true},
		{"own message", ReportChatInput{MessageID: own.ID, Reason: "spam"}, true},
		{"oneself", ReportChatInput{UserID: ua.ID, Reason: "spam"}, true},
		{"unknown message", ReportChatInput{MessageID: "01J8X4K2M0N1P2Q3R4S5T6U7V8", Reason: "spam"}, false},
		{"person outside the organization", ReportChatInput{UserID: "01J8X4K2M0N1P2Q3R4S5T6U7V8", Reason: "spam"}, false},
	}
	for _, c := range cases {
		_, err := s.ReportChat(ctx, ua.ID, w.ID, c.in)
		var ve ValidationError
		if c.invalid && !errors.As(err, &ve) {
			t.Errorf("%s: got %v, want a validation error", c.name, err)
		}
		if !c.invalid && !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: got %v, want ErrNotFound", c.name, err)
		}
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chat_reports WHERE organization_id = $1`, w.OrganizationID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("a refused report wrote %d rows", n)
	}
}
