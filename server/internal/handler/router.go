package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
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
}

type handlers struct {
	Deps
}

func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
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
