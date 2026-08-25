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
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type Deps struct {
	Cfg           config.Config
	Log           *slog.Logger
	Minter        auth.TokenMinter
	Auth          *service.AuthService
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
}

type handlers struct {
	Deps
}

func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	r := chi.NewRouter()
	// Order matters: RequestID and RealIP first so every later middleware and
	// the access log see them; ClientMetadata before RequestLogger so the log
	// line carries the client dimensions; Recoverer inside the logger so a
	// panic still produces an access-log entry with its status.
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(mw.ClientMetadata)
	r.Use(mw.RequestLogger)
	r.Use(chimw.Recoverer)
	r.Use(mw.ContentSecurityPolicy)
	if d.Redis != nil {
		r.Use(mw.RateLimit(d.Redis, 300, time.Minute, mw.ParseTrustedProxies(d.Cfg.TrustedProxies)))
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{d.Cfg.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.Get("/healthz", h.health)
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ws", h.ws)
		r.Post("/auth/register", h.register)
		r.Post("/auth/login", h.login)
		r.Post("/auth/refresh", h.refresh)
		r.Post("/auth/logout", h.logout)
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAuth(d.Minter))
			r.Get("/me", h.me)
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
			r.Get("/workspaces/{workspaceID}/members", h.listMembers)
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
