package notification

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// filterDigestRows drops notifications the recipient may no longer see; every
// row in wanted is still marked digested by the caller (UNI-1710).
func (s *DigestScheduler) filterDigestRows(ctx context.Context, userID string, wanted []db.Notification) ([]db.Notification, error) {
	if len(wanted) == 0 || s.members == nil {
		return wanted, nil
	}
	msgIDs := make([]string, 0)
	for _, n := range wanted {
		if n.ResourceType == "chat_message" {
			msgIDs = append(msgIDs, n.ResourceID)
		}
	}
	roomOf := map[string]string{}
	if len(msgIDs) > 0 {
		rows, err := s.q.ListChatMessageRooms(ctx, msgIDs)
		if err != nil {
			return nil, err
		}
		for _, m := range rows {
			roomOf[m.ID] = m.RoomID
		}
	}
	orgOK := map[string]bool{}
	wsOK := map[string]bool{}
	roomOK := map[string]bool{}
	out := make([]db.Notification, 0, len(wanted))
	for _, n := range wanted {
		if n.OrganizationID != "" && s.orgs != nil {
			orgID := n.OrganizationID
			ok, seen := orgOK[orgID]
			if !seen {
				_, err := s.orgs.RequireMember(ctx, orgID, userID)
				if err != nil {
					if refused(err) {
						orgOK[orgID] = false
						continue
					}
					return nil, err
				}
				orgOK[orgID] = true
				ok = true
			}
			if !ok {
				continue
			}
		}
		// Document access is share- or workspace-scoped; the digest build applies
		// the same read gate as Service.List (R1-2), not workspace membership.
		if n.WorkspaceID.Valid && n.ResourceType != "document" && s.members != nil {
			ws := n.WorkspaceID.String
			ok, seen := wsOK[ws]
			if !seen {
				_, err := s.members.RequireMember(ctx, ws, userID)
				if err != nil {
					if refused(err) {
						wsOK[ws] = false
						continue
					}
					return nil, err
				}
				wsOK[ws] = true
				ok = true
			}
			if !ok {
				continue
			}
		}
		if n.ResourceType == "chat_message" {
			roomID := roomOf[n.ResourceID]
			if roomID == "" {
				continue
			}
			ok, seen := roomOK[roomID]
			if !seen {
				_, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
					RoomID: roomID, UserID: userID,
				})
				ok = err == nil
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return nil, err
				}
				roomOK[roomID] = ok
			}
			if !ok {
				continue
			}
		}
		out = append(out, n)
	}
	return out, nil
}
