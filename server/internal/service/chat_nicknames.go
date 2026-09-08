package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const maxChatNicknameLen = 64

func normalizeChatNickname(raw string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
}

// ListChatNicknames returns personal nicknames the caller set for org peers.
func (s *ChatService) ListChatNicknames(
	ctx context.Context, ownerID, workspaceID string,
) (map[string]string, error) {
	w, err := s.workspaceForChat(ctx, ownerID, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListChatUserNicknamesForOwner(ctx, db.ListChatUserNicknamesForOwnerParams{
		OrganizationID: w.OrganizationID,
		OwnerUserID:    ownerID,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, row := range rows {
		nickname := normalizeChatNickname(row.Nickname)
		if nickname == "" {
			continue
		}
		out[row.TargetUserID] = nickname
	}
	return out, nil
}

// SetChatNickname stores a personal nickname for an org peer visible only to the caller.
// An empty nickname removes the alias.
func (s *ChatService) SetChatNickname(
	ctx context.Context, ownerID, workspaceID, targetUserID, nickname string,
) error {
	w, err := s.workspaceForChat(ctx, ownerID, workspaceID)
	if err != nil {
		return err
	}
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" {
		return Invalid("user id không hợp lệ")
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, targetUserID); err != nil {
		return err
	}

	nickname = normalizeChatNickname(nickname)
	if nickname == "" {
		return s.q.DeleteChatUserNickname(ctx, db.DeleteChatUserNicknameParams{
			OrganizationID: w.OrganizationID,
			OwnerUserID:    ownerID,
			TargetUserID:   targetUserID,
		})
	}
	if utf8.RuneCountInString(nickname) > maxChatNicknameLen {
		return Invalid("biệt danh quá dài")
	}
	_, err = s.q.UpsertChatUserNickname(ctx, db.UpsertChatUserNicknameParams{
		ID:             util.NewID(),
		OrganizationID: w.OrganizationID,
		OwnerUserID:    ownerID,
		TargetUserID:   targetUserID,
		Nickname:       nickname,
	})
	return err
}
