package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// MembershipInvalidator drops cached "is a member" answers the socket
// handshake reads (auth.MembershipCache).
type MembershipInvalidator interface {
	Invalidate(ctx context.Context, userID, workspaceID string)
	InvalidateUser(ctx context.Context, userID string)
}

// AccessRevoker takes back realtime access once a command that ended it has
// committed: a socket is checked only when it connects or subscribes, so
// without it a removed member, a kicked one or a revoked session keeps
// listening until the socket drops on its own.
//
// shortcut: it acts on this node's hub only, and the outbox hands each row to
// one node; with more than one API replica the revocation must fan out too
// (the relay, or a consumer per node).
type AccessRevoker struct {
	hub     *Hub
	members MembershipInvalidator
	// grace delays a membership disconnect: the same row reaches the
	// member's own tabs on their user scope (they switch to the blocked
	// screen), and that frame must not lose the race with the close.
	grace time.Duration
}

// NewAccessRevoker returns the consumer; members may be nil (no Redis).
func NewAccessRevoker(hub *Hub, members MembershipInvalidator) *AccessRevoker {
	return &AccessRevoker{hub: hub, members: members, grace: 2 * time.Second}
}

func (a *AccessRevoker) disconnectLater(userID, workspaceID string) {
	time.AfterFunc(a.grace, func() { a.hub.DisconnectUser(userID, workspaceID) })
}

func (*AccessRevoker) Name() string { return "realtime_access_revoker" }

func (*AccessRevoker) Topics() []string {
	return []string{"member.removed", "member.deactivated", "member.left", "chat.room.member_removed", "session.revoked", "organization.suspended"}
}

func (a *AccessRevoker) Handle(ctx context.Context, ev outbox.Row) error {
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("realtime_access_revoker: payload of %s: %w", ev.ID, err)
	}
	if ev.Topic == "organization.suspended" {
		// One row per owner/admin names that user, but the suspension ends
		// every member's access. The cache has no per-organization index, so
		// only the memberships of sockets closed here are dropped; a member
		// with none open may reconnect on a cached yes until its TTL.
		orgID := p["organization_id"]
		time.AfterFunc(a.grace, func() {
			for _, c := range a.hub.DisconnectOrganization(orgID) {
				if a.members != nil {
					a.members.Invalidate(context.Background(), c.userID, c.workspaceID)
				}
			}
		})
		return nil
	}
	userID := p["user_id"]
	if userID == "" {
		return nil
	}
	switch ev.Topic {
	case "member.removed":
		if a.members != nil {
			a.members.Invalidate(ctx, userID, p["workspace_id"])
		}
		a.disconnectLater(userID, p["workspace_id"])
	case "member.deactivated", "member.left":
		// Every workspace of the organization is gone; sockets the user has
		// open elsewhere reconnect through the membership check.
		if a.members != nil {
			a.members.InvalidateUser(ctx, userID)
		}
		a.disconnectLater(userID, "")
	case "chat.room.member_removed":
		a.hub.RevokeScope(userID, ScopeChat, p["room_id"])
	case "session.revoked":
		a.hub.DisconnectSession(userID, p["session_id"])
	}
	return nil
}
