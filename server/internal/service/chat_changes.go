package service

// The chat change log (ADR 0039 draft, phase 1). Chat frames are ephemeral
// and carry ids only, so a client could not tell which edits, deletes and
// reactions it missed while its socket was down, or a frame the relay lost
// while it stayed up: it refetched every page it had loaded on every
// reconnect. Each change to a message now also lands in chat_changes under
// its organization's own sequence, and SyncChatChanges answers "what changed
// after N" with the messages as the caller may read them now.
//
// The row is written right after the change commits, beside its frame (the
// publish helpers), in a short transaction of its own: the head row's lock
// orders the writers, so sequence order is commit order and a reader never
// sees N+1 before N. A write that fails is logged and the change is missing
// from the log, the same loss a dropped frame is today; it is not the
// outbox's exactly-once (ADR 0009) because the log is a projection that a
// reload rebuilds, not a business record.

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// ChatChangeCreated and the two below are chat_changes.kind.
	ChatChangeCreated = "created"
	ChatChangeUpdated = "updated"
	ChatChangeDeleted = "deleted"

	// chatChangeRetention is how many changes an organization keeps; a client
	// further behind than that reloads. Trimmed every chatChangeTrimEvery writes.
	chatChangeRetention = 50_000
	chatChangeTrimEvery = 1_000

	// ChatSyncMaxChanges bounds one sync answer: past it, reloading the rooms
	// on screen costs less than re-reading every changed message.
	ChatSyncMaxChanges = 200
)

// ChatSyncChange is one changed message, as the caller may read it now.
type ChatSyncChange struct {
	Seq       int64
	RoomID    string
	MessageID string
	// Kind is the message's last change in the page: created, updated or deleted.
	Kind string
	// Message is the message now; nil when it is gone.
	Message *ChatMessageRow
}

// ChatSyncPage answers GET .../chat/sync.
type ChatSyncPage struct {
	// Head is what the client asks after next time.
	Head int64
	// Reset: the client is too far behind (or ahead, a restored database);
	// it reloads what it shows and starts again from Head.
	Reset   bool
	Changes []ChatSyncChange
}

// recordChatChange logs one change to a message of room. The room may be a
// partial row (chat_task_sync.go passes only its id and workspace); its
// organization is then read.
func (s *ChatService) recordChatChange(ctx context.Context, room db.ChatRoom, messageID, kind string) {
	if s.pool == nil || messageID == "" {
		return
	}
	orgID := room.OrganizationID
	if orgID == "" {
		full, err := s.q.GetChatRoomByID(ctx, room.ID)
		if err != nil {
			slog.WarnContext(ctx, "chat change: room not read", "room_id", room.ID, "message_id", messageID, "error", err)
			return
		}
		orgID = full.OrganizationID
	}
	if err := s.writeChatChange(ctx, orgID, room.ID, messageID, kind); err != nil {
		slog.WarnContext(ctx, "chat change not recorded", "organization_id", orgID, "room_id", room.ID, "message_id", messageID, "kind", kind, "error", err)
	}
}

func (s *ChatService) writeChatChange(ctx context.Context, orgID, roomID, messageID, kind string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	seq, err := q.AdvanceChatChangeHead(ctx, orgID)
	if err != nil {
		return err
	}
	if err := q.InsertChatChange(ctx, db.InsertChatChangeParams{
		OrganizationID: orgID, Seq: seq, RoomID: roomID, MessageID: messageID, Kind: kind,
	}); err != nil {
		return err
	}
	if seq%chatChangeTrimEvery == 0 && seq > chatChangeRetention {
		if err := q.TrimChatChanges(ctx, db.TrimChatChangesParams{OrganizationID: orgID, UpTo: seq - chatChangeRetention}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// SyncChatChanges answers what changed in the chat of the workspace's
// organization after `since`, limited to the rooms the caller may read from
// this workspace (its channels, the organization's DMs and groups it is in).
// Without a since (hasSince false) it only says where the log is, for a
// client that has just loaded what it shows.
func (s *ChatService) SyncChatChanges(ctx context.Context, userID, workspaceID string, since int64, hasSince bool) (ChatSyncPage, error) {
	member, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return ChatSyncPage{}, err
	}
	orgID := member.OrganizationID
	head, err := s.q.GetChatChangeHead(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		head, err = 0, nil
	}
	if err != nil {
		return ChatSyncPage{}, err
	}
	switch {
	case !hasSince || since == head:
		return ChatSyncPage{Head: head, Changes: []ChatSyncChange{}}, nil
	case since < 0 || since > head:
		return ChatSyncPage{Head: head, Reset: true, Changes: []ChatSyncChange{}}, nil
	}
	oldest, err := s.q.OldestChatChangeSeq(ctx, orgID)
	if err != nil {
		return ChatSyncPage{}, err
	}
	if oldest == 0 || since < oldest-1 {
		return ChatSyncPage{Head: head, Reset: true, Changes: []ChatSyncChange{}}, nil
	}
	rows, err := s.q.ListChatChangesSince(ctx, db.ListChatChangesSinceParams{OrganizationID: orgID, Since: since, RowLimit: ChatSyncMaxChanges + 1})
	if err != nil {
		return ChatSyncPage{}, err
	}
	if len(rows) > ChatSyncMaxChanges {
		return ChatSyncPage{Head: head, Reset: true, Changes: []ChatSyncChange{}}, nil
	}
	page := ChatSyncPage{Head: since, Changes: []ChatSyncChange{}}
	changes, err := s.readableChatChanges(ctx, userID, workspaceID, rows)
	if err != nil {
		return ChatSyncPage{}, err
	}
	page.Changes = changes
	if len(rows) > 0 {
		page.Head = rows[len(rows)-1].Seq
	}
	return page, nil
}

// readableChatChanges keeps the changes of rooms the caller may read, one per
// message (its last change), each with the message as the caller sees it now.
func (s *ChatService) readableChatChanges(ctx context.Context, userID, workspaceID string, rows []db.ListChatChangesSinceRow) ([]ChatSyncChange, error) {
	readable := map[string]bool{}
	last := map[string]int{}
	var out []ChatSyncChange
	for _, row := range rows {
		ok, seen := readable[row.RoomID]
		if !seen {
			_, err := s.authorizeRoomRead(ctx, userID, workspaceID, row.RoomID)
			switch {
			case err == nil:
				ok = true
			case errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden):
				ok = false
			default:
				return nil, err
			}
			readable[row.RoomID] = ok
		}
		if !ok {
			continue
		}
		change := ChatSyncChange{Seq: row.Seq, RoomID: row.RoomID, MessageID: row.MessageID, Kind: row.Kind}
		if at, dup := last[row.MessageID]; dup {
			// A message created then edited in the same page is still new to the client.
			if out[at].Kind == ChatChangeCreated && change.Kind == ChatChangeUpdated {
				change.Kind = ChatChangeCreated
			}
			out = append(out[:at], out[at+1:]...)
			for id, i := range last {
				if i > at {
					last[id] = i - 1
				}
			}
		}
		last[row.MessageID] = len(out)
		out = append(out, change)
	}
	for i := range out {
		if out[i].Kind == ChatChangeDeleted {
			continue
		}
		msg, err := s.GetRoomMessage(ctx, userID, workspaceID, out[i].RoomID, out[i].MessageID)
		switch {
		case err == nil:
			out[i].Message = &msg
		case errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden):
			out[i].Kind = ChatChangeDeleted
		default:
			return nil, err
		}
	}
	if out == nil {
		out = []ChatSyncChange{}
	}
	return out, nil
}
