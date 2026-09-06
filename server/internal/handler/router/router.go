package router

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// Deps is the subset of handler.Deps the mux needs: middleware, CORS,
// swagger, and local-file serving. HTTP funcs arrive separately in Routes.
type Deps struct {
	Cfg         config.Config
	Minter      auth.TokenMinter
	Redis       *redis.Client
	Storage     storage.Storage
	HTTPMetrics *metrics.HTTPMetrics
}

// New wires middleware and registers routes by OpenAPI tag (auth.go, me.go, …).
func New(d Deps, h Routes) http.Handler {
	r := chi.NewRouter()
	// Order matters: RequestID first so every later middleware and the access
	// log see it; ClientMetadata before RequestLogger so the log line carries
	// the client dimensions; Recoverer inside the logger so a panic still
	// produces an access-log entry with its status.
	//
	// Nothing here rewrites r.RemoteAddr from X-Forwarded-For (chi's RealIP
	// does, unconditionally, which lets any client pick its own rate-limit
	// bucket with one header). Each consumer that needs the client address —
	// the rate limiter, the WebSocket origin check — applies TRUSTED_PROXIES
	// itself. handler/router_test.go pins this.
	proxies := mw.ParseTrustedProxies(d.Cfg.TrustedProxies)
	r.Use(chimw.RequestID)
	// Correlation before the logger so every access-log line carries the id
	// the audit rows of that request will carry.
	r.Use(mw.Correlation(proxies))
	r.Use(mw.ClientMetadata)
	r.Use(mw.RequestLogger)
	r.Use(chimw.Recoverer)
	r.Use(mw.ContentSecurityPolicy)
	if d.HTTPMetrics != nil {
		r.Use(d.HTTPMetrics.Middleware)
	}
	if d.Redis != nil {
		r.Use(mw.RateLimit(d.Redis, 300, time.Minute, proxies))
	}
	credentialLimit := mw.RateLimit(d.Redis, 60, time.Minute, proxies)
	joinLimit := mw.RateLimit(d.Redis, 120, time.Minute, proxies)
	lobbyWSLimit := mw.RateLimit(d.Redis, 30, time.Minute, proxies)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{d.Cfg.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", mw.CorrelationHeader},
		ExposedHeaders:   []string{mw.CorrelationHeader},
		AllowCredentials: true,
	}))
	cat := &apiCatalog{}
	root := newAPI(r, cat)
	registerMeta(root, r, d.Storage, h)
	root.Route("/api/v1", func(v1 api) {
		v1.r.Get("/ws", h.WS) // WebSocket — off the OpenAPI spec
		registerAuth(v1, h, credentialLimit)
		v1.Group(func(pub api) {
			pub.Use(mw.OptionalAuth(d.Minter))
			registerPublicMeetings(pub, h, credentialLimit, joinLimit, lobbyWSLimit)
		})
		v1.Group(func(authed api) {
			authed.Use(mw.RequireAuth(d.Minter))
			registerMe(authed, h, credentialLimit)
			registerOrganizations(authed, h)
			registerWorkspaces(authed, h)
			registerAgents(authed, h)
			registerBilling(authed, h)
			registerOnboarding(authed, h)
			registerTasks(authed, h)
			registerAudit(authed, h)
			registerMeetings(authed, h)
			chatWriteLimit := mw.RateLimit(d.Redis, 120, time.Minute, proxies)
			chatTypingLimit := mw.RateLimit(d.Redis, 30, time.Minute, proxies)
			registerChat(authed, h, chatWriteLimit, chatTypingLimit)
		})
	})
	if d.Cfg.EnableSwagger {
		mountSwagger(r, cat)
	}
	return r
}
