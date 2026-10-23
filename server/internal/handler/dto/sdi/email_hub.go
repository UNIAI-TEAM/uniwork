package sdi

// ConnectEmailHubAccountSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/accounts.
// Without imap_host the server comes from the address's domain preset; with it,
// all six server fields are required and the mailbox is stored as provider custom.
type ConnectEmailHubAccountSDI struct {
	EmailAddress string `json:"email_address" minLength:"3" maxLength:"254" format:"email" example:"you@gmail.com"`
	AppPassword  string `json:"app_password" minLength:"8" maxLength:"128" description:"Mật khẩu ứng dụng, hoặc mật khẩu hộp thư khi dùng máy chủ riêng" example:"abcd efgh ijkl mnop"`
	ImapHost     string `json:"imap_host,omitempty" maxLength:"253" description:"Máy chủ IMAP: tên miền hoặc địa chỉ IP, không kèm giao thức hay cổng. Bỏ trống để dùng cấu hình sẵn theo tên miền email" example:"mail.example.com"`
	ImapPort     int    `json:"imap_port,omitempty" description:"Cổng IMAP: 993, 143, 465, 587 hoặc 25" example:"993"`
	ImapSecurity string `json:"imap_security,omitempty" enum:"tls,starttls" description:"tls: mã hoá ngay khi kết nối; starttls: bắt buộc nâng cấp bằng STARTTLS" example:"tls"`
	SmtpHost     string `json:"smtp_host,omitempty" maxLength:"253" description:"Máy chủ SMTP: tên miền hoặc địa chỉ IP, không kèm giao thức hay cổng" example:"mail.example.com"`
	SmtpPort     int    `json:"smtp_port,omitempty" description:"Cổng SMTP: 993, 143, 465, 587 hoặc 25" example:"587"`
	SmtpSecurity string `json:"smtp_security,omitempty" enum:"tls,starttls" description:"tls: mã hoá ngay khi kết nối; starttls: bắt buộc nâng cấp bằng STARTTLS" example:"starttls"`
	Username     string `json:"username,omitempty" maxLength:"320" description:"Tên đăng nhập nếu khác địa chỉ email" example:"you"`
}

// SendEmailHubAttachmentSDI is one base64 attachment on send.
type SendEmailHubAttachmentSDI struct {
	Filename      string `json:"filename" minLength:"1" maxLength:"255" example:"brief.pdf"`
	ContentType   string `json:"content_type,omitempty" maxLength:"128" example:"application/pdf"`
	ContentBase64 string `json:"content_base64" minLength:"1"`
}

// SendEmailHubSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/send.
type SendEmailHubSDI struct {
	AccountID       string                      `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	To              []string                    `json:"to" minItems:"1" example:"[\"client@example.com\"]"`
	Cc              []string                    `json:"cc,omitempty" example:"[\"cc@example.com\"]"`
	Bcc             []string                    `json:"bcc,omitempty" example:"[\"bcc@example.com\"]"`
	Subject         string                      `json:"subject" maxLength:"998" example:"Hello from UniWork"`
	BodyText        string                      `json:"body_text" minLength:"1" example:"Thanks for your message."`
	BodyHTML        string                      `json:"body_html,omitempty" example:"<p>Thanks for your message.</p>"`
	Attachments     []SendEmailHubAttachmentSDI `json:"attachments,omitempty"`
	SendAt          string                      `json:"send_at,omitempty" format:"date-time" example:"2026-09-21T09:30:00Z"`
	ReplyToThreadID string                      `json:"reply_to_thread_id,omitempty" example:"01JABC1234567890ABCDEFGH"`
}

// SummarizeEmailHubThreadSDI is POST .../email-hub/threads/{threadID}/ai/summarize.
type SummarizeEmailHubThreadSDI struct {
	AccountID string `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	Locale    string `json:"locale" description:"vi hoặc en; mặc định en" example:"vi"`
	Force     bool   `json:"force" description:"true = bỏ cache và gọi AI lại"`
}

// EmailHubSummaryTasksSDI is POST .../email-hub/threads/{threadID}/ai/summary/tasks.
type EmailHubSummaryTasksSDI struct {
	AccountID string               `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	Items     []SummaryTaskItemSDI `json:"items"`
}

// PatchEmailHubThreadSDI is PATCH /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}.
type PatchEmailHubThreadSDI struct {
	AccountID   string  `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	IsRead      *bool   `json:"is_read,omitempty" example:"true"`
	IsStarred   *bool   `json:"is_starred,omitempty" example:"true"`
	MoveTo      string  `json:"move_to,omitempty" enum:"INBOX,ARCHIVE,TRASH,SPAM" example:"ARCHIVE"`
	SnoozeUntil *string `json:"snooze_until,omitempty" format:"date-time" example:"2026-09-25T09:00:00Z"`
	ClearSnooze *bool   `json:"clear_snooze,omitempty" example:"true"`
}

// StartEmailHubOAuthSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start.
type StartEmailHubOAuthSDI struct {
	LoginHint string `json:"login_hint,omitempty" maxLength:"320" description:"Địa chỉ gợi ý để nhà cung cấp chọn sẵn tài khoản khi kết nối lại" example:"you@gmail.com"`
}
