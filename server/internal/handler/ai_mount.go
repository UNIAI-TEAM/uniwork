package handler

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// AIActorResolver names who is calling an AI route and for which organization.
// The BYOK proxy and cloud handlers read nothing else from the request, so a
// router group with another credential (the web Office frame's frame token)
// mounts the same handlers by passing its own resolver. A resolver only
// identifies: membership, entitlement and credits are still decided by the
// services the handlers call.
type AIActorResolver func(r *http.Request) (userID, orgID string, err error)

// sessionAIActor is the default resolver: the user the auth middleware put in
// the context (web session or desktop bearer) and the {orgID} path parameter.
func sessionAIActor(r *http.Request) (string, string, error) {
	userID := middleware.UserID(r.Context())
	if userID == "" {
		return "", "", errAIActorMissing
	}
	return userID, chi.URLParam(r, "orgID"), nil
}

var errAIActorMissing = errors.New("ai: no authenticated user")

// AIMountable is the AI handler set for a router group to mount under its own
// paths. The handlers need the same path-parameter names as the session
// routes for what is not the actor: {aiProvider} on the BYOK routes.
type AIMountable struct {
	ByokChatCompletions http.HandlerFunc
	ByokMessages        http.HandlerFunc
	ByokGenerate        http.HandlerFunc
	ByokModels          http.HandlerFunc
	CloudStatus         http.HandlerFunc
	CloudSearch         http.HandlerFunc
	CloudImages         http.HandlerFunc
	CloudAnalyzeMedia   http.HandlerFunc
	CloudTranscribe     http.HandlerFunc
}

// NewAIMountable returns the AI handlers of d acting for whoever resolve
// names. Rate limiting and auth stay with the route group that mounts them.
func NewAIMountable(d Deps, resolve AIActorResolver) AIMountable {
	h := &handlers{Deps: d, proxies: middleware.ParseTrustedProxies(d.Cfg.TrustedProxies)}
	return h.aiMountable(resolve)
}

func (h *handlers) aiMountable(resolve AIActorResolver) AIMountable {
	a := &aiHandlers{handlers: h, actor: resolve}
	return AIMountable{
		ByokChatCompletions: a.byokProxy(ai.ProxyChatCompletions),
		ByokMessages:        a.byokProxy(ai.ProxyMessages),
		ByokGenerate:        a.byokProxy(ai.ProxyGenerate),
		ByokModels:          a.byokProxy(ai.ProxyModels),
		CloudStatus:         a.aiCloudStatus,
		CloudSearch:         a.aiCloudSearch,
		CloudImages:         a.aiCloudImages,
		CloudAnalyzeMedia:   a.aiCloudAnalyzeMedia,
		CloudTranscribe:     a.aiCloudTranscribe,
	}
}

// aiHandlers are the BYOK proxy and cloud handlers bound to one resolver.
type aiHandlers struct {
	*handlers
	actor AIActorResolver
}

// resolve answers the request itself and returns false when the actor cannot
// be named: 404/403 pass through as the service would answer them, anything
// else is 401.
func (h *aiHandlers) resolve(w http.ResponseWriter, r *http.Request) (userID, orgID string, ok bool) {
	userID, orgID, err := h.actor(r)
	if err == nil && (userID == "" || orgID == "") {
		err = errAIActorMissing
	}
	switch {
	case err == nil:
		return userID, orgID, true
	case errors.Is(err, service.ErrNotFound), errors.Is(err, service.ErrForbidden):
		h.mapServiceError(w, err)
	default:
		// Error class only: the text of a resolver error may carry token detail.
		h.Log.Debug("ai: actor not resolved", "err_type", fmt.Sprintf("%T", err))
		respondError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
	}
	return "", "", false
}
