package sdi

// ConnectEmailHubAccountSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/accounts.
type ConnectEmailHubAccountSDI struct {
	EmailAddress string `json:"email_address" minLength:"3" maxLength:"254" format:"email" example:"you@gmail.com"`
	AppPassword  string `json:"app_password" minLength:"8" maxLength:"128" example:"abcd efgh ijkl mnop"`
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

// PatchEmailHubThreadSDI is PATCH /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}.
type PatchEmailHubThreadSDI struct {
	AccountID string `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	IsRead    *bool  `json:"is_read,omitempty" example:"true"`
	IsStarred *bool  `json:"is_starred,omitempty" example:"true"`
	MoveTo    string `json:"move_to,omitempty" enum:"INBOX,ARCHIVE,TRASH" example:"ARCHIVE"`
}
