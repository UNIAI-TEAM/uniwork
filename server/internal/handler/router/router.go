package router

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Deps is the subset of handler.Deps the mux needs: middleware, CORS,
// swagger, and local-file serving. HTTP funcs arrive separately in Routes.
type Deps struct {
	Cfg         config.Config
	Minter      auth.TokenMinter
	Redis       *redis.Client
	Storage     storage.Storage
	HTTPMetrics *metrics.HTTPMetrics
	// PlatformRoles resolves users.platform_role for /api/v1/admin; nil
	// (tests without an admin service) makes every admin route 404.
	PlatformRoles mw.PlatformRoleSource
	// FeatureFlags feeds GET /api/v1/config and other flag readers; nil
	// evaluates every catalogue key at its declared default.
	FeatureFlags *featureflag.Service
	DeviceStatus func(context.Context, string, string) error
	// OfficeFrameAuth checks the Office Docs frame token on
	// /api/v1/office-frame/*; nil refuses every frame route with 404.
	OfficeFrameAuth func(http.Handler) http.Handler
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
	// The server span comes first so every middleware below, the access log
	// and the audit row share one trace id (X-Trace-Id).
	r.Use(telemetry.HTTP)
	r.Use(chimw.RequestID)
	// Correlation before the logger so every access-log line carries the id
	// the audit rows of that request will carry.
	r.Use(mw.Correlation(proxies))
	r.Use(mw.ClientMetadata)
	r.Use(mw.RequestLogger)
	r.Use(chimw.Recoverer)
	r.Use(mw.IdempotencyKeyFormat)
	r.Use(mw.ContentSecurityPolicy)
	if d.HTTPMetrics != nil {
		r.Use(d.HTTPMetrics.Middleware)
	}
	if d.Redis != nil {
		// Probes skip it: kubelet gives up after its timeout, and a liveness
		// probe stuck behind a stalled Redis call gets a healthy pod killed.
		// The LiveKit webhook skips it too: every event arrives from the one
		// LiveKit address, so a platform-wide join burst spent that address's
		// budget and LiveKit dropped the refused events. The route checks the
		// webhook signature and the network policy admits only LiveKit.
		global := mw.RateLimitByIdentity(d.Redis, 300, time.Minute, proxies, bearerUser(d.Minter))
		r.Use(mw.ExceptPaths(global, "/healthz", "/readyz", "/api/v1"+liveKitWebhookPath, "/api/v1"+vnpayBillingWebhookPath))
	}
	credentialLimit := mw.RateLimit(d.Redis, 60, time.Minute, proxies)
	// In-room limiters budget per verified person, not per address: a formal
	// meeting often sits behind one office NAT. They run after OptionalAuth.
	inRoom := meetingCaller([]byte(d.Cfg.JWTSecret))
	joinLimit := mw.RateLimitByIdentity(d.Redis, 120, time.Minute, proxies, inRoom)
	lobbyWSLimit := mw.RateLimitByIdentity(d.Redis, 30, time.Minute, proxies, inRoom)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{d.Cfg.FrontendOrigin},
		AllowedMethods: []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		// Idempotency-Key / If-Match are sent by create and suite mutations from
		// the browser; omitting them fails the CORS preflight and the fetch never
		// leaves the page (create-task E2E hangs on waitForResponse).
		AllowedHeaders: []string{
			"Authorization",
			"Content-Type",
			"Idempotency-Key",
			"If-Match",
			mw.CorrelationHeader,
			telemetry.DebugTraceHeader,
			meetings.GuestSessionHeader,
			// Vendor headers the BYOK proxy forwards (provider/byok_client.go); a
			// browser caller needs them in the preflight or the fetch never leaves.
			"Anthropic-Beta",
			"Openai-Organization",
			"Openai-Project",
			"Http-Referer",
			"X-Title",
		},
		ExposedHeaders:   []string{mw.CorrelationHeader, telemetry.TraceHeader, "Retry-After"},
		AllowCredentials: true,
	}))
	cat := &apiCatalog{}
	root := newAPI(r, cat)
	registerMeta(root, r, d.Storage, h)
	root.Route("/api/v1", func(v1 api) {
		v1.r.Get("/ws", h.WS) // WebSocket — off the OpenAPI spec
		registerAuth(v1, h, credentialLimit)
		registerBillingWebhooks(v1, h)
		v1.Group(func(desktop api) {
			if d.DeviceStatus != nil {
				desktop.Use(mw.RequireAuthWithDevice(d.Minter, d.DeviceStatus))
			} else {
				desktop.Use(mw.RequireAuth(d.Minter))
			}
			registerDesktopAuth(desktop, h)
		})
		v1.Group(func(pub api) {
			pub.Use(mw.OptionalAuth(d.Minter))
			registerPublicMeetings(pub, h, credentialLimit, joinLimit, lobbyWSLimit)
			registerConfig(pub, h, mw.RateLimit(d.Redis, 60, time.Minute, proxies))
			registerFileContent(pub, h)
			registerPublicDocuments(pub, h, mw.RateLimit(d.Redis, 60, time.Minute, proxies))
		})
		// Preview asset bytes are intentionally outside the app-authenticated
		// group: the frame is credentialless and presents only its opaque scope.
		registerPreview(v1, h)
		// The Docs frame presents only its document-bound frame token.
		registerOfficeFrame(v1, h, d.FeatureFlags, d.OfficeFrameAuth)
		registerOfficeFrameExport(v1, h, d.FeatureFlags, d.OfficeFrameAuth,
			mw.RateLimitByIdentityBucket(d.Redis, "office-frame-export", 20, time.Minute, proxies, frameUser))
		// GO-A7's AI on the frame token: the same per-person buckets as the
		// session routes, so a frame and a host tab share one budget.
		registerOfficeFrameAI(v1, h, d.FeatureFlags, d.OfficeFrameAuth, officeFrameAILimits{
			credentials: mw.RateLimitByIdentityBucket(d.Redis, "ai-credentials", 30, time.Minute, proxies, frameUser),
			byok:        mw.RateLimitByIdentityBucket(d.Redis, "ai-byok", 60, time.Minute, proxies, frameUser),
			cloud:       mw.RateLimitByIdentityBucket(d.Redis, "ai-cloud", 20, time.Minute, proxies, frameUser),
		})
		v1.Group(func(authed api) {
			if d.DeviceStatus != nil {
				authed.Use(mw.RequireAuthWithDevice(d.Minter, d.DeviceStatus))
			} else {
				authed.Use(mw.RequireAuth(d.Minter))
			}
			registerMe(authed, h, credentialLimit)
			registerOrganizations(authed, h)
			registerPeople(authed, h)
			registerDepartments(authed, h)
			registerWorkspaces(authed, h)
			registerAgents(authed, h)
			registerBilling(authed, h)
			registerNotifications(authed, h)
			registerAI(authed, h)
			registerAIBYOK(authed, h, mw.RateLimitByIdentityBucket(d.Redis, "ai-byok", 60, time.Minute, proxies, bearerUser(d.Minter)))
			registerAICloud(authed, h, mw.RateLimitByIdentityBucket(d.Redis, "ai-cloud", 20, time.Minute, proxies, bearerUser(d.Minter)))
			registerOnboarding(authed, h)
			registerTasks(authed, h)
			registerTasksSuite(authed, h)
			registerHome(authed, h)
			registerCalendar(authed, h)
			registerEmailHub(authed, h)
			registerAudit(authed, h)
			registerGraph(authed, h)
			registerMeetings(authed, h)
			chatWriteLimit := mw.RateLimit(d.Redis, 120, time.Minute, proxies)
			// Presence beats from every shell page and typing: per signed-in
			// person, so an office NAT does not pool everyone's budget.
			chatTypingLimit := mw.RateLimitByIdentity(d.Redis, 30, time.Minute, proxies, bearerUser(d.Minter))
			registerChat(authed, h, chatWriteLimit, chatTypingLimit)
			registerChatChannels(authed, h, chatWriteLimit)
			registerChatThreads(authed, h, chatWriteLimit)
			registerChatLinks(authed, h, chatWriteLimit)
			registerChatFollowUps(authed, h, chatWriteLimit)
			registerFiles(authed, h)
			registerDocuments(authed, h, d.FeatureFlags)
			registerSignatures(authed, h)
			// Personal AI keys: per signed-in person across the whole group, 30/min (ADR 0029).
			registerAICredentials(authed, h, mw.RateLimitByIdentityBucket(d.Redis, "ai-credentials", 30, time.Minute, proxies, bearerUser(d.Minter)))
			registerOfficeLaunch(authed, h)
			registerOfficeFrameToken(authed, h, d.FeatureFlags)
			registerOfficeDesktopDownload(authed, h, mw.RateLimit(d.Redis, 10, time.Minute, proxies))
			if d.PlatformRoles != nil {
				adminLimit := mw.RateLimit(d.Redis, d.Cfg.AdminRateLimitPerMin, time.Minute, proxies)
				registerAdmin(authed, h, adminLimit,
					mw.RequirePlatformRole(d.PlatformRoles, "support"),
					mw.RequirePlatformRole(d.PlatformRoles, "admin"))
			}
		})
	})
	if d.Cfg.EnableSwagger {
		mountSwagger(r, cat)
	}
	return r
}

// bearerUser names the user of a valid access token for the global limiter,
// which runs before any auth middleware and so checks the signature itself.
// It names nobody else: a guest session costs one anonymous request to mint,
// so guests stay on their address there and that budget is the per-address
// ceiling a stream of fresh guest sessions cannot get past.
func bearerUser(m auth.TokenMinter) mw.IdentityFunc {
	return func(r *http.Request) string {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			return ""
		}
		uid, err := m.Parse(token)
		if err != nil {
			return ""
		}
		return "user:" + uid
	}
}

// meetingCaller names the caller of an in-room route: the user OptionalAuth
// verified, else the guest whose session carries a valid signature (guestKey
// is the key the meeting service signs uw_guest with). An unsigned or
// tampered session names nobody and the request keeps its address's budget.
func meetingCaller(guestKey []byte) mw.IdentityFunc {
	return func(r *http.Request) string {
		if uid := mw.UserID(r.Context()); uid != "" {
			return "user:" + uid
		}
		if gid := meetings.GuestIDFromRequest(r, guestKey); gid != "" {
			return "guest:" + gid
		}
		return ""
	}
}
