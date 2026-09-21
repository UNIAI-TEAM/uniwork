package sdo

// EmailHubAccountSDO is one connected IMAP mailbox.
type EmailHubAccountSDO struct {
	ID           string `json:"id" example:"01JABC1234567890ABCDEFGH"`
	EmailAddress string `json:"email_address" example:"you@gmail.com"`
	Provider     string `json:"provider" example:"gmail"`
	ConnectedAt  string `json:"connected_at" format:"date-time"`
	LastSyncAt   string `json:"last_sync_at,omitempty" format:"date-time"`
}

// EmailHubWatchSDO is POST .../email-hub/watch.
type EmailHubWatchSDO struct {
	Changed bool   `json:"changed" example:"true"`
	Synced  bool   `json:"synced" example:"true"`
	At      string `json:"at,omitempty" format:"date-time"`
}

// EmailHubInboxWatchSDO is POST/DELETE .../email-hub/inbox-watch.
type EmailHubInboxWatchSDO struct {
	Subscribed bool `json:"subscribed" example:"true"`
}

// EmailHubSyncSDO is POST .../email-hub/sync.
type EmailHubSyncSDO struct {
	Synced bool `json:"synced" example:"true"`
}

// EmailHubAccountListSDO lists connected mailboxes for the caller.
type EmailHubAccountListSDO struct {
	Accounts []EmailHubAccountSDO `json:"accounts"`
}

// EmailHubAttachmentSDO is cached attachment metadata for one thread row.
type EmailHubAttachmentSDO struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
}

// EmailHubThreadSDO is a cached inbox row.
type EmailHubThreadSDO struct {
	ID             string                  `json:"id"`
	AccountID      string                  `json:"account_id"`
	Folder         string                  `json:"folder"`
	Subject        string                  `json:"subject"`
	Snippet        string                  `json:"snippet"`
	FromAddr       string                  `json:"from_addr"`
	FromName       string                  `json:"from_name,omitempty"`
	ToAddrs        []string                `json:"to_addrs"`
	SentAt         string                  `json:"sent_at" format:"date-time"`
	IsRead         bool                    `json:"is_read"`
	IsStarred      bool                    `json:"is_starred"`
	HasAttachments bool                    `json:"has_attachments"`
	Attachments    []EmailHubAttachmentSDO `json:"attachments,omitempty"`
	BodyText       string                  `json:"body_text,omitempty"`
	BodyHTML       string                  `json:"body_html,omitempty"`
	BodyCached     bool                    `json:"body_cached"`
}

// EmailHubThreadListSDO is a folder listing with counts.
type EmailHubThreadListSDO struct {
	Threads    []EmailHubThreadSDO `json:"threads"`
	Counts     EmailHubCountsSDO   `json:"counts"`
	NextCursor string              `json:"next_cursor,omitempty"`
}

// EmailHubCountsSDO holds folder totals.
type EmailHubCountsSDO struct {
	Total  int64 `json:"total"`
	Unread int64 `json:"unread"`
}
