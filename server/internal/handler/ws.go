package handler

import (
	"context"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// workspaceMembership adapts the workspace service to the hub's
// MembershipChecker so the hub never sees the service layer.
type workspaceMembership struct{ ws *service.WorkspaceService }

func (m workspaceMembership) IsMember(ctx context.Context, userID, workspaceID string) bool {
	_, err := m.ws.RequireMember(ctx, workspaceID, userID)
	return err == nil
}

// GET /api/v1/ws?workspace_id=…
//
// Authentication is either the transitional ?token= query parameter (what the
// current web client sends) or an `auth` frame as the first message (what the
// ported ws-client.ts sends). Membership is checked on every connect.
func (h *handlers) ws(w http.ResponseWriter, r *http.Request) {
	realtime.HandleWebSocket(h.Hub, workspaceMembership{h.Workspaces}, h.Minter.Parse, nil, w, r)
}
