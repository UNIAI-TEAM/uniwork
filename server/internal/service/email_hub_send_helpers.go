package service

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
)

const (
	emailHubMaxAttachmentCount = 10
	emailHubMaxAttachmentBytes = 5 << 20
	emailHubMaxAttachmentTotal = 15 << 20
)

type SendEmailHubAttachmentInput struct {
	Filename    string
	ContentType string
	Data        []byte
}

func normalizeSendAttachments(in []SendEmailHubAttachmentInput) ([]smtpclient.OutboundAttachment, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > emailHubMaxAttachmentCount {
		return nil, Invalid(fmt.Sprintf("at most %d attachments allowed", emailHubMaxAttachmentCount))
	}
	out := make([]smtpclient.OutboundAttachment, 0, len(in))
	var total int
	for _, att := range in {
		if len(att.Data) == 0 {
			return nil, Invalid("attachment is empty")
		}
		if len(att.Data) > emailHubMaxAttachmentBytes {
			return nil, Invalid(fmt.Sprintf("attachment %q exceeds 5 MiB", att.Filename))
		}
		total += len(att.Data)
		if total > emailHubMaxAttachmentTotal {
			return nil, Invalid("total attachment size exceeds 15 MiB")
		}
		out = append(out, smtpclient.OutboundAttachment{
			Filename:    att.Filename,
			ContentType: att.ContentType,
			Data:        att.Data,
		})
	}
	return out, nil
}

type SendEmailHubAttachmentPayload struct {
	Filename      string
	ContentType   string
	ContentBase64 string
}

func ParseSendAttachments(items []SendEmailHubAttachmentPayload) ([]SendEmailHubAttachmentInput, error) {
	if len(items) == 0 {
		return nil, nil
	}
	out := make([]SendEmailHubAttachmentInput, 0, len(items))
	for _, item := range items {
		raw := strings.TrimSpace(item.ContentBase64)
		if raw == "" {
			return nil, Invalid("attachment content is required")
		}
		data, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, Invalid("attachment content must be base64")
		}
		out = append(out, SendEmailHubAttachmentInput{
			Filename:    strings.TrimSpace(item.Filename),
			ContentType: strings.TrimSpace(item.ContentType),
			Data:        data,
		})
	}
	return out, nil
}

type sendEmailHubAttachmentPayload struct {
	Filename      string `json:"filename"`
	ContentType   string `json:"content_type,omitempty"`
	ContentBase64 string `json:"content_base64"`
}

func decodeSendAttachmentsSDI(items []sendEmailHubAttachmentPayload) ([]SendEmailHubAttachmentInput, error) {
	payload := make([]SendEmailHubAttachmentPayload, 0, len(items))
	for _, item := range items {
		payload = append(payload, SendEmailHubAttachmentPayload(item))
	}
	return ParseSendAttachments(payload)
}

type scheduledSendPayload struct {
	To              []string                        `json:"to"`
	Cc              []string                        `json:"cc,omitempty"`
	Bcc             []string                        `json:"bcc,omitempty"`
	Subject         string                          `json:"subject"`
	BodyText        string                          `json:"body_text"`
	BodyHTML        string                          `json:"body_html,omitempty"`
	ReplyToThreadID string                          `json:"reply_to_thread_id,omitempty"`
	Attachments     []sendEmailHubAttachmentPayload `json:"attachments,omitempty"`
}

func bodyHTMLForSend(bodyText, bodyHTML string) string {
	html := strings.TrimSpace(bodyHTML)
	if html != "" {
		return html
	}
	text := strings.TrimSpace(bodyText)
	if text == "" {
		return ""
	}
	return sentMessageHTML(text)
}

func validateSendInput(in SendEmailHubInput) error {
	to := cleanEmailList(in.To)
	if len(to) == 0 {
		return Invalid("at least one recipient required")
	}
	if strings.TrimSpace(in.BodyText) == "" {
		return Invalid("message body required")
	}
	if strings.TrimSpace(in.Subject) == "" && in.ReplyToThreadID == "" {
		return Invalid("subject required")
	}
	return nil
}
