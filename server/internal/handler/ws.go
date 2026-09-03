package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

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

// meetingLobbyAuth adapts MeetingService for public lobby WebSocket connects.
type meetingLobbyAuth struct {
	ms *service.MeetingService
}

func (a meetingLobbyAuth) AllowLobbyListen(ctx context.Context, meetingID, userID, guestID string) (bool, error) {
	return a.ms.AllowLobbyListen(ctx, meetingID, userID, guestID)
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

// GET /api/v1/ws?workspace_slug={orgSlug}/{workspaceSlug}  (or ?workspace_id=…)
//
// The client authenticates with an `auth` frame as its first message — the
// token never travels in the URL. Workspace slugs are unique only within an
// organization, so the slug form is the pair. Membership is checked on every
// connect, after the workspace is resolved.
func (h *handlers) ws(w http.ResponseWriter, r *http.Request) {
	resolve := func(ctx context.Context, composite string) (string, error) {
		org, ws, ok := strings.Cut(composite, "/")
		if !ok || org == "" || ws == "" {
			return "", service.ErrNotFound
		}
		return h.Workspaces.ResolveSlugs(ctx, org, ws)
	}
	realtime.HandleWebSocket(h.Hub, workspaceMembership{ws: h.Workspaces, cache: h.MembershipCache}, h.Minter.Parse, resolve, w, r)
}

// GET /api/v1/meetings/{meetingID}/lobby-ws
func (h *handlers) meetingLobbyWS(w http.ResponseWriter, r *http.Request) {
	meetingID := chi.URLParam(r, "meetingID")
	realtime.HandleMeetingLobbyWebSocket(
		h.Hub,
		meetingLobbyAuth{ms: h.Meetings},
		h.Minter.Parse,
		h.Meetings.GuestHMACKey(),
		meetingID,
		w,
		r,
	)
}
