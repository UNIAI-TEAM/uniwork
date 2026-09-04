package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatBlockStatus is the block relationship between the caller and a peer.
type ChatBlockStatus struct {
	BlockedByMe bool
	BlockedMe   bool
}

func errChatUserBlocked() error {
	return coded(http.StatusForbidden, "chat_user_blocked", "Không thể gửi tin nhắn tới người này")
}

func dmPeerUserID(room db.ChatRoom, userID string) (string, error) {
	if room.Kind != chatRoomKindDM || !room.MemberSetKey.Valid {
		return "", ErrNotFound
	}
	peerID := peerUserIDFromMemberSet(room.MemberSetKey.String, userID)
	if peerID == "" {
		return "", ErrNotFound
	}
	return peerID, nil
}

func (s *ChatService) dmMessagingBlocked(ctx context.Context, orgID, userID, peerID string) (bool, error) {
	if orgID == "" || userID == "" || peerID == "" {
		return false, nil
	}
	return s.q.HasChatBlockBetween(ctx, db.HasChatBlockBetweenParams{
		OrganizationID: orgID,
		BlockerID:      userID,
		BlockedID:      peerID,
	})
}

func (s *ChatService) GetChatBlockStatus(
	ctx context.Context, callerID, workspaceID, targetUserID string,
) (ChatBlockStatus, error) {
	w, err := s.workspaceForChat(ctx, callerID, workspaceID)
	if err != nil {
		return ChatBlockStatus{}, err
	}
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" || targetUserID == callerID {
		return ChatBlockStatus{}, Invalid("user id không hợp lệ")
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, targetUserID); err != nil {
		return ChatBlockStatus{}, err
	}
	out := ChatBlockStatus{}
	if _, err := s.q.GetChatBlock(ctx, db.GetChatBlockParams{
		OrganizationID: w.OrganizationID, BlockerID: callerID, BlockedID: targetUserID,
	}); err == nil {
		out.BlockedByMe = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatBlockStatus{}, err
	}
	if _, err := s.q.GetChatBlock(ctx, db.GetChatBlockParams{
		OrganizationID: w.OrganizationID, BlockerID: targetUserID, BlockedID: callerID,
	}); err == nil {
		out.BlockedMe = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatBlockStatus{}, err
	}
	return out, nil
}

// BlockChatUser prevents DM messaging between the caller and target within the org.
func (s *ChatService) BlockChatUser(ctx context.Context, blockerID, workspaceID, targetUserID string) error {
	w, err := s.workspaceForChat(ctx, blockerID, workspaceID)
	if err != nil {
		return err
	}
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" || targetUserID == blockerID {
		return Invalid("user id không hợp lệ")
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, targetUserID); err != nil {
		return err
	}
	_, err = s.q.InsertChatBlock(ctx, db.InsertChatBlockParams{
		ID:             util.NewID(),
		OrganizationID: w.OrganizationID,
		BlockerID:      blockerID,
		BlockedID:      targetUserID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err != nil {
		if _, getErr := s.q.GetChatBlock(ctx, db.GetChatBlockParams{
			OrganizationID: w.OrganizationID, BlockerID: blockerID, BlockedID: targetUserID,
		}); getErr != nil {
			return getErr
		}
	}
	s.hideDMWithPeer(ctx, blockerID, w.OrganizationID, workspaceID, targetUserID)
	return nil
}

// UnblockChatUser removes a block the caller placed on a peer.
func (s *ChatService) UnblockChatUser(ctx context.Context, blockerID, workspaceID, targetUserID string) error {
	w, err := s.workspaceForChat(ctx, blockerID, workspaceID)
	if err != nil {
		return err
	}
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" || targetUserID == blockerID {
		return Invalid("user id không hợp lệ")
	}
	return s.q.DeleteChatBlock(ctx, db.DeleteChatBlockParams{
		OrganizationID: w.OrganizationID,
		BlockerID:      blockerID,
		BlockedID:      targetUserID,
	})
}

func (s *ChatService) hideDMWithPeer(ctx context.Context, userID, orgID, workspaceID, peerID string) {
	key := memberSetKey([]string{userID, peerID})
	room, err := s.q.GetChatRoomByKindAndMemberSet(ctx, db.GetChatRoomByKindAndMemberSetParams{
		OrganizationID: pgtype.Text{String: orgID, Valid: true},
		Kind:           chatRoomKindDM,
		MemberSetKey:   pgtype.Text{String: key, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		return
	}
	_ = s.q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	})
}
