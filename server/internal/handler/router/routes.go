package router

import "net/http"

// Routes is the HTTP surface the mux binds. handler.New fills every field
// from *handlers so route files stay in this package.
type Routes struct {
	Health http.HandlerFunc
	WS     http.HandlerFunc

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
	LiveKitWebhook       http.HandlerFunc
}
