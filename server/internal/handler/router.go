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
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/notification"
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
	Verification  *service.VerificationService
	PasswordReset *service.PasswordResetService
	GoogleAuth    *service.GoogleAuthService
	// Google is nil when GOOGLE_CLIENT_ID/SECRET are unset: the start route
	// answers 503 and /auth/providers reports google=false.
	Google        GoogleExchanger
	Organizations *service.OrganizationService
	OrgMembers    *service.OrganizationMemberService
	People        *service.PeopleService
	Departments   *service.DepartmentService
	Workspaces    *service.WorkspaceService
	Onboarding    *service.OnboardingService
	Tasks         *service.TaskService
	Agents        *service.AgentService
	Actors        *service.ActorService
	Audit         *service.AuditService
	Billing       *service.BillingService
	Notifications *notification.Service
	AskUNI        *service.AskUNIService
	Meetings      *service.MeetingService
	Chat          *service.ChatService
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
	// Readiness backs /readyz; nil (tests) answers 503.
	Readiness *service.Readiness
	// WebVitals is nil unless METRICS_ADDR is set; /rum then only answers 204.
	WebVitals *metrics.WebVitals
	// Admin is the platform console (F-11); nil leaves /api/v1/admin unmounted.
	Admin *service.AdminService
	// Version and Commit are the build stamps main.go carries into /admin/system.
	Version string
	Commit  string
}

type handlers struct {
	Deps
}

