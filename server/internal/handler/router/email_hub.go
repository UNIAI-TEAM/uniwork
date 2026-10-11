package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: email-hub — IMAP mailboxes connected with a password: an App Password on a
// preset provider, or the mailbox password on the member's own IMAP/SMTP server.
//
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/providers
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/accounts
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/accounts
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start
//	DELETE /api/v1/workspaces/{workspaceID}/email-hub/accounts/{accountID}
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/threads
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/send
//	PATCH  /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/sync
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/watch
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch
//	DELETE /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/attachments/{attachmentID}
func registerEmailHub(r api, h Routes, connectLimit func(http.Handler) http.Handler) {
	r.Get("/workspaces/{workspaceID}/email-hub/accounts", h.ListEmailHubAccounts, apiOp{
		summary: "List connected mailboxes",
		tags:    []string{"email-hub"},
		sdo:     sdo.EmailHubAccountListSDO{},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/unread-count", h.GetEmailHubUnreadCount, apiOp{
		summary:     "Unread INBOX count for connected mailboxes",
		description: "Sum of unread cached INBOX threads across the caller's mailboxes in this organization.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubUnreadSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/sidebar-counts", h.GetEmailHubSidebarCounts, apiOp{
		summary:     "Sidebar badge counts for one mailbox",
		description: "Cached INBOX unread and snoozed thread totals for the connected account.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubSidebarCountsSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/providers", h.GetEmailHubProviders, apiOp{
		summary:     "Sign-in providers for connecting a mailbox",
		description: "Nhà cung cấp nào có thể kết nối hộp thư bằng đăng nhập (OAuth). Một nhà cung cấp chỉ bật khi máy chủ có OAuth client riêng của Email Hub và khoá mã hoá thông tin đăng nhập.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubProvidersSDO{},
		auth:        true,
	})
	r.With(connectLimit).Post("/workspaces/{workspaceID}/email-hub/accounts", h.ConnectEmailHubAccount, apiOp{
		summary: "Connect IMAP mailbox",
		description: "Verifies IMAP and SMTP login, stores encrypted credentials, and runs an initial sync. " +
			"Without imap_host the server comes from the address's domain preset (App Password); with it, all six " +
			"server fields are required (TLS mandatory, ports 993/143/465/587/25) and are checked before any dial: " +
			"400 email_hub_invalid_server or email_hub_host_not_allowed, with error.fields.field naming the field. " +
			"An address that needs a reconnect keeps its id; a live one on the same IMAP server answers 409 " +
			"email_hub_already_connected before any dial. 10 requests per 10 minutes per user.",
		tags: []string{"email-hub"},
		sdi:  sdi.ConnectEmailHubAccountSDI{},
		sdo:  sdo.EmailHubAccountSDO{},
		auth: true,
	})
	r.With(connectLimit).Post("/workspaces/{workspaceID}/email-hub/oauth/{provider}/start", h.StartEmailHubOAuth, apiOp{
		summary: "Start Google or Microsoft sign-in for a mailbox",
		description: "provider is google or microsoft; one without an Email Hub OAuth client answers 404. " +
			"Returns the provider's authorization URL (offline access, PKCE S256) and sets the HttpOnly " +
			"uniwork_email_oauth nonce cookie on /api/v1/email-hub-connections/ for the callback, so the web " +
			"app and the API must be same-site. login_hint pre-selects the account on a reconnect. " +
			"10 requests per 10 minutes per user.",
		tags: []string{"email-hub"},
		sdi:  sdi.StartEmailHubOAuthSDI{},
		sdo:  sdo.EmailHubOAuthStartSDO{},
		auth: true,
	})
	r.Delete("/workspaces/{workspaceID}/email-hub/accounts/{accountID}", h.DisconnectEmailHubAccount, apiOp{
		summary: "Disconnect mailbox",
		tags:    []string{"email-hub"},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/labels", h.ListEmailHubImapLabels, apiOp{
		summary:     "List IMAP labels on cached threads",
		description: "Query: account_id (required). User-visible Gmail labels from sync; read-only.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubImapLabelListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/threads", h.ListEmailHubThreads, apiOp{
		summary: "List cached threads",
		tags:    []string{"email-hub"},
		sdo:     sdo.EmailHubThreadListSDO{},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/threads/{threadID}", h.GetEmailHubThread, apiOp{
		summary: "Get thread (lazy-load body)",
		tags:    []string{"email-hub"},
		sdo:     sdo.EmailHubThreadSDO{},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/threads/{threadID}/conversation", h.ListEmailHubConversation, apiOp{
		summary:     "List messages in a conversation",
		description: "Returns every cached message with the same conversation key (all folders), oldest first.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubConversationSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary", h.GetEmailHubThreadSummary, apiOp{
		summary:     "Get cached AI summary for an email thread",
		description: "Returns 404 when no cache or email content changed since last summarize.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubThreadSummarySDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summarize", h.SummarizeEmailHubThread, apiOp{
		summary:     "Summarize email thread with AI",
		description: "Reads the cached or fetched body and returns key points and suggested action items.",
		tags:        []string{"email-hub"},
		sdi:         sdi.SummarizeEmailHubThreadSDI{},
		sdo:         sdo.EmailHubThreadSummarySDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary/tasks", h.CreateEmailHubSummaryTasks, apiOp{
		summary: "Create tasks from email summary action items",
		tags:    []string{"email-hub"},
		sdi:     sdi.EmailHubSummaryTasksSDI{},
		sdo:     sdo.TaskIDListSDO{},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/threads/{threadID}/attachments/{attachmentID}", h.DownloadEmailHubAttachment, apiOp{
		summary: "Download attachment bytes from IMAP",
		tags:    []string{"email-hub"},
		auth:    true,
	})
	r.Patch("/workspaces/{workspaceID}/email-hub/threads/{threadID}", h.PatchEmailHubThread, apiOp{
		summary: "Patch thread flags",
		tags:    []string{"email-hub"},
		sdi:     sdi.PatchEmailHubThreadSDI{},
		sdo:     sdo.EmailHubThreadSDO{},
		auth:    true,
	})
	r.Get("/workspaces/{workspaceID}/email-hub/scheduled-sends", h.ListEmailHubScheduledSends, apiOp{
		summary:     "List open scheduled sends",
		description: "Query: account_id (required). Pending and failed scheduled sends of the mailbox, failed first.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubScheduledSendListSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}", h.CancelEmailHubScheduledSend, apiOp{
		summary: "Cancel a pending scheduled send or dismiss a failed one",
		tags:    []string{"email-hub"},
		auth:    true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}/retry", h.RetryEmailHubScheduledSend, apiOp{
		summary:     "Retry a failed scheduled send",
		description: "Query: account_id (required). Re-queues a failed scheduled send to go out now; 404 unless it is failed.",
		tags:        []string{"email-hub"},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/send", h.SendEmailHub, apiOp{
		summary:     "Send email via SMTP",
		description: "Delivers through the connected mailbox and caches the message under SENT.",
		tags:        []string{"email-hub"},
		sdi:         sdi.SendEmailHubSDI{},
		sdo:         sdo.EmailHubThreadSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/sync", h.SyncEmailHub, apiOp{
		summary:     "Sync mailbox now",
		description: "Query: account_id (required), folder, force, live, reconcile (reconcile drops cached threads missing from the IMAP window).",
		tags:        []string{"email-hub"},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/watch", h.WatchEmailHub, apiOp{
		summary:     "Wait for INBOX changes (IMAP IDLE)",
		description: "Long-poll up to ~90s; syncs when the mailbox reports new activity.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubWatchSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/inbox-watch", h.SubscribeEmailHubInboxWatch, apiOp{
		summary:     "Subscribe to server-side INBOX watch",
		description: "Ref-counted IMAP IDLE on the server; clients receive email_hub.inbox_changed over WebSocket.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubInboxWatchSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/email-hub/inbox-watch", h.UnsubscribeEmailHubInboxWatch, apiOp{
		summary: "Unsubscribe from server-side INBOX watch",
		tags:    []string{"email-hub"},
		sdo:     sdo.EmailHubInboxWatchSDO{},
		auth:    true,
	})
}

// registerEmailHubCallback mounts the OAuth redirect target outside the authed
// group: the provider's redirect carries no bearer token. It is registered
// next to registerAuth, on the credential budget, like /auth/google/callback.
//
//	GET /api/v1/email-hub-connections/{provider}/callback  (credential rate limit)
func registerEmailHubCallback(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	v1.With(credentialLimit).Get("/email-hub-connections/{provider}/callback", h.CompleteEmailHubOAuth, apiOp{
		summary: "Complete Email Hub OAuth",
		description: "Provider redirect target for a mailbox connected with Google or Microsoft sign-in; no session. " +
			"Query: state, code, or error from the provider. Checks the sealed state against the nonce cookie set by " +
			"start, exchanges the code with PKCE, verifies XOAUTH2 IMAP and SMTP and connects or reconnects the mailbox. " +
			"Always answers 200 with a small HTML page that posts {type: \"uniwork:email-hub-oauth\", ok, code} to the " +
			"frontend origin and closes. code is one of connected, denied, state_invalid, email_unavailable, " +
			"imap_not_enabled, smtp_disabled, already_connected, consent_required, failed. 60 requests per minute per address.",
		tags:     []string{"email-hub"},
		produces: "text/html",
	})
}
