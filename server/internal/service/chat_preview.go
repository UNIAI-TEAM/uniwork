package service

import (
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var chatMentionMarkdownPattern = regexp.MustCompile(`\[@([^\]]+)\]\(mention://[^)]+\)`)

type chatLastMessagePreview struct {
	Body              string
	Kind              string
	SenderID          string
	SenderDisplayName string
	CreatedAt         time.Time
}

func chatSidebarPreviewBody(body, kind string) string {
	if kind == "voice_call_log" {
		return ""
	}
	if kind == "poll" {
		preview := strings.TrimSpace(body)
		runes := []rune(preview)
		if len(runes) > 120 {
			preview = string(runes[:120]) + "…"
		}
		return "📊 " + preview
	}
	if kind == "reminder" {
		preview := strings.TrimSpace(body)
		runes := []rune(preview)
		if len(runes) > 120 {
			preview = string(runes[:120]) + "…"
		}
		return "⏰ " + preview
	}
	if kind == "note" {
		preview := strings.TrimSpace(body)
		runes := []rune(preview)
		if len(runes) > 120 {
			preview = string(runes[:120]) + "…"
		}
		return "📝 " + preview
	}
	preview := chatMentionMarkdownPattern.ReplaceAllString(body, "@$1")
	preview = strings.TrimSpace(preview)
	runes := []rune(preview)
	if len(runes) > 120 {
		preview = string(runes[:120]) + "…"
	}
	return preview
}

func applyLastMessagePreview(summary *ChatRoomSummary, preview *chatLastMessagePreview) {
	if summary == nil || preview == nil || preview.CreatedAt.IsZero() {
		return
	}
	summary.LastMessageBody = chatSidebarPreviewBody(preview.Body, preview.Kind)
	summary.LastMessageKind = preview.Kind
	summary.LastMessageSenderID = preview.SenderID
	summary.LastMessageSenderName = preview.SenderDisplayName
	summary.LastMessageAt = &preview.CreatedAt
}

func lastMessagePreviewFromListRow(
	body, kind, senderID, senderName string,
	createdAt pgtype.Timestamptz,
) *chatLastMessagePreview {
	if !createdAt.Valid {
		return nil
	}
	return &chatLastMessagePreview{
		Body:              body,
		Kind:              kind,
		SenderID:          senderID,
		SenderDisplayName: senderName,
		CreatedAt:         createdAt.Time,
	}
}