// New builds the HTTP handler. Routes live in package router, split by
// OpenAPI tag. This constructor only maps *handlers methods onto Routes.
func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	return rt.New(rt.Deps{
		Cfg:           d.Cfg,
		Minter:        d.Minter,
		Redis:         d.Redis,
		Storage:       d.Storage,
		HTTPMetrics:   d.HTTPMetrics,
		PlatformRoles: platformRoles(d.Admin),
	}, rt.Routes{
		Health: h.health,
		Ready:  h.ready,

		Config:                     h.config,
		RUM:                        h.rum,
		AdminMe:                    h.adminMe,
		AdminListOrganizations:     h.adminListOrganizations,
		AdminGetOrganization:       h.adminGetOrganization,
		AdminSuspendOrganization:   h.adminSuspendOrganization,
		AdminUnsuspendOrganization: h.adminUnsuspendOrganization,
		AdminChangePlan:            h.adminChangePlan,
		AdminTrace:                 h.adminTrace,
		AdminSystem:                h.adminSystem,
		AdminListFlags:             h.adminListFlags,
		AdminListFlagOverrides:     h.adminListFlagOverrides,
		AdminListAllFlagOverrides:  h.adminListAllFlagOverrides,
		AdminSetFlagOverride:       h.adminSetFlagOverride,
		AdminDeleteFlagOverride:    h.adminDeleteFlagOverride,
		WS:                         h.ws,

		Register:       h.register,
		Login:          h.login,
		ForgotPassword: h.forgotPassword,
		ResetPassword:  h.resetPassword,
		Refresh:        h.refresh,
		Logout:         h.logout,
		AuthProviders:  h.authProviders,
		GoogleStart:    h.googleStart,
		GoogleCallback: h.googleCallback,

		Me:                 h.me,
		PatchMe:            h.patchMe,
		UploadAvatar:       h.uploadAvatar,
		VerifyEmail:        h.verifyEmail,
		ResendVerification: h.resendVerification,
		PatchOnboarding:    h.patchOnboarding,
		CompleteOnboarding: h.completeOnboarding,
		MyInvitations:      h.myInvitations,

		ListOrganizations:  h.listOrganizations,
		CreateOrganization: h.createOrganization,
		GetOrganization:    h.getOrganization,
		ListOrgWorkspaces:  h.listOrgWorkspaces,
		CreateOrgWorkspace: h.createOrgWorkspace,

		ListOrgMembers:      h.listOrgMembers,
		GetOrgMembershipMe:  h.getOrgMembershipMe,
		PatchOrgMember:      h.patchOrgMember,
		DeactivateOrgMember: h.deactivateOrgMember,
		ReactivateOrgMember: h.reactivateOrgMember,
		LeaveOrganization:   h.leaveOrganization,

		InviteToOrganization: h.inviteToOrganization,
		ListOrgInvitations:   h.listOrgInvitations,
		RevokeOrgInvitation:  h.revokeOrgInvitation,
		TransferOrgOwnership: h.transferOrgOwnership,

		ListPeople:         h.listPeople,
		GetPerson:          h.getPerson,
		PatchPersonProfile: h.patchPersonProfile,
		ExportPeople:       h.exportPeople,

		ListDepartments:    h.listDepartments,
		CreateDepartment:   h.createDepartment,
		PatchDepartment:    h.patchDepartment,
		ArchiveDepartment:  h.archiveDepartment,
		ReorderDepartments: h.reorderDepartments,

		GetWorkspaceBySlugs: h.getWorkspaceBySlugs,
		ListWorkspaces:      h.listWorkspaces,
		PatchWorkspace:      h.patchWorkspace,
		GetWorkspaceMe:      h.getWorkspaceMe,
		ListMembers:         h.listMembers,
		PatchMember:         h.patchMember,
		DeleteMember:        h.deleteMember,
		CreateInvitation:    h.createInvitation,
		AcceptInvitation:    h.acceptInvitation,

		SeedWelcomeTask: h.seedWelcomeTask,

		ListTasks:    h.listTasks,
		CreateTask:   h.createTask,
		GetTask:      h.getTask,
		UpdateTask:   h.updateTask,
		DeleteTask:   h.deleteTask,
		ListComments: h.listComments,

		ListNotifications:          h.listNotifications,
		UnreadNotificationCount:    h.unreadNotificationCount,
		MarkNotificationsRead:      h.markNotificationsRead,
		MarkNotificationsUnread:    h.markNotificationsUnread,
		ArchiveNotifications:       h.archiveNotifications,
		GetNotificationPreferences: h.getNotificationPreferences,
		PutNotificationPreferences: h.putNotificationPreferences,
		PushConfig:                 h.pushConfig,
		SubscribePush:              h.subscribePush,
		UnsubscribePush:            h.unsubscribePush,

		AiCapabilities:       h.aiCapabilities,
		AskUni:               h.askUni,
		ListAiConversations:  h.listAiConversations,
		ListAiMessages:       h.listAiMessages,
		DeleteAiConversation: h.deleteAiConversation,
		WorkspaceAiUsage:     h.workspaceAiUsage,
		OrganizationAiUsage:  h.organizationAiUsage,

		ListPlans:          h.listPlans,
		GetSubscription:    h.getSubscription,
		ChangePlan:         h.changePlan,
		CancelSubscription: h.cancelSubscription,
		ResumeSubscription: h.resumeSubscription,
		CreateCheckout:     h.createCheckout,

		ListOrgAgents:       h.listOrgAgents,
		CreateOrgAgent:      h.createOrgAgent,
		PatchAgent:          h.patchAgent,
		ListWorkspaceAgents: h.listWorkspaceAgents,
		AddWorkspaceAgent:   h.addWorkspaceAgent,

		ListAuditEvents:     h.listAuditEvents,
		GetAuditEvent:       h.getAuditEvent,
		ListResourceHistory: h.listResourceHistory,
		GetAuditRetention:   h.getAuditRetention,
		SetAuditRetention:   h.setAuditRetention,
		ListAuditExports:    h.listAuditExports,
		CreateAuditExport:   h.createAuditExport,
		GetAuditExport:      h.getAuditExport,
		CreateComment:       h.createComment,

		ListMeetings:         h.listMeetings,
		CreateMeeting:        h.createMeeting,
		CreateInstantMeeting: h.createInstantMeeting,
		GetMeeting:           h.getMeeting,
		UpdateMeeting:        h.updateMeeting,
		DeleteMeeting:        h.deleteMeeting,
		StartMeeting:         h.startMeeting,
		EndMeeting:           h.endMeeting,
		CancelMeeting:        h.cancelMeeting,
		TransferHost:         h.transferHost,
		ListNotes:            h.listNotes,
		CreateNote:           h.createNote,
		MeetingToken:         h.meetingToken,
		JoinMeeting:          h.joinMeeting,
		ListParticipants:     h.listParticipants,
		InviteParticipant:    h.inviteParticipant,
		ListInvitations:      h.listInvitations,
		RespondInvitation:    h.respondInvitation,
		RemoveParticipant:    h.removeParticipant,
		ListInviteLinks:      h.listInviteLinks,
		CreateInviteLink:     h.createInviteLink,
		RevokeInviteLink:     h.revokeInviteLink,
		ResolveInviteLink:    h.resolveInviteLink,
		ListJoinRequests:     h.listJoinRequests,
		CreateJoinRequest:    h.createJoinRequest,
		ApproveJoinRequest:   h.approveJoinRequest,
		RejectJoinRequest:    h.rejectJoinRequest,
		CancelJoinRequest:    h.cancelJoinRequest,
		MeetingStatistics:    h.meetingStatistics,
		MeetingActivity:      h.meetingActivity,
		AppendTranscript:     h.appendTranscript,
		ListTranscript:       h.listTranscript,
		AppendChatMessage:    h.appendChatMessage,
		ListChatMessages:     h.listChatMessages,
		GetMeetingSummary:    h.getMeetingSummary,
		CreateSummary:        h.createSummary,
		CreateSummaryTasks:   h.createSummaryTasks,
		StartRecording:       h.startRecording,
		StopRecording:        h.stopRecording,
		ListRecordings:       h.listRecordings,
		MeetingCalendar:      h.meetingCalendar,
		MeetingCapabilities:  h.meetingCapabilities,
		LiveKitWebhook:       h.livekitWebhook,
		MeetingLobbyWS:       h.meetingLobbyWS,

		LookupChatUser:              h.lookupChatUser,
		GetChatBlockStatus:          h.getChatBlockStatus,
		BlockChatUser:               h.blockChatUser,
		UnblockChatUser:             h.unblockChatUser,
		ListChatNicknames:           h.listChatNicknames,
		SetChatNickname:             h.setChatNickname,
		SearchChatGifs:              h.searchChatGifs,
		TrendingChatGifs:            h.trendingChatGifs,
		SearchChatStickers:          h.searchChatStickers,
		TrendingChatStickers:        h.trendingChatStickers,
		GetChatMediaStatus:          h.getChatMediaStatus,
		MintChatVoiceToken:          h.mintChatVoiceToken,
		ListPendingChatVoiceInvites: h.listPendingChatVoiceInvites,
		GetWorkspaceChatRoom:        h.getWorkspaceChatRoom,
		EnsureWorkspaceChatRoom:     h.ensureWorkspaceChatRoom,
		ListChatRooms:               h.listChatRooms,
		ResolveDM:                   h.resolveDM,
		CreateChatGroup:             h.createChatGroup,
		InviteChatGroupMembers:      h.inviteChatGroupMembers,
		ListChatRoomMembers:         h.listChatRoomMembers,
		PatchChatRoomMember:         h.patchChatRoomMember,
		PatchChatRoom:               h.patchChatRoom,
		RemoveChatRoomMember:        h.removeWorkspaceChatRoomMember,
		LeaveChatRoom:               h.leaveChatRoom,
		ListWorkspaceChatMessages:   h.listWorkspaceChatMessages,
		SendWorkspaceChatMessage:    h.sendWorkspaceChatMessage,
		ListChatRoomMessages:        h.listChatRoomMessages,
		GetChatRoomMessage:          h.getChatRoomMessage,
		SearchChatRoomMessages:      h.searchChatRoomMessages,
		ListChatRoomMessagesAround:  h.listChatRoomMessagesAround,
		SendChatRoomMessage:         h.sendChatRoomMessage,
		VoteChatPollMessage:         h.voteChatPollMessage,
		ToggleChatMessageReaction:   h.toggleChatMessageReaction,
		EditChatMessage:             h.editChatMessage,
		DeleteChatMessage:           h.deleteChatMessage,
		ToggleChatMessagePin:        h.toggleChatMessagePin,
		SignalChatVoiceInvite:       h.signalChatVoiceInvite,
		SignalChatVoiceAccept:       h.signalChatVoiceAccept,
		SignalChatVoiceHangup:       h.signalChatVoiceHangup,
		SignalChatTyping:            h.signalChatTyping,
	})
}

// platformRoles keeps a nil *AdminService from becoming a non-nil interface.
func platformRoles(a *service.AdminService) mw.PlatformRoleSource {
	if a == nil {
		return nil
	}
	return a
}
