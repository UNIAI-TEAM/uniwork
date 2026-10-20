package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"strings"

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
// refetches on reopen or focus. It rides the realtime lane, so it must meet the
// lane's bar: one indexed read (ListLiveChatDocumentCardTargets returns every
// card with its room and DM/group members in a single statement) and then only
// memory and ephemeral publishes, no per-room query however many cards there
// are. Moving it to the notify lane would slow the document.version_created,
// .updated, .workspace_access_changed and .restored frames of the Documents UI.
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
	var payload struct {
		DocumentID string `json:"document_id"`
	}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_document_card_refresher: payload of %s: %w", ev.ID, err)
		}
	}
	// The organization is the row's own column; none of the seven payloads
	// carries one, and a payload must not be able to name another tenant.
	docID := strings.TrimSpace(payload.DocumentID)
	orgID := strings.TrimSpace(ev.OrganizationID.String)
	if docID == "" || orgID == "" || c.chat == nil {
		return nil
	}
	cards, err := c.q.ListLiveChatDocumentCardTargets(ctx, db.ListLiveChatDocumentCardTargetsParams{
		OrganizationID: orgID, DocumentID: docID, RowLimit: chatDocumentCardRefreshCap,
	})
	if err != nil {
		return err
	}
	if len(cards) > 0 && int(cards[0].TotalCards) > len(cards) {
		c.log.Warn("chat document card refresh truncated",
			"document_id", docID, "organization_id", orgID, "outbox_id", ev.ID,
			"cap", chatDocumentCardRefreshCap, "dropped", int(cards[0].TotalCards)-len(cards))
	}
	activitySent := map[string]bool{}
	for _, card := range cards {
		c.publishCard(ctx, orgID, card, activitySent)
	}
	return nil
}

// publishCard sends the refresh frame of one card the way
// publishChatMessageChange routes a message change: the default channel's goes
// to its workspace, any other channel's to chat:{room}, and a DM or group's
// also refreshes its members' sidebar preview, once per room within one outbox
// row. The members came with the card, so no query runs here.
func (c *ChatDocumentCardRefresher) publishCard(ctx context.Context, orgID string, card db.ListLiveChatDocumentCardTargetsRow, activitySent map[string]bool) {
	room := db.ChatRoom{
		ID: card.RoomID, Kind: card.RoomKind, IsDefault: card.RoomIsDefault,
		WorkspaceID: card.RoomWorkspaceID, OrganizationID: orgID,
	}
	pub := c.chat.pub
	ev := Event{
		Type:    "chat.message.updated",
		Payload: map[string]string{"room_id": room.ID, "message_id": card.MessageID},
	}
	switch {
	case isWorkspaceDefaultRoom(room):
		pub.Publish(ctx, roomAnchorWorkspaceID(room), ev)
	case room.Kind == chatRoomKindChannel:
		pub.PublishToScope(ctx, ChatScopeType, room.ID, ev)
	default:
		pub.PublishToScope(ctx, ChatScopeType, room.ID, ev)
		if activitySent[room.ID] {
			return
		}
		activitySent[room.ID] = true
		ids := slices.Clone(card.MemberUserIds)
		slices.Sort(ids)
		ids = slices.DeleteFunc(slices.Compact(ids), func(id string) bool { return id == "" })
		pub.SendToUsers(ctx, ids, Event{
			Type:    "chat.room.activity",
			Payload: map[string]string{"room_id": room.ID},
		})
	}
}
