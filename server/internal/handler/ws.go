package handler

import (
	"context"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// workspaceMembership adapts the workspace service to the hub's
// MembershipChecker so the hub never sees the service layer.
type workspaceMembership struct {
	ws    *service.WorkspaceService
	cache *auth.MembershipCache // nil without Redis
}

// IsMember answers from the Redis cache when it can. Only positive answers
// are cached (a denial must re-check so a freshly accepted invite works
// immediately), and the TTL bounds how long a removed member keeps a live
// socket — there is no explicit invalidation path yet because there is no
// remove-member operation yet.
func (m workspaceMembership) IsMember(ctx context.Context, userID, workspaceID string) bool {
	if m.cache != nil && m.cache.Get(ctx, userID, workspaceID) {
		return true
	}
	if _, err := m.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return false
	}
	if m.cache != nil {
		m.cache.Set(ctx, userID, workspaceID)
	}
	return true
}

// GET /api/v1/ws?workspace_id=…
//
// Authentication is either the transitional ?token= query parameter (what the
// current web client sends) or an `auth` frame as the first message (what the
// ported ws-client.ts sends). Membership is checked on every connect.
func (h *handlers) ws(w http.ResponseWriter, r *http.Request) {
	realtime.HandleWebSocket(h.Hub, workspaceMembership{ws: h.Workspaces, cache: h.MembershipCache}, h.Minter.Parse, nil, w, r)
}
