package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatDocumentCardRefreshCap bounds how many chat cards one outbox row
// refreshes. The newest cards go first; the overflow is logged by document id
// and refetches when its room is next opened.
const chatDocumentCardRefreshCap = 500

// chatDocumentCardTopics are the document events that change what a chat card
// shows: the version badge, the title, the viewer's access and the archive
// state.
var chatDocumentCardTopics = []string{
	"document.version_created",
	"document.updated",
	"document.shared",
	"document.share_revoked",
	"document.workspace_access_changed",
	"document.archived",
	"document.restored",
}

// ChatDocumentCardRefresher tells every room that holds a card of a document to
// refetch that card when the document changes (UNI-2012 D3-B). A document.*
// frame reaches only the document's own workspace, so a recipient in another
// workspace would otherwise keep a stale card until they reopen the room.
//
// The signal is the existing ephemeral chat.message.updated {room_id,
// message_id}, published directly: losing one costs nobody anything, the card
// refetches on reopen or focus. It runs on the notify lane because it fans out
// across rooms.
type ChatDocumentCardRefresher struct {
	q    *db.Queries
	chat *ChatService
	log  *slog.Logger
}

// NewChatDocumentCardRefresher wires the consumer over the chat service that
// owns room delivery.
func NewChatDocumentCardRefresher(q *db.Queries, chat *ChatService) *ChatDocumentCardRefresher {
	return &ChatDocumentCardRefresher{q: q, chat: chat, log: slog.Default()}
}

func (*ChatDocumentCardRefresher) Name() string { return "chat_document_card_refresher" }

func (*ChatDocumentCardRefresher) Topics() []string {
	return append([]string(nil), chatDocumentCardTopics...)
}

func (c *ChatDocumentCardRefresher) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_document_card_refresher: payload of %s: %w", ev.ID, err)
		}
	}
	docID := strings.TrimSpace(payload["document_id"])
	orgID := strings.TrimSpace(payload["organization_id"])
	if orgID == "" {
		orgID = strings.TrimSpace(ev.OrganizationID.String)
	}
	if docID == "" || orgID == "" || c.chat == nil {
		return nil
	}
	cards, err := c.q.ListLiveChatDocumentCardMessages(ctx, db.ListLiveChatDocumentCardMessagesParams{
		OrganizationID: orgID, DocumentID: docID, RowLimit: chatDocumentCardRefreshCap + 1,
	})
	if err != nil {
		return err
	}
	if len(cards) > chatDocumentCardRefreshCap {
		c.log.Warn("chat document card refresh truncated",
			"document_id", docID, "organization_id", orgID, "outbox_id", ev.ID, "cap", chatDocumentCardRefreshCap)
		cards = cards[:chatDocumentCardRefreshCap]
	}
	rooms := map[string]*db.ChatRoom{}
	seen := map[string]bool{}
	for _, card := range cards {
		key := card.RoomID + "/" + card.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		room, ok := rooms[card.RoomID]
		if !ok {
			r, err := c.q.GetChatRoomByID(ctx, card.RoomID)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				rooms[card.RoomID] = nil
				continue
			case err != nil:
				return err
			}
			room = &r
			rooms[card.RoomID] = room
		}
		if room == nil || room.OrganizationID != orgID {
			continue
		}
		c.chat.publishChatMessageUpdated(ctx, *room, card.ID)
	}
	return nil
}
