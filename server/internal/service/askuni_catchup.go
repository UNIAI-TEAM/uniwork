package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	catchUpMsgLimit     = 100
	catchUpPublicWindow = 48 * time.Hour
)

// CatchUpInput is POST /ai/chat/catch-up (C-13.7).
type CatchUpInput struct {
	RoomID       string
	ThreadRootID string
	Locale       string
}

// CatchUpActionItemDTO is one suggested follow-up; creating a task is a
// human click on the existing chat→task path (ADR 0010).
type CatchUpActionItemDTO struct {
	Title           string `json:"title"`
	Owner           string `json:"owner,omitempty"`
	Due             string `json:"due,omitempty"`
	SourceMessageID string `json:"source_message_id,omitempty"`
}

// CatchUpResult is the ephemeral brief returned to the client.
type CatchUpResult struct {
	Summary      string
	Highlights   []string
	ActionItems  []CatchUpActionItemDTO
	MessageCount int
	// Mode is "unread" when last_read (or join) drove the window, or
	// "recent" when falling back to the public 48h window (no membership).
	Mode         string
	Since        time.Time
	InputTokens  int
	OutputTokens int
}

// CatchUp summarises unread messages in a room (or one thread) for the caller.
func (s *AskUNIService) CatchUp(ctx context.Context, userID, workspaceID string, in CatchUpInput) (CatchUpResult, error) {
	roomID := strings.TrimSpace(in.RoomID)
	if roomID == "" {
		return CatchUpResult{}, Invalid("room_id không được để trống")
	}
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return CatchUpResult{}, err
	}
	if !s.gw.Enabled() {
		return CatchUpResult{}, ai.ErrDisabled
	}
	if err := s.rateLimit(ctx, userID); err != nil {
		return CatchUpResult{}, err
	}

	msgs, since, scope, mode, err := s.catchUpMessages(ctx, userID, workspaceID, roomID, strings.TrimSpace(in.ThreadRootID))
	if err != nil {
		return CatchUpResult{}, err
	}
	empty := CatchUpResult{
		Summary:     "Không có tin mới kể từ lần đọc trước.",
		Highlights:  []string{},
		ActionItems: []CatchUpActionItemDTO{},
		Mode:        mode,
		Since:       since,
	}
	if in.Locale == "en" {
		empty.Summary = "Nothing new since you last read."
	}
	if len(msgs) == 0 {
		return empty, nil
	}

	base, err := s.base(ctx, workspaceID)
	if err != nil {
		return CatchUpResult{}, err
	}
	sources := make([]ai.Source, 0, len(msgs))
	idByHref := map[string]string{}
	for _, m := range msgs {
		excerpt := catchUpExcerpt(m)
		if excerpt == "" {
			continue
		}
		href := base + "/chat?room=" + roomID + "&msg=" + m.ID
		title := fmt.Sprintf("%s · %s", m.SenderDisplayName, m.CreatedAt.UTC().Format("2006-01-02 15:04"))
		sources = append(sources, ai.Source{Kind: "chat", Title: title, Href: href, Excerpt: excerpt})
		idByHref[href] = m.ID
	}
	pack, truncated := ai.BuildContext(sources)
	if len(pack) == 0 {
		return empty, nil
	}

	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
		Capability: ai.CapChatCatchUp, PromptID: ai.PromptChatCatchUp,
		Vars: map[string]any{
			"locale": in.Locale, "today": s.now().Format("2006-01-02"),
			"scope": scope + "/" + mode, "since": since.UTC().Format(time.RFC3339),
			"sources": ai.RenderSources(pack),
		},
		Sources: pack, Truncated: truncated,
	})
	if err != nil {
		return CatchUpResult{}, err
	}
	parsed, err := ai.ParseCatchUpJSON(resp.Text, pack)
	if err != nil {
		return CatchUpResult{}, err
	}

	items := make([]CatchUpActionItemDTO, 0, len(parsed.ActionItems))
	for _, a := range parsed.ActionItems {
		msgID := ""
		if a.SourceID != "" {
			for _, src := range pack {
				if src.ID == a.SourceID {
					msgID = idByHref[src.Href]
					break
				}
			}
		}
		items = append(items, CatchUpActionItemDTO{
			Title: a.Title, Owner: a.Owner, Due: a.Due, SourceMessageID: msgID,
		})
	}
	return CatchUpResult{
		Summary: parsed.Summary, Highlights: parsed.Highlights, ActionItems: items,
		MessageCount: len(msgs), Mode: mode, Since: since,
		InputTokens: resp.InputTokens, OutputTokens: resp.OutputTokens,
	}, nil
}

