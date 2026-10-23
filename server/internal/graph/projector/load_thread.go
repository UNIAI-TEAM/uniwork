package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadThread projects a chat room. DMs are never nodes (spec §4.1); an
// archived channel is deleted. A public channel or the workspace room is
// readable by the workspace; a private channel or a group by its active
// members only (spec §4.4).
func loadThread(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	r, err := q.GraphSourceChatRoom(ctx, db.GraphSourceChatRoomParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if r.Kind == "dm" || r.ArchivedAt.Valid {
		return Desired{}, nil
	}
	n := &NodeState{
		Ref: NodeRef{Type: graph.NodeThread, SourceID: r.ID}, WorkspaceID: textOf(r.WorkspaceID),
		Subtype: graph.SubtypeChatRoom, Title: r.Name, Status: "active", Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(r.CreatedAt), SourceUpdatedAt: timeOf(r.UpdatedAt),
	}
	if !(r.Kind == "workspace" || (r.Kind == "channel" && r.Visibility == "public")) {
		members, err := q.GraphSourceChatRoomMembers(ctx, db.GraphSourceChatRoomMembersParams{OrganizationID: org, RoomID: r.ID})
		if err != nil {
			return Desired{}, err
		}
		n.Visibility = graph.VisMembers
		n.ReaderIDs = members
	}
	return Desired{Node: n}, nil
}
