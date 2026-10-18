package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatUnreadTotals is what a set of rooms adds to a badge, by the rule of the
// sidebar's Chat badge: every unread message, but only the mentions of a room
// the reader muted. Mentions counts every unread mention, muted or not.
type ChatUnreadTotals struct {
	Unread   int
	Mentions int
}

func (t *ChatUnreadTotals) add(unread, mentions int, muted bool) {
	if muted {
		unread = mentions
	}
	t.Unread += unread
	t.Mentions += mentions
}

// ChatWorkspaceUnread is one workspace's channels.
type ChatWorkspaceUnread struct {
	WorkspaceID string
	ChatUnreadTotals
}

// ChatUnreadSummary is the caller's chat badges across every workspace they
// can open, for the workspace switcher.
type ChatUnreadSummary struct {
	// Direct is dms and groups: they belong to the organization and show in
	// every one of its workspaces, so they are counted once, here.
	Direct     ChatUnreadTotals
	Workspaces []ChatWorkspaceUnread
}

// UnreadSummary totals the same rows ListChatRooms reads, per workspace for
// channels and once per organization for dms and groups. Every workspace goes
// through RequireMember: one it refuses (a deactivated member, a suspended
// organization) is left out, and so are its organization's dms and groups
// unless another of its workspaces admits the caller.
func (s *ChatService) UnreadSummary(ctx context.Context, userID string) (ChatUnreadSummary, error) {
	workspaces, err := s.q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return ChatUnreadSummary{}, err
	}
	out := ChatUnreadSummary{Workspaces: make([]ChatWorkspaceUnread, 0, len(workspaces))}
	directCounted := map[string]bool{}
	for _, w := range workspaces {
		m, err := s.ws.RequireMember(ctx, w.ID, userID)
		if refusedByGate(err) {
			continue
		}
		if err != nil {
			return ChatUnreadSummary{}, err
		}
		channels, err := s.q.ListChatChannelsMine(ctx, db.ListChatChannelsMineParams{
			UserID: userID, WorkspaceID: pgtype.Text{String: w.ID, Valid: true},
		})
		if err != nil {
			return ChatUnreadSummary{}, err
		}
		ws := ChatWorkspaceUnread{WorkspaceID: w.ID}
		for _, c := range channels {
			ws.add(int(c.UnreadCount), int(c.MentionUnreadCount), c.NotificationsMuted)
		}
		out.Workspaces = append(out.Workspaces, ws)

		if directCounted[m.OrganizationID] {
			continue
		}
		directCounted[m.OrganizationID] = true
		direct, err := s.directRooms(ctx, userID, m.OrganizationID, w.ID)
		if err != nil {
			return ChatUnreadSummary{}, err
		}
		for _, r := range direct {
			out.Direct.add(r.UnreadCount, r.MentionUnreadCount, r.NotificationsMuted)
		}
	}
	return out, nil
}