func catchUpExcerpt(m ChatMessageRow) string {
	if body := strings.TrimSpace(m.Body); body != "" {
		return body
	}
	switch m.Kind {
	case "voice":
		return "(tin nhắn thoại)"
	case "file":
		return "(tệp đính kèm)"
	case "poll":
		return "(bình chọn)"
	case "post":
		return "(bài đăng)"
	default:
		return ""
	}
}

func (s *AskUNIService) catchUpMessages(
	ctx context.Context, userID, workspaceID, roomID, threadRootID string,
) ([]ChatMessageRow, time.Time, string, string, error) {
	room, err := s.chat.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, time.Time{}, "", "", err
	}
	since := s.now().UTC().Add(-catchUpPublicWindow)
	scope := "room"
	usedCursor := false
	if mem, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: roomID, UserID: userID}); err == nil {
		usedCursor = true
		if mem.LastReadAt.Valid {
			since = mem.LastReadAt.Time.UTC()
		} else if mem.JoinedAt.Valid {
			since = mem.JoinedAt.Time.UTC()
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, "", "", err
	}

	if threadRootID != "" {
		scope = "thread"
		if fol, err := s.q.GetChatThreadFollower(ctx, db.GetChatThreadFollowerParams{
			ThreadRootID: threadRootID, UserID: userID,
		}); err == nil && fol.LastReadAt.Valid {
			since = fol.LastReadAt.Time.UTC()
			usedCursor = true
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, time.Time{}, "", "", err
		}
		rows, err := s.chat.ListThreadMessages(ctx, userID, workspaceID, roomID, threadRootID, ListChatMessagesInput{Limit: catchUpMsgLimit})
		if err != nil {
			return nil, time.Time{}, "", "", err
		}
		out := catchUpInboundAfter(rows, userID, since)
		return out, since, scope, catchUpCursorMode(usedCursor), nil
	}

	anchorWS := roomAnchorWorkspaceID(room)
	rows, err := s.q.ListChatMessagesAfterInRoom(ctx, db.ListChatMessagesAfterInRoomParams{
		RoomID: roomID, WorkspaceID: anchorWS,
		AfterAt:  pgtype.Timestamptz{Time: since, Valid: true},
		MsgLimit: int32(catchUpMsgLimit),
	})
	if err != nil {
		return nil, time.Time{}, "", "", err
	}
	out := make([]ChatMessageRow, 0, len(rows))
	for _, row := range rows {
		msg := chatMessageRowFromAfterRow(row, userID)
		if msg.SenderID == userID {
			continue
		}
		out = append(out, msg)
	}
	return out, since, scope, catchUpCursorMode(usedCursor), nil
}

// catchUpCursorMode is "unread" when membership/follower last_read drove the
// window; "recent" when CatchUp falls back to the public 48h window.
func catchUpCursorMode(usedMembershipCursor bool) string {
	if usedMembershipCursor {
		return "unread"
	}
	return "recent"
}

func catchUpInboundAfter(rows []ChatMessageRow, userID string, since time.Time) []ChatMessageRow {
	out := make([]ChatMessageRow, 0, len(rows))
	for _, m := range rows {
		if m.SenderID == userID {
			continue
		}
		if m.CreatedAt.After(since) {
			out = append(out, m)
		}
	}
	return out
}
