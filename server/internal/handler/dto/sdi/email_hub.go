package sdi

// ConnectEmailHubAccountSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/accounts.
type ConnectEmailHubAccountSDI struct {
	EmailAddress string `json:"email_address" minLength:"3" maxLength:"254" format:"email" example:"you@gmail.com"`
	AppPassword  string `json:"app_password" minLength:"8" maxLength:"128" example:"abcd efgh ijkl mnop"`
}

// SendEmailHubSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/send.
type SendEmailHubSDI struct {
	AccountID       string   `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	To              []string `json:"to" minItems:"1" example:"[\"client@example.com\"]"`
	Cc              []string `json:"cc,omitempty" example:"[\"cc@example.com\"]"`
	Subject         string   `json:"subject" maxLength:"998" example:"Hello from UniWork"`
	BodyText        string   `json:"body_text" minLength:"1" example:"Thanks for your message."`
	ReplyToThreadID string   `json:"reply_to_thread_id,omitempty" example:"01JABC1234567890ABCDEFGH"`
}

// PatchEmailHubThreadSDI is PATCH /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}.
type PatchEmailHubThreadSDI struct {
	AccountID string `json:"account_id" minLength:"1" example:"01JABC1234567890ABCDEFGH"`
	IsRead    *bool  `json:"is_read,omitempty" example:"true"`
	IsStarred *bool  `json:"is_starred,omitempty" example:"true"`
	MoveTo    string `json:"move_to,omitempty" enum:"ARCHIVE,TRASH" example:"ARCHIVE"`
}
