package service

import (
	"errors"
	"testing"
)

// The operator's takedown of a reported message (store UGC policy, Apple 1.2):
// the message goes for everyone as its sender's own deletion would, the report
// closes, and the console, the organization's trail and the removal commit
// together. Needs Postgres (TEST_DATABASE_URL), like the rest of the package.
func TestRemoveReportedMessage(t *testing.T) {
	reported := func(t *testing.T) (*auditFixture, string, string) {
		t.Helper()
		f := newAuditFixture(t)
		dm := f.newDM(t)
		w := f.build(t)
		msg, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, w.ID, dm.ID, SendChatMessageInput{Body: "objectionable"})
		if err != nil {
			t.Fatal(err)
		}
		report, err := f.chat.ReportChat(f.ctx, f.member.ID, w.ID, ReportChatInput{MessageID: msg.ID, Reason: "harassment"})
		if err != nil {
			t.Fatal(err)
		}
		f.admin.SetReportedContentRemover(f.chat)
		return f, report.ID, msg.ID
	}
	count := func(t *testing.T, f *auditFixture, sql string, args ...any) int {
		t.Helper()
		var n int
		if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("removes the message for everyone and closes the report", func(t *testing.T) {
		f, reportID, msgID := reported(t)
		row, err := f.admin.RemoveReportedMessage(f.ctx, f.third.ID, reportID, "taken down after reviewing the report")
		if err != nil {
			t.Fatal(err)
		}
		if row.Status != "resolved" {
			t.Fatalf("report status: %s", row.Status)
		}
		if n := count(t, f, `SELECT count(*) FROM chat_messages WHERE id = $1 AND deleted_at IS NOT NULL`, msgID); n != 1 {
			t.Fatal("the message is still there")
		}
		if n := count(t, f, `SELECT count(*) FROM audit_events WHERE action = 'chat.message.removed' AND resource_id = $1 AND organization_id = $2`, msgID, f.orgID); n != 1 {
			t.Fatalf("chat.message.removed rows in the organization: %d", n)
		}
		if n := count(t, f, `SELECT count(*) FROM audit_events WHERE action = 'chat.report.resolved' AND resource_id = $1`, reportID); n != 1 {
			t.Fatalf("chat.report.resolved rows: %d", n)
		}
		if n := count(t, f, `SELECT count(*) FROM admin_actions WHERE action = 'chat.message.removed' AND target_id = $1`, reportID); n != 1 {
			t.Fatalf("admin_actions rows: %d", n)
		}
	})

	t.Run("a message its sender already deleted still closes the report", func(t *testing.T) {
		f, reportID, msgID := reported(t)
		w := f.build(t)
		var roomID string
		if err := f.pool.QueryRow(f.ctx, `SELECT room_id FROM chat_messages WHERE id = $1`, msgID).Scan(&roomID); err != nil {
			t.Fatal(err)
		}
		if err := f.chat.DeleteChatMessage(f.ctx, f.owner.ID, w.ID, roomID, msgID); err != nil {
			t.Fatal(err)
		}
		row, err := f.admin.RemoveReportedMessage(f.ctx, f.third.ID, reportID, "taken down after reviewing the report")
		if err != nil || row.Status != "resolved" {
			t.Fatalf("takedown of a deleted message: %v %s", err, row.Status)
		}
		if n := count(t, f, `SELECT count(*) FROM audit_events WHERE action = 'chat.message.removed'`); n != 0 {
			t.Fatalf("nothing was removed, yet %d removal rows", n)
		}
	})

	t.Run("a report about a person has no message to take down", func(t *testing.T) {
		f := newAuditFixture(t)
		w := f.build(t)
		f.addMember(t)
		report, err := f.chat.ReportChat(f.ctx, f.owner.ID, w.ID, ReportChatInput{UserID: f.member.ID, Reason: "spam"})
		if err != nil {
			t.Fatal(err)
		}
		f.admin.SetReportedContentRemover(f.chat)
		if _, err := f.admin.RemoveReportedMessage(f.ctx, f.third.ID, report.ID, "taken down after reviewing the report"); !errors.As(err, new(ValidationError)) {
			t.Fatalf("takedown of a person report: %v", err)
		}
	})

	t.Run("needs a reason, a known report and the chat side", func(t *testing.T) {
		f, reportID, _ := reported(t)
		if _, err := f.admin.RemoveReportedMessage(f.ctx, f.third.ID, reportID, "short"); err == nil {
			t.Fatal("a reason under ten characters was accepted")
		}
		if _, err := f.admin.RemoveReportedMessage(f.ctx, f.third.ID, "01NOSUCHREPORT0000000000000", "taken down after reviewing the report"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown report: %v", err)
		}
		bare := NewAdminService(f.pool, f.q, nil, nil)
		if _, err := bare.RemoveReportedMessage(f.ctx, f.third.ID, reportID, "taken down after reviewing the report"); !errors.Is(err, errTakedownUnavailable) {
			t.Fatalf("takedown without the chat side: %v", err)
		}
	})
}
