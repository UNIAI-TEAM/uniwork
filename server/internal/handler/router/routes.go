package router

import "net/http"

// Routes is the HTTP surface the mux binds. handler.New fills every field
// from *handlers so route files stay in this package.
type Routes struct {
	Health http.HandlerFunc
	Ready  http.HandlerFunc
	WS     http.HandlerFunc

	Config                     http.HandlerFunc
	RUM                        http.HandlerFunc
	AdminMe                    http.HandlerFunc
	AdminListOrganizations     http.HandlerFunc
	AdminGetOrganization       http.HandlerFunc
	AdminSuspendOrganization   http.HandlerFunc
	AdminUnsuspendOrganization http.HandlerFunc
	AdminChangePlan            http.HandlerFunc
	AdminTrace                 http.HandlerFunc
	AdminSystem                http.HandlerFunc
	AdminListFlags             http.HandlerFunc
	AdminListFlagOverrides     http.HandlerFunc
	AdminSetFlagOverride       http.HandlerFunc
	AdminDeleteFlagOverride    http.HandlerFunc

	Register       http.HandlerFunc
	Login          http.HandlerFunc
	ForgotPassword http.HandlerFunc
	ResetPassword  http.HandlerFunc
	Refresh        http.HandlerFunc
	Logout         http.HandlerFunc
	AuthProviders  http.HandlerFunc
	GoogleStart    http.HandlerFunc
	GoogleCallback http.HandlerFunc

	Me                 http.HandlerFunc
	PatchMe            http.HandlerFunc
	UploadAvatar       http.HandlerFunc
	VerifyEmail        http.HandlerFunc
	ResendVerification http.HandlerFunc
	PatchOnboarding    http.HandlerFunc
	CompleteOnboarding http.HandlerFunc
	MyInvitations      http.HandlerFunc

	ListOrganizations  http.HandlerFunc
	CreateOrganization http.HandlerFunc
	GetOrganization    http.HandlerFunc
	ListOrgWorkspaces  http.HandlerFunc
	CreateOrgWorkspace http.HandlerFunc

	GetWorkspaceBySlugs http.HandlerFunc
	ListWorkspaces      http.HandlerFunc
	PatchWorkspace      http.HandlerFunc
	GetWorkspaceMe      http.HandlerFunc
	ListMembers         http.HandlerFunc
	PatchMember         http.HandlerFunc
	DeleteMember        http.HandlerFunc
	CreateInvitation    http.HandlerFunc
	AcceptInvitation    http.HandlerFunc

	SeedWelcomeTask http.HandlerFunc

	ListTasks     http.HandlerFunc
	CreateTask    http.HandlerFunc
	GetTask       http.HandlerFunc
	UpdateTask    http.HandlerFunc
	DeleteTask    http.HandlerFunc
	ListComments  http.HandlerFunc
	CreateComment http.HandlerFunc

	ListNotifications          http.HandlerFunc
	UnreadNotificationCount    http.HandlerFunc
	MarkNotificationsRead      http.HandlerFunc
	MarkNotificationsUnread    http.HandlerFunc
	ArchiveNotifications       http.HandlerFunc
	GetNotificationPreferences http.HandlerFunc
	PutNotificationPreferences http.HandlerFunc
	PushConfig                 http.HandlerFunc
	SubscribePush              http.HandlerFunc
	UnsubscribePush            http.HandlerFunc

	AiCapabilities       http.HandlerFunc
	AskUni               http.HandlerFunc
	ListAiConversations  http.HandlerFunc
	ListAiMessages       http.HandlerFunc
	DeleteAiConversation http.HandlerFunc
	WorkspaceAiUsage     http.HandlerFunc
	OrganizationAiUsage  http.HandlerFunc

	ListPlans          http.HandlerFunc
	GetSubscription    http.HandlerFunc
	ChangePlan         http.HandlerFunc
	CancelSubscription http.HandlerFunc
	ResumeSubscription http.HandlerFunc
	CreateCheckout     http.HandlerFunc

	ListOrgAgents       http.HandlerFunc
	CreateOrgAgent      http.HandlerFunc
	PatchAgent          http.HandlerFunc
	ListWorkspaceAgents http.HandlerFunc
	AddWorkspaceAgent   http.HandlerFunc

	ListAuditEvents     http.HandlerFunc
	GetAuditEvent       http.HandlerFunc
	ListResourceHistory http.HandlerFunc
	GetAuditRetention   http.HandlerFunc
	SetAuditRetention   http.HandlerFunc
	ListAuditExports    http.HandlerFunc
	CreateAuditExport   http.HandlerFunc
	GetAuditExport      http.HandlerFunc

	ListMeetings         http.HandlerFunc
	CreateMeeting        http.HandlerFunc
	CreateInstantMeeting http.HandlerFunc
	GetMeeting           http.HandlerFunc
	UpdateMeeting        http.HandlerFunc
	DeleteMeeting        http.HandlerFunc
	StartMeeting         http.HandlerFunc
	EndMeeting           http.HandlerFunc
	CancelMeeting        http.HandlerFunc
	TransferHost         http.HandlerFunc
	ListNotes            http.HandlerFunc
	CreateNote           http.HandlerFunc
	MeetingToken         http.HandlerFunc
	JoinMeeting          http.HandlerFunc
	ListParticipants     http.HandlerFunc
	InviteParticipant    http.HandlerFunc
	ListInvitations      http.HandlerFunc
	RespondInvitation    http.HandlerFunc
	RemoveParticipant    http.HandlerFunc
	ListInviteLinks      http.HandlerFunc
	CreateInviteLink     http.HandlerFunc
	RevokeInviteLink     http.HandlerFunc
	ResolveInviteLink    http.HandlerFunc
	ListJoinRequests     http.HandlerFunc
	CreateJoinRequest    http.HandlerFunc
	ApproveJoinRequest   http.HandlerFunc
	RejectJoinRequest    http.HandlerFunc
	CancelJoinRequest    http.HandlerFunc
	MeetingStatistics    http.HandlerFunc
	MeetingActivity      http.HandlerFunc
	AppendTranscript     http.HandlerFunc
	ListTranscript       http.HandlerFunc
	AppendChatMessage    http.HandlerFunc
	ListChatMessages     http.HandlerFunc
	GetMeetingSummary    http.HandlerFunc
	CreateSummary        http.HandlerFunc
	CreateSummaryTasks   http.HandlerFunc
	StartRecording       http.HandlerFunc
	StopRecording        http.HandlerFunc
	ListRecordings       http.HandlerFunc
	MeetingCalendar      http.HandlerFunc
	MeetingCapabilities  http.HandlerFunc
	LiveKitWebhook       http.HandlerFunc
	MeetingLobbyWS       http.HandlerFunc

	LookupChatUser            http.HandlerFunc
	GetChatBlockStatus        http.HandlerFunc
	BlockChatUser             http.HandlerFunc
	UnblockChatUser           http.HandlerFunc
	MintChatVoiceToken        http.HandlerFunc
	GetWorkspaceChatRoom      http.HandlerFunc
	EnsureWorkspaceChatRoom   http.HandlerFunc
	ListChatRooms             http.HandlerFunc
	ResolveDM                 http.HandlerFunc
	CreateChatGroup           http.HandlerFunc
	InviteChatGroupMembers    http.HandlerFunc
	LeaveChatRoom             http.HandlerFunc
	ListWorkspaceChatMessages http.HandlerFunc
	SendWorkspaceChatMessage  http.HandlerFunc
	ListChatRoomMessages      http.HandlerFunc
	SendChatRoomMessage       http.HandlerFunc
	ToggleChatMessageReaction http.HandlerFunc
	SignalChatVoiceInvite     http.HandlerFunc
	SignalChatVoiceAccept     http.HandlerFunc
	SignalChatVoiceHangup     http.HandlerFunc
	SignalChatTyping          http.HandlerFunc
}
