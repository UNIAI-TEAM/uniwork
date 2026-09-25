package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: email-hub — IMAP mailboxes connected with App Password (Phase 1).
//
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/accounts
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/accounts
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
func registerEmailHub(r api, h Routes) {
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
	r.Post("/workspaces/{workspaceID}/email-hub/accounts", h.ConnectEmailHubAccount, apiOp{
		summary:     "Connect IMAP mailbox",
		description: "Verifies IMAP login with an App Password, stores encrypted credentials, and runs an initial INBOX sync.",
		tags:        []string{"email-hub"},
		sdi:         sdi.ConnectEmailHubAccountSDI{},
		sdo:         sdo.EmailHubAccountSDO{},
		auth:        true,
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
