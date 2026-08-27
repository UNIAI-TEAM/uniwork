package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/events"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type Deps struct {
	Cfg          config.Config
	Log          *slog.Logger
	Minter       auth.TokenMinter
	Auth         *service.AuthService
	Verification *service.VerificationService
	GoogleAuth   *service.GoogleAuthService
	// Google is nil when GOOGLE_CLIENT_ID/SECRET are unset: the start route
	// answers 503 and /auth/providers reports google=false.
	Google        GoogleExchanger
	Organizations *service.OrganizationService
	Workspaces    *service.WorkspaceService
	Onboarding    *service.OnboardingService
	Tasks         *service.TaskService
	Meetings      *service.MeetingService
	Hub           *realtime.Hub
	// Redis is optional: nil disables the rate limiter and any other feature
	// that needs shared state across instances.
	Redis *redis.Client
	// FeatureFlags is nil when no flag file is configured; handlers treat that
	// as "every flag at its default".
	FeatureFlags *featureflag.Service
	// Bus carries in-process domain events between services and side-effect
	// listeners (audit, notifications) without coupling them.
	Bus *events.Bus
	// Storage holds uploaded files. nil disables every upload endpoint with a
	// 501 rather than a panic.
	Storage storage.Storage
	// MembershipCache short-circuits the workspace membership lookup on hot
	// paths (WebSocket connects). nil without Redis; every check then hits the DB.
	MembershipCache *auth.MembershipCache
	// HTTPMetrics is nil unless METRICS_ADDR is set; when present every request
	// is counted and timed by chi route pattern.
	HTTPMetrics *metrics.HTTPMetrics
}

type handlers struct {
	Deps
}

func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
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
	// itself. router_test.go pins this.
	r.Use(chimw.RequestID)
	r.Use(mw.ClientMetadata)
	r.Use(mw.RequestLogger)
	r.Use(chimw.Recoverer)
	r.Use(mw.ContentSecurityPolicy)
	if d.HTTPMetrics != nil {
		r.Use(d.HTTPMetrics.Middleware)
	}
	// Rate limits are per IP and per path, and only exist with Redis (the
	// counters must be shared across API nodes). The global budget covers
	// normal use; the credential endpoints get a smaller one because they
	// are the only ones worth brute-forcing. 60/min still leaves room for an
	// office behind one NAT address (or the e2e suite registering a user per
	// spec from localhost) — 20 did not.
	proxies := mw.ParseTrustedProxies(d.Cfg.TrustedProxies)
	if d.Redis != nil {
		r.Use(mw.RateLimit(d.Redis, 300, time.Minute, proxies))
	}
	credentialLimit := mw.RateLimit(d.Redis, 60, time.Minute, proxies)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{d.Cfg.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.Get("/healthz", h.health)
	// The local backend serves its own files; S3 objects are reached through
	// the URL storage returned, so this route only exists for local storage.
	if local, ok := d.Storage.(*storage.LocalStorage); ok {
		r.Get("/uploads/*", func(w http.ResponseWriter, r *http.Request) {
			local.ServeFile(w, r, chi.URLParam(r, "*"))
		})
	}
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ws", h.ws)
		r.With(credentialLimit).Post("/auth/register", h.register)
		r.With(credentialLimit).Post("/auth/login", h.login)
		r.Post("/auth/refresh", h.refresh)
		r.Post("/auth/logout", h.logout)
		r.Get("/auth/providers", h.authProviders)
		r.With(credentialLimit).Get("/auth/google/start", h.googleStart)
		r.With(credentialLimit).Get("/auth/google/callback", h.googleCallback)
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAuth(d.Minter))
			r.Get("/me", h.me)
			r.Patch("/me", h.patchMe)
			r.With(credentialLimit).Post("/me/email/verify", h.verifyEmail)
			r.With(credentialLimit).Post("/me/email/resend", h.resendVerification)
			r.Post("/me/avatar", h.uploadAvatar)
			r.Patch("/me/onboarding", h.patchOnboarding)
			r.Post("/me/onboarding/complete", h.completeOnboarding)
			r.Get("/me/invitations", h.myInvitations)
			r.Get("/orgs", h.listOrganizations)
			r.Post("/orgs", h.createOrganization)
			r.Get("/orgs/{org}", h.getOrganization)                         // {org} = slug
			r.Get("/orgs/{org}/workspaces/{wsSlug}", h.getWorkspaceBySlugs) // {org} = slug
			r.Get("/orgs/{org}/workspaces", h.listOrgWorkspaces)            // {org} = id
			r.Post("/orgs/{org}/workspaces", h.createOrgWorkspace)          // {org} = id
			r.Get("/workspaces", h.listWorkspaces)
			r.Patch("/workspaces/{workspaceID}", h.patchWorkspace)
			r.Get("/workspaces/{workspaceID}/me", h.getWorkspaceMe)
			r.Get("/workspaces/{workspaceID}/members", h.listMembers)
			r.Patch("/workspaces/{workspaceID}/members/{userID}", h.patchMember)
			r.Delete("/workspaces/{workspaceID}/members/{userID}", h.deleteMember)
			r.Post("/workspaces/{workspaceID}/invitations", h.createInvitation)
			r.Post("/workspaces/{workspaceID}/welcome-task", h.seedWelcomeTask)
			r.Post("/invitations/{token}/accept", h.acceptInvitation)
			r.Get("/workspaces/{workspaceID}/tasks", h.listTasks)
			r.Post("/workspaces/{workspaceID}/tasks", h.createTask)
			r.Get("/tasks/{taskID}", h.getTask)
			r.Patch("/tasks/{taskID}", h.updateTask)
			r.Delete("/tasks/{taskID}", h.deleteTask)
			r.Get("/tasks/{taskID}/comments", h.listComments)
			r.Post("/tasks/{taskID}/comments", h.createComment)
			r.Get("/workspaces/{workspaceID}/meetings", h.listMeetings)
			r.Post("/workspaces/{workspaceID}/meetings", h.createMeeting)
			r.Get("/meetings/{meetingID}", h.getMeeting)
			r.Patch("/meetings/{meetingID}", h.updateMeeting)
			r.Delete("/meetings/{meetingID}", h.deleteMeeting)
			r.Get("/meetings/{meetingID}/notes", h.listNotes)
			r.Post("/meetings/{meetingID}/notes", h.createNote)
			r.Post("/meetings/{meetingID}/token", h.meetingToken)
		})
	})
	return r
}
