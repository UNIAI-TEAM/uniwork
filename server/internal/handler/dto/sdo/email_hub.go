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

// EmailHubUnreadSDO is GET .../email-hub/unread-count.
type EmailHubUnreadSDO struct {
	Unread int64 `json:"unread" example:"3"`
}

// EmailHubScheduledSendItemSDO is one open scheduled outbound message: pending
// (waiting to go out) or failed (delivery gave up; retry or dismiss). The
// failure reason is not exposed.
type EmailHubScheduledSendItemSDO struct {
	ID      string   `json:"id"`
	SendAt  string   `json:"send_at" format:"date-time"`
	Subject string   `json:"subject"`
	To      []string `json:"to"`
	Status  string   `json:"status" enum:"pending,failed" example:"pending"`
}

// EmailHubScheduledSendListSDO lists the caller's open scheduled sends,
// failed ones first, then by send_at ascending.
type EmailHubScheduledSendListSDO struct {
	Scheduled []EmailHubScheduledSendItemSDO `json:"scheduled"`
}

// EmailHubScheduledSendSDO is POST .../email-hub/send when send_at is in the future.
type EmailHubScheduledSendSDO struct {
	Scheduled bool     `json:"scheduled" example:"true"`
	ID        string   `json:"id" example:"01JABC1234567890ABCDEFGH"`
	SendAt    string   `json:"send_at" format:"date-time"`
	Subject   string   `json:"subject" example:"Hello from UniWork"`
	To        []string `json:"to" example:"[\"client@example.com\"]"`
	AccountID string   `json:"account_id" example:"01JABC1234567890ABCDEFGH"`
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
	ID                       string                  `json:"id"`
	AccountID                string                  `json:"account_id"`
	Folder                   string                  `json:"folder"`
	Subject                  string                  `json:"subject"`
	Snippet                  string                  `json:"snippet"`
	FromAddr                 string                  `json:"from_addr"`
	FromName                 string                  `json:"from_name,omitempty"`
	ToAddrs                  []string                `json:"to_addrs"`
	SentAt                   string                  `json:"sent_at" format:"date-time"`
	IsRead                   bool                    `json:"is_read"`
	IsStarred                bool                    `json:"is_starred"`
	HasAttachments           bool                    `json:"has_attachments"`
	Attachments              []EmailHubAttachmentSDO `json:"attachments,omitempty"`
	BodyText                 string                  `json:"body_text,omitempty"`
	BodyHTML                 string                  `json:"body_html,omitempty"`
	BodyCached               bool                    `json:"body_cached"`
	ImapLabels               []string                `json:"imap_labels,omitempty"`
	SnoozedUntil             string                  `json:"snoozed_until,omitempty" format:"date-time"`
	ConversationMessageCount int                     `json:"conversation_message_count,omitempty"`
}

// EmailHubImapLabelListSDO lists distinct user-visible IMAP labels on cached threads.
type EmailHubImapLabelListSDO struct {
	Labels []string `json:"labels"`
}

// EmailHubThreadListSDO is a folder listing with counts.
type EmailHubThreadListSDO struct {
	Threads    []EmailHubThreadSDO `json:"threads"`
	Counts     EmailHubCountsSDO   `json:"counts"`
	NextCursor string              `json:"next_cursor,omitempty"`
}

// EmailHubConversationSDO lists every message in one conversation (oldest first).
type EmailHubConversationSDO struct {
	Messages []EmailHubThreadSDO `json:"messages"`
}

// EmailHubCountsSDO holds folder totals.
type EmailHubCountsSDO struct {
	Total  int64 `json:"total"`
	Unread int64 `json:"unread"`
}

// EmailHubThreadSummarySDO is POST .../email-hub/threads/{threadID}/ai/summarize.
type EmailHubThreadSummarySDO struct {
	Summary      string                 `json:"summary"`
	KeyPoints    []string               `json:"key_points"`
	ActionItems  []SummaryActionItemDTO `json:"action_items"`
	NeedsReply   bool                   `json:"needs_reply"`
	ReplyHint    string                 `json:"reply_hint,omitempty"`
	Model        string                 `json:"model,omitempty"`
	Cached       bool                   `json:"cached"`
	SummarizedAt string                 `json:"summarized_at,omitempty" format:"date-time"`
}
