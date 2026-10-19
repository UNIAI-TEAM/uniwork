package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func insertChatRoomMembers(ctx context.Context, q *db.Queries, room db.ChatRoom, anchorWorkspaceID, creatorID string, memberIDs []string) error {
	ids := uniqueUserIDs(memberIDs)
	if len(ids) == 0 {
		return nil
	}
	in := db.InsertChatRoomMembersParams{
		WorkspaceID: anchorWorkspaceID, OrganizationID: room.OrganizationID,
	}
	for _, id := range ids {
		role := "member"
		if id == creatorID {
			role = "admin"
		}
		in.Ids = append(in.Ids, util.NewID())
		in.RoomIds = append(in.RoomIds, room.ID)
		in.UserIds = append(in.UserIds, id)
		in.Roles = append(in.Roles, role)
	}
	return q.InsertChatRoomMembers(ctx, in)
}
