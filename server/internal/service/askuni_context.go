package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// What the asker puts in front of Ask UNI besides the question (spec
// 2026-10-16, ruling R9): one focus and up to askMentionsMax mentions. Every
// one is read as the asker, inside the asked workspace, before the turn
// streams, so an object they cannot read is the context-forbidden refusal
// and nothing is sent or stored.

const askMentionsMax = 5

// askMentionKinds are the kinds a mention may name; a focus may also be a
// room or an email thread.
var askMentionKinds = []string{"task", "meeting", "document", "project", "member"}

// askMentions checks the mentions of a request and returns the ones to read:
// a repeated object is read once, and the focus is not read again as a mention.
func askMentions(focus *ai.Focus, in []ai.Focus) ([]ai.Focus, error) {
	if len(in) > askMentionsMax {
		return nil, Invalid("tối đa 5 mention")
	}
	out := make([]ai.Focus, 0, len(in))
	for _, m := range in {
		if !slices.Contains(askMentionKinds, m.Kind) || strings.TrimSpace(m.ID) == "" {
			return nil, Invalid("mention không hợp lệ")
		}
		if (focus != nil && *focus == m) || slices.Contains(out, m) {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

// askContext reads the focus, then each mention, as numbered-source items in
// that order. A focus of a kind it does not know is skipped, as before.
func (s *AskUNIService) askContext(ctx context.Context, tc ai.ToolContext, focus *ai.Focus, mentions []ai.Focus) ([]agentItem, error) {
	var items []agentItem
	for _, f := range append([]ai.Focus{{}}, mentions...) {
		if f == (ai.Focus{}) {
			if focus == nil {
				continue
			}
			f = *focus
		}
		got, err := s.contextItems(ctx, tc, f)
		if err != nil {
			if code, ok := agentError(err); errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) || ok && code != "" {
				return nil, ai.ErrContextForbidden
			}
			return nil, err
		}
		items = append(items, got...)
	}
	return items, nil
}

// contextItems reads one object. Whatever the read finds absent or hidden
// from the asker comes back as an error.
func (s *AskUNIService) contextItems(ctx context.Context, tc ai.ToolContext, f ai.Focus) ([]agentItem, error) {
	var srcs func(context.Context, ai.ToolContext, string) ([]ai.Source, error)
	switch f.Kind {
	case "task":
		srcs = s.taskContext
	case "meeting":
		srcs = s.meetingContext
	case "email_thread":
		srcs = s.emailThreadContext
	case "document":
		return s.askTool(ctx, tc, s.agentGetDocument, "document_id", f.ID)
	case "project":
		return s.askTool(ctx, tc, s.agentGetProject, "project_id", f.ID)
	case "room":
		return s.roomContext(ctx, tc, f.ID)
	case "member":
		return s.mentionedMember(ctx, tc, f.ID)
	default:
		return nil, nil
	}
	found, err := srcs(ctx, tc, f.ID)
	items := make([]agentItem, 0, len(found))
	for _, src := range found {
		items = append(items, sourceItem(src))
	}
	return items, err
}

// askTool runs a read tool on one id. The MCP reads need the connector.
func (s *AskUNIService) askTool(ctx context.Context, tc ai.ToolContext, run agentRunFunc, arg, id string) ([]agentItem, error) {
	if s.reads == nil {
		return nil, errAskReadsNotWired
	}
	raw, _ := json.Marshal(map[string]string{arg: id})
	items, err := run(ctx, tc, raw)
	if err == nil && len(items) == 0 {
		err = ErrNotFound
	}
	return items, err
}

// roomContext is the room's latest messages; a room the asker is not in
// reads as absent. An empty room is still a source, from the room list.
func (s *AskUNIService) roomContext(ctx context.Context, tc ai.ToolContext, id string) ([]agentItem, error) {
	raw, _ := json.Marshal(map[string]string{"room_id": id, "query": ""})
	items, err := s.agentReadChatRoom(ctx, tc, raw)
	if err != nil || len(items) > 0 {
		return items, err
	}
	rooms, err := s.agentListChatRooms(ctx, tc, nil)
	if err != nil {
		return nil, err
	}
	for _, it := range rooms {
		if strings.HasSuffix(it.Href, "?room="+id) {
			return []agentItem{it}, nil
		}
	}
	return nil, ErrNotFound
}

// mentionedMember is a workspace member's name and role, nothing else: no
// email and no other account data.
func (s *AskUNIService) mentionedMember(ctx context.Context, tc ai.ToolContext, userID string) ([]agentItem, error) {
	rows, err := s.ws.Members(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.UserID == userID {
			it := personItem(base, r.UserID, r.DisplayName, "ID: "+r.UserID+"\nRole: "+r.Role)
			return []agentItem{it}, nil
		}
	}
	return nil, ErrNotFound
}
