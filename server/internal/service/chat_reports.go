package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Reporting a message or a person (store UGC policy: Apple guideline 1.2,
// Google Play's user-generated content policy). A report is a row the
// organization's owners and admins read through the audit trail
// (chat.report.created); the reporter's own words stay in the row and never
// reach the audit metadata, which carries no free text.

const (
	chatReportResource   = "chat_report"
	chatReportDetailsMax = 1000
)

// ChatReportReasons is the closed set the migration's CHECK holds.
var ChatReportReasons = []string{"spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"}

// ReportChatInput names exactly one target: a message (its sender is the
// person reported) or a person.
type ReportChatInput struct {
	MessageID string
	UserID    string
	Reason    string
	Details   string
}

// ChatReport is what the handler answers.
type ChatReport struct {
	ID     string
	Status string
}

func validChatReportReason(reason string) bool {
	for _, r := range ChatReportReasons {
		if r == reason {
			return true
		}
	}
	return false
}

// ReportChat files one report from the caller in a workspace. A message must
// be one the caller can read; a person must belong to the workspace's
// organization. Either answers 404 otherwise, as an unknown id does, so a
// report never reveals that a row exists elsewhere.
func (s *ChatService) ReportChat(ctx context.Context, reporterID, workspaceID string, in ReportChatInput) (ChatReport, error) {
	reason := strings.TrimSpace(in.Reason)
	if !validChatReportReason(reason) {
		return ChatReport{}, Invalid("reason phải là một trong: " + strings.Join(ChatReportReasons, ", "))
	}
	details := strings.TrimSpace(in.Details)
	if utf8.RuneCountInString(details) > chatReportDetailsMax {
		return ChatReport{}, Invalid("mô tả quá dài")
	}
	messageID := strings.TrimSpace(in.MessageID)
	userID := strings.ToUpper(strings.TrimSpace(in.UserID))
	if (messageID == "") == (userID == "") {
		return ChatReport{}, Invalid("cần đúng một trong message_id hoặc user_id")
	}

	var (
		orgID, anchorWS string
		roomID, msgID   pgtype.Text
		target          string
	)
	if messageID != "" {
		room, msg, err := s.loadMessageForLink(ctx, reporterID, workspaceID, messageID)
		if err != nil {
			return ChatReport{}, err
		}
		if msg.SenderID == reporterID {
			return ChatReport{}, Invalid("không thể báo cáo tin nhắn của chính bạn")
		}
		orgID, target = room.OrganizationID, msg.SenderID
		anchorWS = roomAnchorWorkspaceID(room)
		roomID = pgtype.Text{String: room.ID, Valid: true}
		msgID = pgtype.Text{String: msg.ID, Valid: true}
	} else {
		w, err := s.workspaceForChat(ctx, reporterID, workspaceID)
		if err != nil {
			return ChatReport{}, err
		}
		if userID == reporterID {
			return ChatReport{}, Invalid("không thể báo cáo chính bạn")
		}
		if err := s.requireOrgPeer(ctx, w.OrganizationID, userID); err != nil {
			return ChatReport{}, err
		}
		orgID, target = w.OrganizationID, userID
	}
	if anchorWS == "" {
		anchorWS = workspaceID
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatReport{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	row, err := q.InsertChatReport(ctx, db.InsertChatReportParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: anchorWS,
		RoomID: roomID, MessageID: msgID, TargetUserID: target,
		Reason: reason, Details: details,
		CreatedBy: reporterID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		return ChatReport{}, err
	}
	meta := map[string]any{"reason": reason, "target_user_id": target}
	if msgID.Valid {
		meta["message_id"], meta["room_id"] = msgID.String, roomID.String
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: anchorWS,
		Actor: Human(reporterID), Action: audit.ActionChatReportCreated,
		ResourceType: chatReportResource, ResourceID: row.ID,
		Metadata: meta,
	}); err != nil {
		return ChatReport{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatReport{}, err
	}
	return ChatReport{ID: row.ID, Status: row.Status}, nil
}
