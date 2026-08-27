package handler

import (
	"log/slog"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/events"
	rt "github.com/unicomhub/uniwork/server/internal/handler/router"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
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

// New builds the HTTP handler. Routes live in package router, split by
// OpenAPI tag. This constructor only maps *handlers methods onto Routes.
func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	return rt.New(rt.Deps{
		Cfg:         d.Cfg,
		Minter:      d.Minter,
		Redis:       d.Redis,
		Storage:     d.Storage,
		HTTPMetrics: d.HTTPMetrics,
	}, rt.Routes{
		Health: h.health,
		WS:     h.ws,

		Register: h.register,
		Login:    h.login,
		Refresh:  h.refresh,
		Logout:   h.logout,

		Me:                 h.me,
		PatchMe:            h.patchMe,
		UploadAvatar:       h.uploadAvatar,
		PatchOnboarding:    h.patchOnboarding,
		CompleteOnboarding: h.completeOnboarding,
		MyInvitations:      h.myInvitations,

		ListOrganizations:  h.listOrganizations,
		CreateOrganization: h.createOrganization,
		GetOrganization:    h.getOrganization,
		ListOrgWorkspaces:  h.listOrgWorkspaces,
		CreateOrgWorkspace: h.createOrgWorkspace,

		GetWorkspaceBySlugs: h.getWorkspaceBySlugs,
		ListWorkspaces:      h.listWorkspaces,
		PatchWorkspace:      h.patchWorkspace,
		ListMembers:         h.listMembers,
		CreateInvitation:    h.createInvitation,
		AcceptInvitation:    h.acceptInvitation,

		SeedWelcomeTask: h.seedWelcomeTask,

		ListTasks:     h.listTasks,
		CreateTask:    h.createTask,
		GetTask:       h.getTask,
		UpdateTask:    h.updateTask,
		DeleteTask:    h.deleteTask,
		ListComments:  h.listComments,
		CreateComment: h.createComment,

		ListMeetings:  h.listMeetings,
		CreateMeeting: h.createMeeting,
		GetMeeting:    h.getMeeting,
		UpdateMeeting: h.updateMeeting,
		DeleteMeeting: h.deleteMeeting,
		ListNotes:     h.listNotes,
		CreateNote:    h.createNote,
		MeetingToken:  h.meetingToken,
	})
}
