package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatTaskDraftMaxMessages  = 20
	chatTaskDraftExcerptRunes = 800
)

// ChatTaskDraftInput is POST /ai/chat/task-draft.
type ChatTaskDraftInput struct {
	MessageIDs []string
	Locale     string
}

// ChatTaskDraftResult is the ephemeral draft returned to the create-task form.
type ChatTaskDraftResult struct {
	Title        string
	Description  string
	Priority     string
	DueDate      string // YYYY-MM-DD or empty
	MessageCount int
	InputTokens  int
	OutputTokens int
}

// ChatTaskDraft asks the model for a title, description, priority and due date
// from selected chat messages. It never creates a task (ADR 0010).
func (s *AskUNIService) ChatTaskDraft(ctx context.Context, userID, workspaceID string, in ChatTaskDraftInput) (ChatTaskDraftResult, error) {
	trimmed := make([]string, 0, len(in.MessageIDs))
	for _, id := range in.MessageIDs {
		trimmed = append(trimmed, strings.TrimSpace(id))
	}
	ids := uniqueNonEmpty(trimmed)
	if len(ids) == 0 {
		return ChatTaskDraftResult{}, Invalid("message_ids không được để trống")
	}
	if len(ids) > chatTaskDraftMaxMessages {
		return ChatTaskDraftResult{}, Invalid(fmt.Sprintf("tối đa %d tin nhắn", chatTaskDraftMaxMessages))
	}
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return ChatTaskDraftResult{}, err
	}
	if !s.gw.Enabled() {
		return ChatTaskDraftResult{}, ai.ErrDisabled
	}
	if err := s.rateLimit(ctx, userID); err != nil {
		return ChatTaskDraftResult{}, err
	}

	msgs, roomID, err := s.loadChatTaskDraftMessages(ctx, userID, workspaceID, ids)
	if err != nil {
		return ChatTaskDraftResult{}, err
	}
	optOuts, err := loadAIOptOuts(ctx, s.q, chatSenderIDs(msgs))
	if err != nil {
		return ChatTaskDraftResult{}, err
	}
	base, err := s.base(ctx, workspaceID)
	if err != nil {
		return ChatTaskDraftResult{}, err
	}

	sources := make([]ai.Source, 0, len(msgs))
	for _, m := range msgs {
		if optOuts.excludes(m.SenderID) {
			continue
		}
		excerpt := catchUpExcerpt(m)
		if excerpt == "" {
			continue
		}
		if utf8.RuneCountInString(excerpt) > chatTaskDraftExcerptRunes {
			excerpt = string([]rune(excerpt)[:chatTaskDraftExcerptRunes])
		}
		href := base + "/chat?room=" + roomID + "&msg=" + m.ID
		title := fmt.Sprintf("%s · %s", m.SenderDisplayName, m.CreatedAt.UTC().Format("2006-01-02 15:04"))
		sources = append(sources, ai.Source{Kind: "chat", Title: title, Href: href, Excerpt: excerpt})
	}
	if len(sources) == 0 {
		return ChatTaskDraftResult{}, Invalid("không có nội dung tin nhắn để phân tích")
	}
	pack, truncated := ai.BuildContext(sources)

	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
		Capability: ai.CapChatTaskDraft, PromptID: ai.PromptChatTaskDraft,
		Vars: map[string]any{
			"locale": in.Locale, "today": s.now().Format("2006-01-02"),
			"sources": ai.RenderSources(pack),
		},
		Sources: pack, Truncated: truncated,
	})
	if err != nil {
		return ChatTaskDraftResult{}, err
	}
	draft, err := ai.ParseChatTaskDraftJSON(resp.Text)
	if err != nil {
		return ChatTaskDraftResult{}, err
	}
	return ChatTaskDraftResult{
		Title: draft.Title, Description: draft.Description, Priority: draft.Priority, DueDate: draft.DueDate,
		MessageCount: len(msgs), InputTokens: resp.InputTokens, OutputTokens: resp.OutputTokens,
	}, nil
}

func (s *AskUNIService) loadChatTaskDraftMessages(
	ctx context.Context, userID, workspaceID string, ids []string,
) ([]ChatMessageRow, string, error) {
	type loaded struct {
		row db.ChatMessage
	}
	rows := make([]loaded, 0, len(ids))
	var roomID string
	for _, id := range ids {
		msg, err := s.q.GetChatMessageByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && msg.DeletedAt.Valid) {
			return nil, "", ErrNotFound
		}
		if err != nil {
			return nil, "", err
		}
		if msg.WorkspaceID != workspaceID {
			return nil, "", ErrNotFound
		}
		if roomID == "" {
			roomID = msg.RoomID
		} else if msg.RoomID != roomID {
			return nil, "", Invalid("các tin phải cùng một phòng chat")
		}
		rows = append(rows, loaded{row: msg})
	}
	if _, err := s.chat.authorizeRoomRead(ctx, userID, workspaceID, roomID); err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return nil, "", ErrNotFound
		}
		return nil, "", err
	}

	out := make([]ChatMessageRow, 0, len(rows))
	for _, item := range rows {
		name := item.row.SenderID
		if u, err := s.q.GetUserByID(ctx, item.row.SenderID); err == nil {
			name = strings.TrimSpace(u.DisplayName)
			if name == "" {
				name = item.row.SenderID
			}
		}
		out = append(out, ChatMessageRow{
			ID: item.row.ID, RoomID: item.row.RoomID, WorkspaceID: item.row.WorkspaceID,
			SenderID: item.row.SenderID, SenderDisplayName: name,
			Body: item.row.Body, Kind: item.row.Kind, CreatedAt: item.row.CreatedAt.Time,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, roomID, nil
}
