package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// Ask UNI's chat tool (spec P3, R4): the asker's own words, posted as the asker
// in a room they are already in. There is no MCP send tool, so the schema is
// Ask UNI's own and apply goes straight to ChatService.

const askChatSchema = `{"type":"object","properties":{` +
	`"room_id":{"type":"string","description":"The id of a chat room the asker is a member of."},` +
	`"body":{"type":"string","minLength":1,"maxLength":4000,"description":"The message text, posted as written."}},` +
	`"required":["body","room_id"],"additionalProperties":false}`

func init() {
	// Only the sender (or a room moderator, for reminders) may delete, so a
	// refusal reads as undo_unavailable. There is no time window.
	askInverses["delete_chat_message"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			WorkspaceID string `json:"workspace_id"`
			RoomID      string `json:"room_id"`
			MessageID   string `json:"message_id"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		return askUndoGuard(s.chat.DeleteChatMessage(ctx, p.UserID, a.WorkspaceID, a.RoomID, a.MessageID))
	}
}

func (s *AskUNIService) askChatTools() []askWriteTool {
	return []askWriteTool{{
		Tool: ai.Tool{
			Name:        "send_chat_message",
			Description: "Proposes a chat message posted as the asker in one of their rooms. Everyone in the room sees it, as the asker's own words.",
			Kind:        ai.ToolWrite, Risk: ai.RiskMedium, Undo: "the asker deletes the message", Schema: json.RawMessage(askChatSchema),
		},
		prepare: s.prepareSendChatMessage, apply: s.applySendChatMessage, inverse: "delete_chat_message",
	}}
}

func (s *AskUNIService) prepareSendChatMessage(ctx context.Context, tc ai.ToolContext, args json.RawMessage, _ []askDraftRow) (askDraftRow, error) {
	var in struct {
		RoomID string `json:"room_id"`
		Body   string `json:"body"`
	}
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > maxChatMessageBodyLen {
		return askDraftRow{}, McpInvalidArgs{Msg: "body must be 1-" + strconv.Itoa(maxChatMessageBodyLen) + " characters"}
	}
	if strings.TrimSpace(in.RoomID) == "" {
		return askDraftRow{}, McpInvalidArgs{Msg: "room_id is required"}
	}
	if _, ok := askRowRef(in.RoomID); ok {
		return askDraftRow{}, McpInvalidArgs{Msg: "room_id must be the id of an existing room: no tool creates one"}
	}
	// The gate SendRoomMessage uses: any refusal reads as not found, so the
	// answer never says whether the room exists.
	if _, err := s.chat.authorizeRoom(ctx, tc.ActorID, tc.WorkspaceID, in.RoomID); err != nil {
		var ce CodedError
		if errors.Is(err, ErrForbidden) || errors.As(err, &ce) {
			err = ErrNotFound
		}
		return askDraftRow{}, err
	}
	members, err := s.chat.RoomMemberIDs(ctx, in.RoomID)
	if err != nil {
		return askDraftRow{}, err
	}
	title := ""
	rooms, err := s.chat.ListChatRooms(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	for _, r := range rooms {
		if r.ID == in.RoomID {
			title = roomTitle(r)
		}
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	return askDraftRow{
		Tool: "send_chat_message", Args: stored, TargetKind: "room", TargetID: in.RoomID, Level: askLevel2,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "room", ID: in.RoomID, Title: title}, Fields: []AskProposalField{}, Body: in.Body, Refs: []int{},
			Audience: AskAudience{Visibility: "room", RoomMembers: len(members), Notifies: []AskContextRef{}},
		},
	}, nil
}

func (s *AskUNIService) applySendChatMessage(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	var in struct {
		WorkspaceID string `json:"workspace_id"`
		RoomID      string `json:"room_id"`
		Body        string `json:"body"`
	}
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	msg, err := s.chat.SendRoomMessage(ctx, p.UserID, in.WorkspaceID, in.RoomID, SendChatMessageInput{Body: in.Body})
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: msg.ID, Changes: []McpChange{}}
	// Past this point the message is sent: nothing below may fail the row.
	if base, err := s.base(ctx, in.WorkspaceID); err == nil {
		out.Href = base + "/chat?room=" + in.RoomID
	}
	return out, askInverseOrNote(&out, "delete_chat_message", map[string]any{"workspace_id": in.WorkspaceID, "room_id": in.RoomID, "message_id": msg.ID}), nil
}
