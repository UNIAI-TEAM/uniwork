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
	r.Post("/workspaces/{workspaceID}/email-hub/send", h.SendEmailHub, apiOp{
		summary:     "Send email via SMTP",
		description: "Delivers through the connected mailbox and caches the message under SENT.",
		tags:        []string{"email-hub"},
		sdi:         sdi.SendEmailHubSDI{},
		sdo:         sdo.EmailHubThreadSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/email-hub/sync", h.SyncEmailHub, apiOp{
		summary: "Sync mailbox now",
		tags:    []string{"email-hub"},
		auth:    true,
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
