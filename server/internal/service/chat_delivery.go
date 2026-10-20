package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// MaxChatDeliveredAcks caps one delivery ack: a device acks the rooms it
// heard from in the last second or saw in its room list, in batches.
const MaxChatDeliveredAcks = 50

// ChatDeliveredAck says the caller's device holds a room's messages up to UpTo.
type ChatDeliveredAck struct {
	RoomID string
	UpTo   time.Time
}

// AckChatDelivered moves the caller's delivered cursor (✓✓ grey, UNI-1908
// F4) in each named room they are a member of: forward only, never past now.
// A room they are not in is skipped without saying so, so the answer is the
// same whether it exists or not. Like a read it is a cursor, not business
// state, so no audit row; the sockets holding a moved room open hear
// chat.room.member_delivered and refetch its member list, as for a read.
func (s *ChatService) AckChatDelivered(ctx context.Context, userID, workspaceID string, acks []ChatDeliveredAck) error {
	if len(acks) > MaxChatDeliveredAcks {
		return Invalid(fmt.Sprintf("tối đa %d phòng mỗi lần", MaxChatDeliveredAcks))
	}
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return err
	}
	// One entry per room, the furthest: UPDATE … FROM applies one of several
	// matches for a row, not the largest.
	furthest := make(map[string]time.Time, len(acks))
	for _, ack := range acks {
		if prev, ok := furthest[ack.RoomID]; ack.RoomID != "" && (!ok || ack.UpTo.After(prev)) {
			furthest[ack.RoomID] = ack.UpTo
		}
	}
	if len(furthest) == 0 {
		return nil
	}
	params := db.AdvanceChatRoomMembersDeliveredParams{UserID: userID, OrganizationID: w.OrganizationID}
	for roomID, at := range furthest {
		params.RoomIds = append(params.RoomIds, roomID)
		params.UpTos = append(params.UpTos, pgtype.Timestamptz{Time: at, Valid: true})
	}
	moved, err := s.q.AdvanceChatRoomMembersDelivered(ctx, params)
	if err != nil {
		return err
	}
	for _, room := range moved {
		// The default channel's members are the workspace: as with a read,
		// nobody counts its receipts, so it fans out to no one.
		if room.Kind != chatRoomKindDM && room.Kind != chatRoomKindGroup && (room.Kind != chatRoomKindChannel || room.IsDefault) {
			continue
		}
		s.publishChatRoomEvent(ctx, room.RoomID, Event{
			Type:    "chat.room.member_delivered",
			Payload: map[string]string{"room_id": room.RoomID, "user_id": userID},
		})
	}
	return nil
}
