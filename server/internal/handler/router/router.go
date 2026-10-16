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

	"github.com/unicomhub/uniwork/server/internal/ai"
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
	// DocumentOrganization names the organization an authenticated document
	// route acts in (one the caller is a member of), so the `documents` flag
	// honours organization overrides; nil evaluates it per user.
	DocumentOrganization func(*http.Request) string
	DeviceStatus         func(context.Context, string, string) error
	// OfficeFrameAuth checks the Office Docs frame token on
	// /api/v1/office-frame/*; nil refuses every frame route with 404.
	OfficeFrameAuth func(http.Handler) http.Handler
	// FrameIdentity names the person behind a frame token for the global rate
	// limiter (G6-03b, design §5.3): the limiter runs before routing, so it
	// verifies the token itself. Nil keeps today's behaviour (a frame request
	// keys by address).
	FrameIdentity mw.IdentityFunc
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
		// /mcp skips it as well: this limiter names only session JWTs and frame
		// grants, so an MCP access token falls back to the client address, and
		// every team behind one AI vendor's egress address would share 300 a
		// minute. /mcp has its own per-token budget (registerMCP).
		// Native refresh skips it for the same reason: phones behind one
		// carrier address would share 300 a minute; it has its own
		// per-device budget under an address ceiling (refreshLimit).
		global := mw.RateLimitByIdentity(d.Redis, 300, time.Minute, proxies, globalIdentity(d.Minter, d.FrameIdentity))
		r.Use(mw.ExceptPaths(global, "/healthz", "/readyz", "/mcp", "/api/v1/auth/desktop/refresh", "/api/v1"+liveKitWebhookPath, "/api/v1"+vnpayBillingWebhookPath))
	}
	credentialLimit := mw.RateLimit(d.Redis, 60, time.Minute, proxies)
	// Native refresh: per device (desktopDevice) under a ceiling per address;
	// the ceiling runs first so a request it refuses opens no device counter.
	refreshCeiling := mw.RateLimitByIdentityBucket(d.Redis, "desktop-refresh-ip", 600, time.Minute, proxies, nil)
	refreshPerDevice := mw.RateLimitByIdentityBucket(d.Redis, "desktop-refresh", 60, time.Minute, proxies, desktopDevice)
	refreshLimit := func(next http.Handler) http.Handler { return refreshCeiling(refreshPerDevice(next)) }
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
			// UniWork AI (G6-03a A12): the frame sends the conversation id back
			// on every turn; without it in the preflight the fetch never leaves
			// the page.
			ai.UniworkConversationHeader,
			ai.UniworkRunHeader,
			// Vendor headers the BYOK proxy forwards (provider/byok_client.go); a
			// browser caller needs them in the preflight or the fetch never leaves.
			"Anthropic-Beta",
			"Openai-Organization",
			"Openai-Project",
			"Http-Referer",
			"X-Title",
		},
		ExposedHeaders: []string{
			mw.CorrelationHeader, telemetry.TraceHeader, "Retry-After",
			// G6-05 reads both off the response: the conversation to continue
			// and, from G6-03b on, the run id.
			ai.UniworkConversationHeader, ai.UniworkRunHeader,
		},
		AllowCredentials: true,
	}))
	// Inside CORS, so a shed request still carries the headers the browser
	// needs to read its 503 and Retry-After, and preflights never count.
	//
	// The three UniWork AI routes are exempt by pattern (G6-03a §7.4): a turn
	// waits up to 55 s on a model, so counting it against the in-flight bound
	// would let a handful of AI turns shed every other request in the pod.
	// Patterns, not prefixes, on purpose: a prefix under /api/v1/orgs/{orgID}/ai/
	// would exempt the BYOK proxy and the cloud tools too. Exempt routes still
	// get their body deadline.
	r.Use(mw.LoadShed(d.Cfg.HTTPMaxInFlight, "/healthz", "/readyz",
		"/api/v1/orgs/{orgID}/ai/uniwork/chat/completions",
		"/api/v1/documents/{documentID}/ai/uniwork/chat/completions",
		"/api/v1/office-frame/documents/{documentID}/ai/uniwork/chat/completions",
	))
	cat := &apiCatalog{}
	root := newAPI(r, cat)
	registerMeta(root, r, d.Storage, h)
	// Discovery and OAuth for external MCP clients: RFC bodies, so outside the
	// api wrapper and the OpenAPI catalogue. Registration creates rows for any
	// caller, so it gets the smaller budget.
	registerMCP(r, h, credentialLimit, mw.RateLimit(d.Redis, 10, time.Hour, proxies),
		mcpLimits(
			// Every request of an address, whatever token it carries: the
			// per-token key below is read before authentication, so a caller
			// who rotates well-formed uwm_at_ strings gets a fresh bucket from
			// each. 1200 a minute holds ten teams at their own 120 behind one
			// AI vendor's egress address.
			mw.RateLimitByIdentityBucket(d.Redis, "mcp-ip", 1200, time.Minute, proxies, nil),
			mw.RateLimitByIdentityBucket(d.Redis, "mcp", 120, time.Minute, proxies, mcpBearer)))
	root.Route("/api/v1", func(v1 api) {
		v1.r.Get("/ws", h.WS) // WebSocket — off the OpenAPI spec
		registerAuth(v1, h, credentialLimit, refreshLimit)
		registerDemoRequests(v1, h, mw.RateLimit(d.Redis, 5, time.Hour, proxies))
		// Outside authed: the provider redirects the popup here with no bearer.
		registerEmailHubCallback(v1, h, credentialLimit)
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
			// G6-03b: the UniWork AI turn draws on the ai-uniwork bucket, the
			// same one the two session routes use, so a person's frame and
			// host tab share the 60/min and the refusal carries its own code.
			uniwork: mw.RateLimitByIdentityBucket(d.Redis, "ai-uniwork", 60, time.Minute, proxies, frameUser, "ai_rate_limited"),
		})
		v1.Group(func(authed api) {
			if d.DeviceStatus != nil {
				authed.Use(mw.RequireAuthWithDevice(d.Minter, d.DeviceStatus))
			} else {
				authed.Use(mw.RequireAuth(d.Minter))
			}
			registerMe(authed, h, credentialLimit)
			registerConnect(authed, h)
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
			// UniWork AI (G6-03b): one 60/min budget per person across the
			// three UniWork AI routes, keyed by the bucket so the ids in their
			// paths mint no fresh budget (ADR 0029 D6), and refused with
			// ai_rate_limited so the client tells it from every other bucket.
			registerAIUniwork(authed, h, mw.RateLimitByIdentityBucket(d.Redis, "ai-uniwork", 60, time.Minute, proxies, bearerUser(d.Minter), "ai_rate_limited"))
			registerOnboarding(authed, h)
			registerTasks(authed, h)
			registerTasksSuite(authed, h)
			registerHome(authed, h)
			registerCalendar(authed, h)
			// Connect dials a third party with a password the caller chose
			// (UNI-1197): per signed-in person and route, 10 per 10 minutes.
			emailHubConnectLimit := mw.RateLimitPerRoute(d.Redis, 10, 10*time.Minute, proxies, bearerUser(d.Minter))
			registerEmailHub(authed, h, emailHubConnectLimit)
			registerAudit(authed, h)
			registerPrivacy(authed, h)
			registerGraph(authed, h)
			registerMeetings(authed, h)
			// Chat writes budget per signed-in person and per route: an office
			// NAT must not pool everyone's sends, and walking message or room
			// ids must not mint a fresh budget per id.
			chatWriteLimit := mw.RateLimitPerRoute(d.Redis, 120, time.Minute, proxies, bearerUser(d.Minter))
			// Reactions, pins and votes: each one makes every open client
			// refetch the message.
			chatReactLimit := mw.RateLimitPerRoute(d.Redis, 60, time.Minute, proxies, bearerUser(d.Minter))
			// Room administration, member invites, call invites and the
			// default-room sync: each fans out to every member of a room.
			chatRoomLimit := mw.RateLimitPerRoute(d.Redis, 20, time.Minute, proxies, bearerUser(d.Minter))
			// Presence beats from every shell page and typing: per signed-in
			// person, so an office NAT does not pool everyone's budget.
			chatTypingLimit := mw.RateLimitByIdentity(d.Redis, 30, time.Minute, proxies, bearerUser(d.Minter))
			registerChat(authed, h, chatWriteLimit, chatReactLimit, chatRoomLimit, chatTypingLimit)
			registerChatChannels(authed, h, chatWriteLimit, chatRoomLimit)
			registerChatThreads(authed, h, chatWriteLimit)
			registerChatLinks(authed, h, chatWriteLimit)
			registerChatFollowUps(authed, h, chatWriteLimit)
			registerFiles(authed, h)
			// The `documents` gate evaluates at the organization the path acts
			// in, so an organization override closes these routes like it
			// closes public links and MCP tools (UNI-1800).
			docs := authed.With(mw.FlagOrganization(d.DocumentOrganization))
			registerDocuments(docs, h, d.FeatureFlags)
			registerDocumentSources(docs, h, d.FeatureFlags)
			registerSignatures(authed, h)
			// Personal AI keys: per signed-in person across the whole group, 30/min (ADR 0029).
			registerAICredentials(authed, h, mw.RateLimitByIdentityBucket(d.Redis, "ai-credentials", 30, time.Minute, proxies, bearerUser(d.Minter)))
			registerOfficeLaunch(authed, h)
			registerOfficeFrameToken(docs, h, d.FeatureFlags)
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

// globalIdentity names the caller of the global limiter: the bearer token
// first (a signed-in person), the Office frame token second. The frame half is
// G6-03b §5.3: the limiter runs before routing, so a frame request used to
// fall back to its address and one office NAT shared 300/min across every
// frame behind it. A request neither half can name keeps its address's budget
// — a token that does not verify must not mint one.
func globalIdentity(m auth.TokenMinter, frame mw.IdentityFunc) mw.IdentityFunc {
	bearer := bearerUser(m)
	if frame == nil {
		return bearer
	}
	return func(r *http.Request) string {
		if id := bearer(r); id != "" {
			return id
		}
		return frame(r)
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
