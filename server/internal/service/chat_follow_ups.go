package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatFollowUpNoteMax  = 2000
	chatFollowUpListDef  = 50
	chatFollowUpListMax  = 100
	chatFollowUpResource = "chat_follow_up"
)

// ChatFollowUpRow is the service/handler view of a personal follow-up.
type ChatFollowUpRow struct {
	ID                string
	OrganizationID    string
	WorkspaceID       string
	RoomID            string
	MessageID         string
	UserID            string
	Note              string
	DueAt             *time.Time
	CompletedAt       *time.Time
	CreatedBy         string
	CreatedByKind     string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	RoomKind          string
	RoomName          string
	RoomVisibility    string
	PeerDisplayName   string
	MessageBody       string
	MessageKind       string
	MessageSenderID   string
	MessageSenderName string
}

// PatchFollowUpInput patches note/due and optionally completed.
// DueAtSet vs ClearDueAt distinguish "leave due_at alone", "set", and "clear".
type PatchFollowUpInput struct {
	Note       *string
	DueAt      *time.Time
	DueAtSet   bool
	ClearDueAt bool
	Completed  *bool
}

func chatFollowUpRow(row db.ChatMessageFollowUp) ChatFollowUpRow {
	out := ChatFollowUpRow{
		ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		RoomID: row.RoomID, MessageID: row.MessageID, UserID: row.UserID, Note: row.Note,
		CreatedBy: row.CreatedBy, CreatedByKind: row.CreatedByKind,
		CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
	if row.DueAt.Valid {
		t := row.DueAt.Time.UTC()
		out.DueAt = &t
	}
	if row.CompletedAt.Valid {
		t := row.CompletedAt.Time.UTC()
		out.CompletedAt = &t
	}
	return out
}

func chatFollowUpListRow(row db.ListChatMessageFollowUpsForUserRow) ChatFollowUpRow {
	out := ChatFollowUpRow{
		ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		RoomID: row.RoomID, MessageID: row.MessageID, UserID: row.UserID, Note: row.Note,
		CreatedBy: row.CreatedBy, CreatedByKind: row.CreatedByKind,
		CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		RoomKind: row.RoomKind, RoomName: row.RoomName, RoomVisibility: row.RoomVisibility,
		PeerDisplayName:   row.PeerDisplayName,
		MessageKind:       row.MessageKind,
		MessageSenderID:   row.MessageSenderID,
		MessageSenderName: row.MessageSenderName,
		MessageBody:       chatSidebarPreviewBody(row.MessageBody, row.MessageKind),
	}
	if row.DueAt.Valid {
		t := row.DueAt.Time.UTC()
		out.DueAt = &t
	}
	if row.CompletedAt.Valid {
		t := row.CompletedAt.Time.UTC()
		out.CompletedAt = &t
	}
	return out
}

func followUpEventPayload(row db.ChatMessageFollowUp) map[string]string {
	return map[string]string{
		"follow_up_id": row.ID,
		"workspace_id": row.WorkspaceID,
		"room_id":      row.RoomID,
		"message_id":   row.MessageID,
		"user_id":      row.UserID,
	}
}

func normalizeFollowUpNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > chatFollowUpNoteMax {
		return "", Invalid("note quá dài")
	}
	return note, nil
}

func optDueAt(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: t.UTC(), Valid: true}
}

func (s *ChatService) loadOwnFollowUp(
	ctx context.Context, userID, workspaceID, id string,
) (db.ChatMessageFollowUp, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return db.ChatMessageFollowUp{}, err
	}
	row, err := s.q.GetChatMessageFollowUpByID(ctx, db.GetChatMessageFollowUpByIDParams{
		ID: id, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatMessageFollowUp{}, ErrNotFound
	}
	if err != nil {
		return db.ChatMessageFollowUp{}, err
	}
	if row.UserID != userID {
		return db.ChatMessageFollowUp{}, ErrNotFound
	}
	return row, nil
}

// CreateFollowUp marks a message as a personal follow-up for the caller.
// A second call for the same user+message returns the existing row, updating
// note/due when those fields are provided.
func (s *ChatService) CreateFollowUp(
	ctx context.Context, userID, workspaceID, messageID, note string, dueAt *time.Time,
) (ChatFollowUpRow, error) {
	room, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	note, err = normalizeFollowUpNote(note)
	if err != nil {
		return ChatFollowUpRow{}, err
	}

	if existing, err := s.q.GetChatMessageFollowUpByUserMessage(ctx, db.GetChatMessageFollowUpByUserMessageParams{
		UserID: userID, MessageID: msg.ID,
	}); err == nil {
		if existing.WorkspaceID != workspaceID {
			return ChatFollowUpRow{}, ErrNotFound
		}
		changed := false
		nextNote := existing.Note
		nextDue := existing.DueAt
		if note != "" && note != existing.Note {
			nextNote = note
			changed = true
		}
		if dueAt != nil {
			want := optDueAt(dueAt)
			if !existing.DueAt.Valid || !existing.DueAt.Time.Equal(want.Time) {
				nextDue = want
				changed = true
			}
		}
		if !changed {
			return chatFollowUpRow(existing), nil
		}
		return s.patchFollowUpRow(ctx, userID, existing, nextNote, nextDue)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatFollowUpRow{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	if anchorWS == "" {
		anchorWS = workspaceID
	}
	row, err := q.InsertChatMessageFollowUp(ctx, db.InsertChatMessageFollowUpParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: anchorWS, RoomID: room.ID,
		MessageID: msg.ID, UserID: userID, Note: note, DueAt: optDueAt(dueAt),
		CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		if isUniqueViolation(err) {
			existing, lookupErr := s.q.GetChatMessageFollowUpByUserMessage(ctx, db.GetChatMessageFollowUpByUserMessageParams{
				UserID: userID, MessageID: msg.ID,
			})
			if lookupErr != nil {
				return ChatFollowUpRow{}, lookupErr
			}
			return chatFollowUpRow(existing), nil
		}
		return ChatFollowUpRow{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: anchorWS,
		Actor: Human(userID), Action: audit.ActionChatFollowUpCreated,
		ResourceType: chatFollowUpResource, ResourceID: row.ID,
		Metadata: map[string]any{"message_id": msg.ID, "room_id": room.ID},
	}, audit.Event{Topic: "chat.follow_up.created", Payload: followUpEventPayload(row)}); err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatFollowUpRow{}, err
	}
	return chatFollowUpRow(row), nil
}

// ListFollowUps lists the caller's follow-ups in a workspace.
func (s *ChatService) ListFollowUps(
	ctx context.Context, workspaceID, userID string, includeCompleted bool, limit int,
) ([]ChatFollowUpRow, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = chatFollowUpListDef
	}
	if limit > chatFollowUpListMax {
		limit = chatFollowUpListMax
	}
	rows, err := s.q.ListChatMessageFollowUpsForUser(ctx, db.ListChatMessageFollowUpsForUserParams{
		WorkspaceID: workspaceID, UserID: userID, Limit: int32(limit), Column4: includeCompleted,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatFollowUpRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, chatFollowUpListRow(row))
	}
	return out, nil
}

// PatchFollowUp updates note/due and optionally toggles completed.
func (s *ChatService) PatchFollowUp(
	ctx context.Context, userID, workspaceID, id string, in PatchFollowUpInput,
) (ChatFollowUpRow, error) {
	row, err := s.loadOwnFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return ChatFollowUpRow{}, err
	}

	out := chatFollowUpRow(row)
	nextNote := row.Note
	if in.Note != nil {
		nextNote, err = normalizeFollowUpNote(*in.Note)
		if err != nil {
			return ChatFollowUpRow{}, err
		}
	}
	nextDue := row.DueAt
	if in.ClearDueAt {
		nextDue = pgtype.Timestamptz{}
	} else if in.DueAtSet {
		nextDue = optDueAt(in.DueAt)
	}
	if nextNote != row.Note || !dueEqual(nextDue, row.DueAt) {
		out, err = s.patchFollowUpRow(ctx, userID, row, nextNote, nextDue)
		if err != nil {
			return ChatFollowUpRow{}, err
		}
	}

	if in.Completed != nil {
		if *in.Completed {
			return s.CompleteFollowUp(ctx, userID, workspaceID, id)
		}
		return s.ReopenFollowUp(ctx, userID, workspaceID, id)
	}
	return out, nil
}

func dueEqual(a, b pgtype.Timestamptz) bool {
	if a.Valid != b.Valid {
		return false
	}
	if !a.Valid {
		return true
	}
	return a.Time.Equal(b.Time)
}

func (s *ChatService) patchFollowUpRow(
	ctx context.Context, userID string, existing db.ChatMessageFollowUp, note string, due pgtype.Timestamptz,
) (ChatFollowUpRow, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.PatchChatMessageFollowUp(ctx, db.PatchChatMessageFollowUpParams{
		ID: existing.ID, WorkspaceID: existing.WorkspaceID, UserID: userID, Note: note, DueAt: due,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatFollowUpRow{}, ErrNotFound
	}
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatFollowUpUpdated,
		ResourceType: chatFollowUpResource, ResourceID: row.ID,
	}, audit.Event{Topic: "chat.follow_up.updated", Payload: followUpEventPayload(row)}); err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatFollowUpRow{}, err
	}
	return chatFollowUpRow(row), nil
}

// CompleteFollowUp marks a follow-up done (idempotent if already completed).
func (s *ChatService) CompleteFollowUp(
	ctx context.Context, userID, workspaceID, id string,
) (ChatFollowUpRow, error) {
	existing, err := s.loadOwnFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	if existing.CompletedAt.Valid {
		return chatFollowUpRow(existing), nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.CompleteChatMessageFollowUp(ctx, db.CompleteChatMessageFollowUpParams{
		ID: id, WorkspaceID: workspaceID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatFollowUpRow{}, ErrNotFound
	}
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatFollowUpCompleted,
		ResourceType: chatFollowUpResource, ResourceID: row.ID,
	}, audit.Event{Topic: "chat.follow_up.completed", Payload: followUpEventPayload(row)}); err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatFollowUpRow{}, err
	}
	return chatFollowUpRow(row), nil
}

// ReopenFollowUp clears completed_at (idempotent if already open).
func (s *ChatService) ReopenFollowUp(
	ctx context.Context, userID, workspaceID, id string,
) (ChatFollowUpRow, error) {
	existing, err := s.loadOwnFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	if !existing.CompletedAt.Valid {
		return chatFollowUpRow(existing), nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.ReopenChatMessageFollowUp(ctx, db.ReopenChatMessageFollowUpParams{
		ID: id, WorkspaceID: workspaceID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatFollowUpRow{}, ErrNotFound
	}
	if err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatFollowUpUpdated,
		ResourceType: chatFollowUpResource, ResourceID: row.ID,
		Metadata: map[string]any{"reopened": true},
	}, audit.Event{Topic: "chat.follow_up.updated", Payload: followUpEventPayload(row)}); err != nil {
		return ChatFollowUpRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatFollowUpRow{}, err
	}
	return chatFollowUpRow(row), nil
}

// DeleteFollowUp removes the caller's follow-up.
func (s *ChatService) DeleteFollowUp(ctx context.Context, userID, workspaceID, id string) error {
	existing, err := s.loadOwnFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.DeleteChatMessageFollowUp(ctx, db.DeleteChatMessageFollowUpParams{
		ID: id, WorkspaceID: workspaceID, UserID: userID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: existing.OrganizationID, WorkspaceID: existing.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatFollowUpDeleted,
		ResourceType: chatFollowUpResource, ResourceID: existing.ID,
	}, audit.Event{Topic: "chat.follow_up.deleted", Payload: followUpEventPayload(existing)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ConvertFollowUpToTask creates a task from the follow-up's message then completes it.
func (s *ChatService) ConvertFollowUpToTask(
	ctx context.Context, userID, workspaceID, id string, in CreateTaskFromMessageInput,
) (db.Task, ChatFollowUpRow, error) {
	existing, err := s.loadOwnFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return db.Task{}, ChatFollowUpRow{}, err
	}
	task, err := s.CreateTaskFromMessage(ctx, userID, workspaceID, existing.MessageID, in)
	if err != nil {
		return db.Task{}, ChatFollowUpRow{}, err
	}
	fu, err := s.CompleteFollowUp(ctx, userID, workspaceID, id)
	if err != nil {
		return db.Task{}, ChatFollowUpRow{}, err
	}
	return task, fu, nil
}
